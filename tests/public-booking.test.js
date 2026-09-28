import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bookingDatabase,ids } from "./helpers/booking-db.js";
import { bookingAction,handler } from "../netlify/functions/booking.mjs";
import { serviceTotals,normalizePhone,localTime } from "../src/lib/booking.js";
import { runAction } from "../netlify/functions/admin-api.mjs";

test("public booking: migrations and transactional availability",async(t)=>{
  const {db,day}=await bookingDatabase(); t.after(()=>db.close());
  const time=(h)=>`${day}T${h}:00-03:00`;
  const slots=async(services=[ids.cut,ids.beard],barber=ids.barber,date=day)=>(await db.query("select public.public_available_slots($1,$2,$3) as value",[barber,services,date])).rows[0].value;
  const book=async(h="09:00",services=[ids.cut,ids.beard],phone="+5585999999999",key=randomUUID())=>(await db.query("select public.create_public_booking($1,$2,$3,$4,$5,$6,true) as value",[key,ids.barber,services,time(h),"Cliente Completo",phone])).rows[0].value;
  const asAdmin=()=>db.exec(`set role authenticated; set test.uid='${ids.admin}'; set test.aal='aal2';`);
  const asAnon=()=>db.exec("set role anon; set test.uid=''; set test.aal='';");
  async function isolated(name,fn){await t.test(name,async()=>{await db.exec("begin");try{await fn();}finally{await db.exec("rollback");}});}
  async function rejected(fn,pattern){await db.exec("savepoint reject_operation");await assert.rejects(fn(),pattern);await db.exec("rollback to savepoint reject_operation");}

  await isolated("one/multiple services: server totals, lunch, closing, days off and privacy",async()=>{
    await asAnon();
    const multiple=await slots(); assert.equal(multiple.total_price,70);assert.equal(multiple.total_duration_minutes,50);
    const starts=multiple.slots.map(s=>localTime(s.starts_at));
    assert.ok(starts.includes("09:00"));assert.ok(starts.includes("11:00"));assert.ok(!starts.includes("11:30"));assert.ok(!starts.includes("12:00"));assert.ok(starts.includes("19:00"));assert.ok(!starts.includes("19:30"));
    const one=await slots([ids.cut]);assert.equal(one.total_duration_minutes,30);assert.equal(one.total_price,45);assert.ok(one.slots.some(s=>localTime(s.starts_at)==="11:30"));
    const sunday=new Date(`${day}T12:00:00Z`);sunday.setUTCDate(sunday.getUTCDate()+6);
    assert.deepEqual((await slots([ids.cut],ids.barber,sunday.toISOString().slice(0,10))).slots,[]);
    assert.deepEqual(Object.keys(multiple.slots[0]).sort(),["ends_at","starts_at"]);
    for(const table of ["clients","appointments","appointment_services","barber_hours","barber_breaks"]) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
    await rejected(()=>db.query('select * from public.booking_requests'),/permission denied/);
    await rejected(()=>db.query("select public.booking_periods($1,$2)",[ids.barber,day]),/permission denied/);
  });
  await isolated("09:30 is excluded for 50 minutes before a 10:00 booking; touching is allowed",async()=>{
    await asAnon();await book("10:00",[ids.cut]);
    const starts=(await slots()).slots.map(s=>localTime(s.starts_at));assert.ok(starts.includes("09:00"));assert.ok(!starts.includes("09:30"));assert.ok(starts.includes("10:30"));
    await book("09:30",[ids.cut],"+5585988888888");
    await rejected(()=>book("09:00",[ids.cut,ids.beard],"+5585977777777"),/indisponível/);
  });
  await isolated("independent grids and changing a grid preserves existing appointments",async()=>{
    await asAnon();const receipt=await book();
    await asAdmin();const before=(await db.query("select * from public.appointments")).rows;
    await db.query("update public.barbers set slot_interval_minutes=15 where id=$1",[ids.barber]);
    assert.deepEqual((await db.query("select * from public.appointments")).rows,before);
    await db.query("update public.barbers set booking_enabled=true,slot_interval_minutes=20 where id=$1",[ids.other]);
    await db.query("insert into public.barber_services values($1,$2)",[ids.other,ids.cut]);
    await db.query("select public.save_barber_schedule($1,1,$2)",[ids.other,JSON.stringify([{opens_at:"09:00",closes_at:"12:00"}])]);
    await asAnon();assert.ok((await slots([ids.cut])).slots.some(s=>localTime(s.starts_at)==="10:15"));
    const other=(await slots([ids.cut],ids.other)).slots.map(s=>localTime(s.starts_at));assert.ok(other.includes("09:20"));assert.ok(!other.includes("09:15"));
    assert.equal(receipt.total_duration_minutes,50);
  });
  await isolated("all seven grid options affect starts only; legacy hours API remains compatible",async()=>{
    await asAdmin();
    await db.query("select public.replace_barber_hours($1,1::smallint,false,'09:00','12:00',null,null)",[ids.other]);
    for(const interval of [5,10,15,20,30,45,60]) {
      await db.query("update public.barbers set slot_interval_minutes=$2 where id=$1",[ids.barber,interval]);
      const result=await slots();assert.equal(result.total_duration_minutes,50);
      assert.equal((new Date(result.slots[1].starts_at)-new Date(result.slots[0].starts_at))/60000,interval);
      assert.equal((new Date(result.slots[0].ends_at)-new Date(result.slots[0].starts_at))/60000,50);
    }
    assert.equal((await db.query("select slot_interval_minutes from public.barbers where id=$1",[ids.other])).rows[0].slot_interval_minutes,30);
    await rejected(()=>db.query("update public.barbers set slot_interval_minutes=25 where id=$1",[ids.barber]),/check constraint/);
  });
  await isolated("date overrides, multiple pauses, blocks and optional preparation time",async()=>{
    await asAdmin();await db.query("select public.save_barber_schedule($1,1,$2,$3)",[ids.barber,JSON.stringify([{opens_at:"09:00",closes_at:"12:00",breaks:[{starts_at:"10:00",ends_at:"10:30"},{starts_at:"11:00",ends_at:"11:15"}]},{opens_at:"16:00",closes_at:"16:50"}]),day]);
    await asAnon();let starts=(await slots()).slots.map(s=>localTime(s.starts_at));assert.ok(starts.includes("16:00"));assert.ok(!starts.includes("09:30"));assert.ok(!starts.includes("10:30"));
    await asAdmin();await db.query("update public.barbers set buffer_minutes=10 where id=$1",[ids.barber]);
    await asAnon();starts=(await slots()).slots.map(s=>localTime(s.starts_at));assert.ok(!starts.includes("16:00"));
    await asAdmin();await db.query("insert into public.schedule_blocks(barber_id,starts_at,ends_at,kind) values($1,$2,$3,'time_off')",[ids.barber,time("09:00"),time("10:00")]);
    await asAnon();assert.ok(!(await slots()).slots.some(s=>localTime(s.starts_at)==="09:00"));
  });
  await isolated("reservation is idempotent, snapshots stay intact, cancellation frees the slot",async()=>{
    await asAnon();const key=randomUUID();const first=await book("09:00",undefined,undefined,key);const again=await book("09:00",undefined,undefined,key);assert.deepEqual(again,first);
    assert.ok(!(await slots()).slots.some(s=>localTime(s.starts_at)==="09:00"));
    await asAdmin();assert.equal((await db.query("select count(*)::int n from public.appointments")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from public.clients")).rows[0].n,1);
    await db.query("update public.services set price=99,duration_minutes=45 where id=$1",[ids.cut]);
    const history=(await db.query("select price,duration_minutes from public.appointment_services where service_id=$1",[ids.cut])).rows[0];assert.deepEqual(history,{price:"45.00",duration_minutes:30});
    await db.query("update public.appointments set status='cancelled' where id=$1",[first.id]);
    await asAnon();assert.ok((await slots()).slots.some(s=>localTime(s.starts_at)==="09:00"));
  });
  await isolated("two concurrent submissions for overlapping slots yield one reservation",async()=>{
    await asAnon();const results=await Promise.allSettled([book("09:00"),book("09:30",undefined,"+5585988888888")]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
    // PGlite serializes its connection; multi-connection locking needs hosted PostgreSQL validation.
  });
  await isolated("inactive/unlinked services, disabled barbers, notice and horizon are enforced",async()=>{
    await asAdmin();await db.query("delete from public.barber_services where barber_id=$1 and service_id=$2",[ids.barber,ids.beard]);
    await asAnon();await rejected(()=>slots(),/serviço/);
    await asAdmin();await db.query("update public.services set active=false where id=$1",[ids.cut]);
    await asAnon();await rejected(()=>slots([ids.cut]),/serviço/);
    await rejected(()=>slots([ids.cut],ids.other),/Barbeiro/);
    await asAdmin();await db.query("update public.services set active=true where id=$1",[ids.cut]);await db.query("update public.barbers set booking_horizon_days=1 where id=$1",[ids.barber]);
    await asAnon();await rejected(()=>slots([ids.cut]),/Data fora/);
    await asAdmin();await db.query("update public.barbers set booking_horizon_days=60,minimum_notice_minutes=10080 where id=$1",[ids.barber]);
    const tomorrow=(await db.query("select ((now() at time zone 'America/Fortaleza')::date+1)::text as day")).rows[0].day;
    await asAnon();assert.deepEqual((await slots([ids.cut],ids.barber,tomorrow)).slots,[]);
  });
  await isolated("new barbers publish automatically and only approved photos are readable",async()=>{
    await asAdmin();await db.query("update public.barbers set public_booking_key=null,booking_enabled=true where id=$1",[ids.other]);
    await db.query("select public.save_barber_schedule($1,1,$2)",[ids.other,JSON.stringify([{opens_at:"14:00",closes_at:"17:00"}])]);
    await asAnon();const catalog=(await db.query("select public.public_booking_catalog() value")).rows[0].value;
    assert.equal(catalog.length,2);assert.ok(catalog.some(b=>b.booking_key===ids.other));
    assert.deepEqual(Object.keys(catalog[0]).sort(),["booking_horizon_days","booking_key","description","id","name","photo_path","services"]);
    await asAdmin();await db.query("update public.barbers set booking_enabled=false where id=$1",[ids.other]);
    await asAnon();const photos=(await db.query("select name from storage.objects")).rows.map(x=>x.name);assert.ok(photos.includes("public/geovane.jpg"));assert.ok(!photos.includes("private/daniel.jpg"));
  });
  await isolated("invalid hours and overwriting Geovane template are rejected; no Daniel schedule is invented",async()=>{
    await asAdmin();assert.equal((await db.query("select count(*)::int n from public.barber_hours where barber_id=$1",[ids.other])).rows[0].n,0);
    await rejected(()=>db.query("select public.apply_geovane_schedule($1)",[ids.barber]),/Já existem/);
    for(const periods of [[{opens_at:"12:00",closes_at:"09:00"}],[{opens_at:"09:00",closes_at:"12:00"},{opens_at:"11:00",closes_at:"13:00"}],[{opens_at:"09:00",closes_at:"12:00",breaks:[{starts_at:"08:00",ends_at:"09:30"}]}]])
      await rejected(()=>db.query("select public.save_barber_schedule($1,1,$2)",[ids.barber,JSON.stringify(periods)]),/inválid|sobrepost/);
    await asAnon();await rejected(()=>db.query("select public.save_barber_schedule($1,1,'[]')",[ids.barber]),/permission denied/);
  });
  await isolated("phone quota and contact validation cannot be bypassed through direct RPC",async()=>{
    await asAnon();await book("09:00");await book("10:00");await book("11:00");await rejected(()=>book("14:00"),/Limite/);
    await rejected(()=>db.query("select public.create_public_booking($1,$2,$3,$4,'Nome','invalid',false)",[randomUUID(),ids.barber,[ids.cut],time("15:00")]),/nome completo/);
  });
  await isolated("a rejected reservation leaves no orphan client, appointment or service snapshot",async()=>{
    await asAnon();await book("10:00",[ids.cut]);
    await rejected(()=>book("09:30",[ids.cut,ids.beard],"+5585988888888"),/indisponível/);
    await asAdmin();assert.equal((await db.query("select count(*)::int n from public.clients")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from public.appointments")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from public.appointment_services")).rows[0].n,1);
  });
  await isolated("public reservations are returned by the authenticated admin bootstrap",async()=>{
    await asAnon();const receipt=await book();await asAdmin();
    const adapter={from(table){
      assert.match(table,/^[a-z_]+$/);
      const orders=[];
      return {select(){return this;},order(column){assert.match(column,/^[a-z_]+$/);orders.push(column);return this;},async range(from,to){try{return {data:(await db.query(`select * from public.${table} order by ${orders.join(',')} limit $1 offset $2`,[to-from+1,from])).rows};}catch(error){return {error};}}};
    },storage:{from(){return {createSignedUrl:async()=>({data:null})};}}};
    const data=await runAction(adapter,"bootstrap");
    assert.equal(data.appointments[0].id,receipt.id);assert.equal(data.appointments[0].status,"pending");assert.equal(data.clients[0].phone_e164,"+5585999999999");assert.equal(data.appointment_services.length,2);
  });
});

test("booking API ignores browser prices/durations and rejects malformed requests",async()=>{
  let called;
  const db={rpc:async(name,args)=>{called={name,args};return {data:{id:"saved"}};}};
  const input={request_id:randomUUID(),barber_id:ids.barber,service_ids:[ids.cut,ids.beard],starts_at:"2030-01-01T12:00:00Z",full_name:"Cliente Teste",phone:"+5585999999999",contact_consent:true,total_price:1,total_duration_minutes:1};
  await bookingAction(db,"create",input);assert.equal(called.name,"create_public_booking");assert.ok(!("total_price" in called.args));assert.ok(!("total_duration_minutes" in called.args));
  await assert.rejects(bookingAction({},"create",{...input,website:"spam"}),/nome completo/);
  await assert.rejects(bookingAction({},"availability",{barber_id:ids.barber,service_ids:[ids.cut,ids.cut]}),/inválida/);
  assert.equal((await handler({httpMethod:"DELETE"})).statusCode,405);
  assert.equal((await handler({httpMethod:"POST",body:"x".repeat(65537)})).statusCode,413);
});
test("individual grid validation and precise UI totals",async()=>{
  assert.deepEqual(serviceTotals([{price:45,duration_minutes:30},{price:25,duration_minutes:20}]),{price:70,minutes:50});
  assert.equal(normalizePhone("(85) 99999-9999"),"+5585999999999");
  await assert.rejects(runAction({},"save_barber",{name:"Barbeiro",active:true,slot_interval_minutes:25}),/inválidas/);
});
