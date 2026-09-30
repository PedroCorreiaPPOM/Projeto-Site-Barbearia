import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { bookingDatabase, ids } from './helpers/booking-db.js';
import { draftFromSnapshot } from '../src/admin/barberDraft.js';

test('PostgreSQL: independent sessions serialize booking and administrative writes', {timeout:120000}, async t => {
  const root=await realpath(tmpdir());
  const directory=await mkdtemp(path.join(root,'georocha-pg-test-'));
  assert.equal(path.dirname(await realpath(directory)),root);
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  const logs=[];
  const postgres=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password:randomUUID(),
    persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],
    onLog:m=>logs.push(String(m)),onError:m=>logs.push(String(m))});
  const clients=[];
  t.after(async()=>{await Promise.all(clients.map(c=>c.end()));await postgres.stop();});
  try {await postgres.initialise();await postgres.start();}
  catch(error){throw new Error(`${error}\n${logs.join('\n')}`);}
  async function connect(){const c=postgres.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);await c.query("set statement_timeout='10s'");return c;}
  const owner=await connect(),a=await connect(),b=await connect();
  const {day}=await bookingDatabase({exec:sql=>owner.query(sql),query:(sql,args)=>owner.query(sql,args)});
  await owner.query(await readFile(new URL('../supabase/checks/preflight_005_006.sql',import.meta.url),'utf8'));
  const stamp=h=>`${day}T${h}:00-03:00`;
  const book=(c,h='09:00',key=randomUUID(),phone='+5585999999999')=>c.query('select public.create_public_booking($1,$2,$3,$4,$5,$6,true) as receipt',[key,ids.barber,[ids.cut],stamp(h),'Cliente Completo',phone]);
  const admin=c=>c.query(`set role authenticated; set test.uid='${ids.admin}'; set test.aal='aal2'`);
  async function reset(){await a.query('rollback; reset role');await b.query('rollback; reset role');await owner.query('truncate public.booking_requests,public.appointment_services,public.appointments,public.schedule_blocks cascade');await admin(a);await admin(b);}
  async function race(first,second,code='23514'){
    await a.query('begin');await first();
    const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pending=second().then(value=>({value}),error=>({error}));
    let waiting=false;
    for(let i=0;i<200;i++){
      waiting=(await owner.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waiting",[pid])).rows[0].waiting;
      if(waiting)break;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'second connection actually waits on the transaction lock');
    await a.query('commit');
    const result=await pending;
    assert.equal(result.error?.code,code==='success'?undefined:code,JSON.stringify(result));
  }
  await t.test('two bookings whose services do not overlap but preparation does',async()=>{
    await reset();await owner.query('update public.barbers set buffer_minutes=15 where id=$1',[ids.barber]);
    await race(()=>book(a),()=>book(b,'09:30'));
    assert.equal((await owner.query('select count(*)::int as n from public.appointments')).rows[0].n,1);
    assert.equal((await owner.query('select count(*)::int as n from public.booking_requests')).rows[0].n,1);
  });
  await t.test('booking committed while administrative block waits',async()=>{
    await reset();await race(()=>book(a),()=>b.query("insert into public.schedule_blocks(barber_id,starts_at,ends_at,kind) values($1,$2,$3,'block')",[ids.barber,stamp('09:30'),stamp('09:45')]));
  });
  await t.test('administrative block committed while booking waits',async()=>{
    await reset();await race(()=>a.query("insert into public.schedule_blocks(barber_id,starts_at,ends_at,kind) values($1,$2,$3,'block')",[ids.barber,stamp('09:30'),stamp('09:45')]),()=>book(b));
  });
  await t.test('direct hours update cannot invalidate booking committed while it waits',async()=>{
    await reset();await race(()=>book(a),()=>b.query("update public.barber_hours set opens_at='10:00' where barber_id=$1 and weekday=1 and opens_at='09:00'",[ids.barber]));
  });
  await t.test('hours committed while public booking waits are rechecked',async()=>{
    await reset();await race(()=>a.query("update public.barber_hours set opens_at='10:00' where barber_id=$1 and weekday=1 and opens_at='09:00'",[ids.barber]),()=>book(b));
    await owner.query("update public.barber_hours set opens_at='09:00' where barber_id=$1 and weekday=1 and opens_at='10:00'",[ids.barber]);
  });
  await t.test('administrative rescheduling respects preparation and keeps snapshots',async()=>{
    await reset();const receipt=(await book(a,'11:00')).rows[0].receipt;
    await race(()=>book(a),()=>b.query('update public.appointments set starts_at=$2,ends_at=$3 where id=$1',[receipt.id,stamp('09:30'),stamp('10:00')]));
    await assert.rejects(b.query('update public.appointments set total_duration_minutes=15,ends_at=starts_at+interval \'15 minutes\' where id=$1',[receipt.id]),e=>e.code==='23514');
    assert.equal((await owner.query('select total_duration_minutes from public.appointments where id=$1',[receipt.id])).rows[0].total_duration_minutes,30);
  });
  await t.test('same request in two sessions returns exactly one receipt',async()=>{
    await reset();const key=randomUUID();const results=await Promise.all([book(a,'09:00',key),book(b,'09:00',key)]);
    assert.deepEqual(results[0].rows,results[1].rows);
    assert.equal((await owner.query('select count(*)::int as n from public.appointments')).rows[0].n,1);
    await assert.rejects(book(b,'09:00',key,'+5585888888888'),e=>e.code==='22023');
    await b.query("set timezone='Asia/Tokyo'");assert.deepEqual((await book(b,'09:00',key)).rows,results[0].rows);
    await assert.rejects(book(b,'09:00',ids.barber),e=>e.code==='22023');
  });
  await t.test('raw pauses and date overrides cannot invalidate reservations',async()=>{
    await reset();await book(a);
    await assert.rejects(b.query("insert into public.barber_breaks(barber_hour_id,starts_at,ends_at) select id,'09:30','10:00' from public.barber_hours where barber_id=$1 and weekday=1 and opens_at='09:00'",[ids.barber]),e=>e.code==='23514');
    await assert.rejects(b.query("insert into public.barber_date_overrides(barber_id,local_date,periods) values($1,$2,'[]')",[ids.barber,day]),e=>e.code==='23514');
    await assert.rejects(b.query('delete from public.barber_hours where barber_id=$1 and weekday=1',[ids.barber]),e=>e.code==='23514');
  });
  await t.test('rescheduling captures current preparation without changing service duration',async()=>{
    await reset();const receipt=(await book(a)).rows[0].receipt;
    await a.query('update public.barbers set buffer_minutes=20 where id=$1',[ids.barber]);
    assert.equal((await a.query('select buffer_minutes from public.appointments where id=$1',[receipt.id])).rows[0].buffer_minutes,15);
    await a.query('update public.appointments set starts_at=$2,ends_at=$3 where id=$1',[receipt.id,stamp('10:00'),stamp('10:30')]);
    const saved=(await a.query('select buffer_minutes,total_duration_minutes,total_price from public.appointments where id=$1',[receipt.id])).rows[0];
    assert.deepEqual(saved,{buffer_minutes:20,total_duration_minutes:30,total_price:'45.00'});
    await a.query('update public.appointments set buffer_minutes=0 where id=$1',[receipt.id]);
    assert.equal((await a.query('select buffer_minutes from public.appointments where id=$1',[receipt.id])).rows[0].buffer_minutes,20);
  });
  await t.test('inherited default privileges do not expose internal functions or TRUNCATE',async()=>{
    const internal=(await owner.query(`select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')
      and p.proname not in ('public_booking_catalog','public_available_slots','create_public_booking','public_booking_barbers','is_public_booking_photo')`)).rows;
    assert.deepEqual(internal,[]);
    await b.query('set role anon');await assert.rejects(b.query('select * from public.booking_requests'),e=>e.code==='42501');
    await assert.rejects(b.query('truncate public.appointments cascade'),e=>e.code==='42501');
    await b.query(`set role authenticated; set test.uid='${ids.admin}'; set test.aal='aal1'`);
    await assert.rejects(b.query('select public.save_barber_schedule($1,1,$2)',[ids.barber,'[]']),e=>e.code==='42501');
    assert.equal((await b.query('select * from public.booking_requests')).rows.length,0);
    await b.query("set test.uid='40000000-0000-0000-0000-000000000099'; set test.aal='aal2'");
    await assert.rejects(b.query('select public.save_barber_schedule($1,1,$2)',[ids.barber,'[]']),e=>e.code==='42501');
    assert.equal((await b.query('update public.barbers set active=false returning id')).rows.length,0);
  });
  await t.test('stale transaction snapshots are rejected for agenda writes',async()=>{
    await reset();await b.query('begin isolation level repeatable read');
    await assert.rejects(b.query('update public.barbers set buffer_minutes=0 where id=$1',[ids.barber]),e=>e.code==='25000');
    await b.query('rollback');
  });
  await t.test('full editor save waits for public booking and rolls back conflicting hours',async()=>{
    await reset();
    const before=(await a.query('select public.barber_editor_snapshot($1) as state',[ids.barber])).rows[0].state;
    const profile=draftFromSnapshot(before);profile.name='Must roll back';profile.week[1][0].opens_at='10:00';
    await race(()=>book(a),()=>b.query('select public.save_barber_profile($1,$2,$3)',[ids.barber,JSON.stringify(profile),JSON.stringify(before)]));
    assert.deepEqual((await a.query('select public.barber_editor_snapshot($1) as state',[ids.barber])).rows[0].state,before);
  });
  await t.test('two full editors cannot overwrite each other after waiting on the lock',async()=>{
    await reset();
    const before=(await a.query('select public.barber_editor_snapshot($1) as state',[ids.barber])).rows[0].state;
    const first=draftFromSnapshot(before),second=draftFromSnapshot(before);first.description='first edit';second.description='stale edit';
    await race(()=>a.query('select public.save_barber_profile($1,$2,$3)',[ids.barber,JSON.stringify(first),JSON.stringify(before)]),
      ()=>b.query('select public.save_barber_profile($1,$2,$3)',[ids.barber,JSON.stringify(second),JSON.stringify(before)]),'40001');
    assert.equal((await a.query('select description from public.barbers where id=$1',[ids.barber])).rows[0].description,'first edit');
  });
  await owner.query(await readFile(new URL('../supabase/migrations/202609300009_appointment_reminders.sql',import.meta.url),'utf8'));
  async function reminderFixture(){
    await reset();
    const tomorrow=(await owner.query("select ((now() at time zone 'America/Fortaleza')::date+1)::text as day")).rows[0].day;
    await owner.query(`insert into public.barber_date_overrides(barber_id,local_date,periods) values($1,$2,'[{"opens_at":"09:00","closes_at":"18:00","breaks":[]}]') on conflict(barber_id,local_date) do nothing`,[ids.barber,tomorrow]);
    const result=await owner.query("select public.create_public_booking($1,$2,$3,$4,'Cliente Completo','+5585999999999',true) as receipt",[randomUUID(),ids.barber,[ids.cut],`${tomorrow}T09:00:00-03:00`]);
    await owner.query('update public.clients set whatsapp_reminder_consent=true');
    await a.query('select public.save_reminder_settings(true,false,10080,60)');
    await a.query('set role service_role');await b.query('set role service_role');
    return result.rows[0].receipt.id;
  }
  await t.test('two reminder workers serialize and only one owns the due item',async()=>{
    await reminderFixture();let first,second;
    await race(async()=>{first=(await a.query('select public.claim_appointment_reminder(true) as q')).rows[0].q;},async()=>{second=(await b.query('select public.claim_appointment_reminder(true) as q')).rows[0].q;},'success');
    assert.ok(first.claim_token);assert.equal(second,null);
    assert.equal((await owner.query("select count(*)::int as n from public.appointment_reminders where status='processing'")).rows[0].n,1);
  });
  await t.test('cancellation commits before waiting worker: no reminder can be claimed',async()=>{
    const id=await reminderFixture();await admin(a);let claimed;
    await race(()=>a.query("update public.appointments set status='cancelled' where id=$1",[id]),async()=>{claimed=(await b.query('select public.claim_appointment_reminder(true) as q')).rows[0].q;},'success');
    assert.equal(claimed,null);
  });
  await t.test('worker commits first: concurrent cancellation must wait for dispatch completion',async()=>{
    const id=await reminderFixture();await admin(b);let q;
    await race(async()=>{q=(await a.query('select public.claim_appointment_reminder(true) as q')).rows[0].q;},()=>b.query("update public.appointments set status='cancelled' where id=$1",[id]),'40001');
    await a.query("select public.finish_appointment_reminder($1,$2,'accepted',null)",[q.id,q.claim_token]);
    await b.query("update public.appointments set status='cancelled' where id=$1",[id]);
  });
  await t.test('booking commits first: permanent deletion waits and preserves the booking',async()=>{
    await reset();
    await race(()=>book(a),()=>b.query("select public.permanently_delete_barber($1,'Geovane')",[ids.barber]));
    assert.equal((await owner.query('select count(*)::int as n from public.barbers where id=$1',[ids.barber])).rows[0].n,1);
    assert.equal((await owner.query('select count(*)::int as n from public.appointments where barber_id=$1',[ids.barber])).rows[0].n,1);
  });
  await t.test('reactivating old history first prevents a waiting permanent deletion',async()=>{
    await reset();
    const appointment=randomUUID();
    const client=(await owner.query('select id from public.clients limit 1')).rows[0].id;
    await a.query("insert into public.appointments(id,client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status) values($1,$2,$3,'2020-01-06','2020-01-06T09:00:00-03:00','2020-01-06T09:30:00-03:00',45,30,'completed')",[appointment,client,ids.barber]);
    await race(()=>a.query("update public.appointments set status='pending' where id=$1",[appointment]),()=>b.query("select public.permanently_delete_barber($1,'Geovane')",[ids.barber]));
    assert.equal((await owner.query('select status from public.appointments where id=$1',[appointment])).rows[0].status,'pending');
  });
  await t.test('permanent deletion commits first: waiting booking is rejected with no orphan client',async()=>{
    await reset();const before=(await owner.query('select count(*)::int as n from public.clients')).rows[0].n;
    const client=(await owner.query('select id from public.clients limit 1')).rows[0].id,history=randomUUID();
    await a.query("insert into public.appointments(id,client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status) values($1,$2,$3,'2020-01-06','2020-01-06T09:00:00-03:00','2020-01-06T09:30:00-03:00',45,30,'cancelled')",[history,client,ids.barber]);
    const historicalRow=(await owner.query('select * from public.appointments where id=$1',[history])).rows[0];
    await race(()=>a.query("select public.permanently_delete_barber($1,'Geovane')",[ids.barber]),()=>book(b));
    assert.equal((await owner.query('select count(*)::int as n from public.barbers where id=$1',[ids.barber])).rows[0].n,0);
    assert.equal((await owner.query('select count(*)::int as n from public.appointments where barber_id=$1',[ids.barber])).rows[0].n,1);
    assert.deepEqual((await owner.query('select * from public.appointments where id=$1',[history])).rows[0],historicalRow);
    await assert.rejects(b.query("update public.appointments set status='confirmed' where id=$1",[history]),e=>e.code==='23514');
    assert.equal((await owner.query('select count(*)::int as n from public.clients')).rows[0].n,before);
  });
});
