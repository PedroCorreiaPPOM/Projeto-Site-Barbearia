import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { runAction, createAdminHandler } from "../netlify/functions/admin-api.mjs";
import { authorizeAdmin } from "../netlify/functions/admin-status.mjs";
import { fetchPublicBarbers } from "../src/lib/publicCatalog.js";

const barber = "10000000-0000-0000-0000-000000000001";
const service = "20000000-0000-0000-0000-000000000001";
const client = "30000000-0000-0000-0000-000000000001";
const admin = "40000000-0000-0000-0000-000000000001";
const stranger = "40000000-0000-0000-0000-000000000002";
const booking = "50000000-0000-0000-0000-000000000001";

test("catalog deletion: real PostgreSQL migrations, guards and RLS", async (t) => {
  const db = new PGlite({extensions:{pgcrypto, btree_gist}});
  t.after(() => db.close());
  // Supabase-owned schemas and JWT functions, emulated locally without secrets.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  for (const name of ["202609270001_initial", "202609270002_admin_panel", "202609270003_service_photos", "202609270004_catalog_soft_delete"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  await db.exec(`
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    grant select on public.barbers,public.services to anon;
    grant usage on all sequences in schema public to authenticated;
    insert into auth.users values ('${admin}'),('${stranger}');
    insert into public.admins(user_id) values ('${admin}');
    insert into public.barbers(id,name,photo_path,public_booking_key) values ('${barber}','Geovane','retained/barber.jpg','geovane');
    insert into public.services(id,name,price,duration_minutes,photo_path) values ('${service}','Corte',45,30,'retained/service.jpg');
    insert into public.barber_services values ('${barber}','${service}');
    insert into public.barber_hours(barber_id,weekday,opens_at,closes_at)
      select '${barber}',day,'00:00','23:59:59' from generate_series(0,6) day;
    insert into public.clients(id,full_name,phone_e164) values ('${client}','Cliente teste','+5585999999999');
  `);
  async function authorized() {
    await db.exec(`set role authenticated; set test.uid='${admin}'; set test.aal='aal2';`);
  }
  async function appointment(status = "pending", past = false) {
    await db.query(`insert into public.appointments(id,client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status)
      select $1,$2,$3,(start at time zone 'America/Fortaleza')::date,start,start+interval '30 minutes',45,30,$4
      from (select date_trunc('day',now()) + $5::interval as start) times`,
    [booking,client,barber,status,past ? "-2 days 12 hours" : "2 days 12 hours"]);
    await db.query("insert into public.appointment_services values ($1,$2,'Corte histórico',45,30)", [booking,service]);
  }
  const adapter = {rpc: async (name, args) => {
    assert.ok(["deactivate_catalog_item","catalog_deletion_preview"].includes(name));
    try {
      const result = await db.query(`select public.${name}($1,$2) as data`, [args.p_kind,args.p_id]);
      return {data:result.rows[0].data};
    } catch (error) { return {error}; }
  }};
  async function isolated(name, operation) {
    await t.test(name, async () => {
      await db.exec("begin");
      try { await authorized(); await operation(); }
      finally { await db.exec("rollback"); }
    });
  }
  // Expected SQL errors abort a transaction, so use a savepoint around rejection checks.
  async function rejected(operation, pattern) {
    await db.exec("savepoint rejected_operation");
    await assert.rejects(operation(), pattern);
    await db.exec("rollback to savepoint rejected_operation");
  }
  for (const kind of ["barber","service"]) {
    const id = kind === "barber" ? barber : service;
    const table = kind === "barber" ? "barbers" : "services";
    await isolated(`${kind}: soft deletion preserves completed history, associations and photos`, async () => {
      await appointment("completed",true);
      const before = await db.query("select * from public.appointments");
      const snapshots = await db.query("select * from public.appointment_services");
      assert.equal((await runAction(adapter,"deletion_preview",{kind,id})).count,0);
      assert.deepEqual(await runAction(adapter,`delete_${kind}`,{id}),{id,active:false});
      assert.deepEqual((await db.query("select * from public.appointments")).rows,before.rows);
      assert.deepEqual((await db.query("select * from public.appointment_services")).rows,snapshots.rows);
      const row = (await db.query(`select * from public.${table} where id=$1`,[id])).rows[0];
      assert.equal(row.active,false); assert.match(row.photo_path,/retained/);
      assert.equal((await db.query("select * from public.barber_services")).rows.length,1);
      // Duplicate requests are idempotent.
      assert.equal((await runAction(adapter,`delete_${kind}`,{id})).active,false);
    });
    await isolated(`${kind}: future bookings block RPC and direct deactivation`, async () => {
      await appointment();
      const preview = await runAction(adapter,"deletion_preview",{kind,id});
      assert.equal(preview.count,1); assert.equal(preview.appointments[0].service_names,"Corte histórico");
      await rejected(()=>runAction(adapter,`delete_${kind}`,{id}),/atendimentos futuros/);
      await db.query("update public.appointments set status='confirmed' where id=$1",[booking]);
      await rejected(()=>db.query(`update public.${table} set active=false where id=$1`,[id]),/atendimentos futuros/);
      assert.equal((await db.query(`select active from public.${table} where id=$1`,[id])).rows[0].active,true);
      await db.query("update public.appointments set status='cancelled' where id=$1",[booking]);
      assert.equal((await runAction(adapter,`delete_${kind}`,{id})).active,false);
      assert.equal((await db.query("select count(*)::int as n from public.appointment_services")).rows[0].n,1);
    });
    await isolated(`${kind}: no-show records do not block deletion and remain unchanged`, async () => {
      await appointment("no_show");
      assert.equal((await runAction(adapter,`delete_${kind}`,{id})).active,false);
      assert.equal((await db.query("select status from public.appointments where id=$1",[booking])).rows[0].status,"no_show");
    });
    await isolated(`${kind}: new appointments cannot use inactive catalog items`, async () => {
      if(kind === "service") await appointment("cancelled");
      await runAction(adapter,`delete_${kind}`,{id});
      if(kind === "barber") await rejected(()=>appointment(),/Barbeiro indisponível/);
      else await rejected(()=>db.query("update public.appointments set status='confirmed' where id=$1",[booking]),/serviço inativo/);
    });
    for (const [uid,aal] of [[stranger,"aal2"],[admin,"aal1"]]) {
      await isolated(`${kind}: rejects ${uid === stranger ? "non-admin" : "admin without MFA"}`, async () => {
        await db.exec(`set test.uid='${uid}'; set test.aal='${aal}';`);
        await rejected(()=>runAction(adapter,`delete_${kind}`,{id}),/Acesso negado/);
        assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
      });
    }
  }
  await isolated("a new service link cannot attach an inactive service to a pending booking", async () => {
    await appointment();
    await db.query("delete from public.appointment_services where appointment_id=$1",[booking]);
    await runAction(adapter,"delete_service",{id:service});
    await rejected(()=>db.query("insert into public.appointment_services values ($1,$2,'Corte',45,30)",[booking,service]),/Serviço indisponível/);
  });
  await isolated("public projection hides inactive barbers and never exposes private columns", async () => {
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select * from public.public_booking_barbers()")).rows,[{booking_key:"geovane"}]);
    assert.deepEqual((await db.query("select * from public.barbers")).rows,[]);
    await rejected(()=>db.query("select public.deactivate_catalog_item('barber',$1)",[barber]),/permission denied/);
    await authorized(); await runAction(adapter,"delete_barber",{id:barber});
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select * from public.public_booking_barbers()")).rows,[]);
  });
});

test("deletion API rejects invalid IDs before accessing the database", async () => {
  for (const action of ["delete_barber","delete_service","deletion_preview"]) await assert.rejects(runAction({},action,{id:"bad"}),/inválida/);
});

test("HTTP deletion requires validated administrator and MFA before any mutation", async () => {
  for (const action of ["delete_barber","delete_service"]) {
    for (const state of ["unauthenticated","non-admin","aal1","aal2"]) {
      let mutated = false;
      const authClient = {auth:{getUser:async()=>({data:{user:state === "unauthenticated" ? null : {id:admin}}}),
        mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:state}})}},rpc:async()=>({data:state !== "non-admin"})};
      const handler = createAdminHandler({authorize:(token)=>authorizeAdmin(token,"url","key",()=>authClient),
        clientFactory:()=>({rpc:async()=>{mutated=true;return {data:{active:false}};}})});
      const response = await handler({httpMethod:"POST",headers:{authorization:"Bearer test"},body:JSON.stringify({action,input:{id:barber}})});
      assert.equal(response.statusCode,state === "aal2" ? 200 : state === "unauthenticated" ? 401 : 403);
      assert.equal(mutated,state === "aal2");
    }
  }
});

test("public selection uses explicit active keys and fails closed on errors", async () => {
  assert.deepEqual((await fetchPublicBarbers({rpc:async()=>({data:[{booking_key:"geovane"},{booking_key:"unknown"}]})})).map(b=>b.id),["geovane"]);
  assert.deepEqual(await fetchPublicBarbers({rpc:async()=>({data:[]})}),[]);
  await assert.rejects(fetchPublicBarbers(null),/consultar/);
  await assert.rejects(fetchPublicBarbers({rpc:async()=>({error:new Error("unavailable")})}),/consultar/);
});
