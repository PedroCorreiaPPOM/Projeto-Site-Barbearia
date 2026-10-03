import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { bookingDatabase,ids } from './helpers/booking-db.js';
import { cleanupBarberPhotos,runAction,createAdminHandler } from '../netlify/functions/admin-api.mjs';
import { barberHistoryFor,historicalBarberOptions } from '../src/admin/barberHistory.js';

test('008 upgrades existing history without changing appointment rows and rejects new cascade dependencies',async t=>{
  const {db}=await bookingDatabase(undefined,{applyPermanentDelete:false});t.after(()=>db.close());
  const client=randomUUID(),appointment=randomUUID();
  await db.query("insert into public.clients(id,full_name,phone_e164) values($1,'Existing Client','+5585999999999')",[client]);
  await db.query("insert into public.appointments(id,client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status) values($1,$2,$3,'2020-01-06','2020-01-06T09:00:00-03:00','2020-01-06T09:30:00-03:00',45,30,'completed')",[appointment,client,ids.barber]);
  const before=(await db.query('select * from public.appointments')).rows;
  await db.exec(await readFile(new URL('../supabase/migrations/202609290008_barber_permanent_delete.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('select * from public.appointments')).rows,before);
  assert.equal((await db.query('select * from public.barber_history_ids')).rows.length,2);
  await db.exec('alter table public.appointments add constraint unexpected_cascade foreign key(barber_id) references public.barbers(id) on delete cascade');
  await assert.rejects(()=>db.query("select public.permanently_delete_barber($1,'Geovane')",[ids.barber]),e=>e.code==='23514');
  await db.exec('alter table public.appointments drop constraint unexpected_cascade');
  await db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2'`);
  await db.query("select public.permanently_delete_barber($1,'Geovane')",[ids.barber]);
  assert.deepEqual((await db.query('select * from public.appointments')).rows,before);
});

test('permanent deletion: references, history, grants, audit and tracked Storage cleanup',async t=>{
  const {db,day}=await bookingDatabase();t.after(()=>db.close());
  await db.exec('alter table auth.users add column raw_user_meta_data jsonb');
  await db.exec(await readFile(new URL('../supabase/checks/preflight_008.sql',import.meta.url),'utf8'));
  const remove=(id=ids.barber,name='Geovane')=>db.query('select public.permanently_delete_barber($1,$2) as result',[id,name]);
  const admin=()=>db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2'`);
  async function isolated(name,fn){await t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});}
  async function rejects(fn,code){await db.exec('savepoint rejected');await assert.rejects(fn,e=>e.code===code);await db.exec('rollback to savepoint rejected');}
  await isolated('allowed deletion explicitly removes owned rows and preserves others',async()=>{
    const hour=(await db.query('select id from public.barber_hours where barber_id=$1 limit 1',[ids.barber])).rows[0].id;
    await db.query("insert into public.barber_breaks(barber_hour_id,starts_at,ends_at) values($1,'10:00','10:15')",[hour]);
    await db.query("insert into public.barber_date_overrides(barber_id,local_date,periods) values($1,$2,'[]')",[ids.barber,day]);
    await db.query("insert into public.schedule_blocks(barber_id,starts_at,ends_at,kind) values($1,$2,$3,'block')",[ids.barber,`${day}T10:00:00-03:00`,`${day}T11:00:00-03:00`]);
    await db.query("insert into storage.objects(id,bucket_id,name) values($1,'barber-photos',$2)",[randomUUID(),`${ids.barber}/old-photo.jpg`]);
    const services=(await db.query('select * from public.services order by id')).rows;
    const other=(await db.query('select * from public.barbers where id=$1',[ids.other])).rows;
    await admin();await remove();
    for(const table of ['barbers','barber_hours','barber_services','barber_date_overrides','schedule_blocks']) {
      assert.equal((await db.query(`select * from public.${table} where ${table==='barbers'?'id':'barber_id'}=$1`,[ids.barber])).rows.length,0);
    }
    assert.equal((await db.query('select * from public.barber_breaks where barber_hour_id=$1',[hour])).rows.length,0);
    assert.deepEqual((await db.query('select * from public.services order by id')).rows,services);
    assert.deepEqual((await db.query('select * from public.barbers where id=$1',[ids.other])).rows,other);
    assert.equal((await db.query("select * from public.admin_audit_log where entity_type='barbers' and entity_id=$1 and action='DELETE'",[ids.barber])).rows.length,1);
    const queue=(await db.query('select public.pending_barber_photo_cleanup() as result')).rows[0].result;
    assert.deepEqual(queue.paths.sort(),[`${ids.barber}/old-photo.jpg`,'public/geovane.jpg'].sort());
    assert.equal((await db.query("select * from storage.objects where name='public/geovane.jpg'")).rows.length,1,'SQL never deletes Storage metadata');
    await db.query('select public.complete_barber_photo_cleanup($1)',[queue.paths]);
    assert.equal((await db.query('select public.pending_barber_photo_cleanup() as result')).rows[0].result.pending,2);
    await rejects(()=>db.query("update public.barbers set photo_path='public/geovane.jpg' where id=$1",[ids.other]),'23514');
    await rejects(()=>db.query('insert into public.barbers(id,name) values($1,$2)',[ids.barber,'Reused namespace']),'23514');
    // Simulate Storage API completion in this isolated DB, then an old signed upload.
    await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='barber-photos' and name=any($1)",[queue.paths]);await admin();
    await db.query('select public.complete_barber_photo_cleanup($1)',[queue.paths]);
    assert.equal((await db.query('select public.pending_barber_photo_cleanup() as result')).rows[0].result.pending,0);
    await db.exec('reset role');await db.query("insert into storage.objects(id,bucket_id,name) values($1,'barber-photos',$2)",[randomUUID(),`${ids.barber}/late-upload.jpg`]);await admin();
    assert.deepEqual((await db.query('select public.pending_barber_photo_cleanup() as result')).rows[0].result.paths,[`${ids.barber}/late-upload.jpg`]);
  });
  for(const [status,future] of [['pending',true],['confirmed',true],['pending',false],['confirmed',false],['no_show',false],['completed',true],['cancelled',true]]) await isolated(`blocks unresolved/future ${status}, future=${future}`,async()=>{
    const client=randomUUID();await db.query('insert into public.clients(id,full_name,phone_e164) values($1,$2,$3)',[client,'Cliente Histórico','+5585999999999']);
    const date=future?day:'2020-01-06';
    await db.query('insert into public.appointments(client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status) values($1,$2,$3,$4,$5,45,30,$6)',[client,ids.barber,date,`${date}T09:00:00-03:00`,`${date}T09:30:00-03:00`,status]);
    const before=(await db.query('select * from public.appointments')).rows;
    await admin();await rejects(()=>remove(),'23514');
    assert.deepEqual((await db.query('select * from public.appointments')).rows,before);
    assert.equal((await db.query('select * from public.barber_deletions')).rows.length,0);
    assert.equal((await db.query('select * from public.clients where id=$1',[client])).rows.length,1);
  });
  for(const status of ['completed','cancelled']) await isolated(`preserves every historical ${status} row, original barber ID and verifiable actor`,async()=>{
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify(status==='completed'?{full_name:'Administradora Real'}:{}),ids.admin]);
    const client=randomUUID(),appointment=randomUUID();
    await db.query('insert into public.clients(id,full_name,phone_e164) values($1,$2,$3)',[client,'Cliente Histórico','+5585999999999']);
    await db.query("insert into public.appointments(id,client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status) values($1,$2,$3,'2020-01-06','2020-01-06T09:00:00-03:00','2020-01-06T09:30:00-03:00',45,30,$4)",[appointment,client,ids.barber,status]);
    await db.query("insert into public.appointment_services(appointment_id,service_id,service_name,price,duration_minutes) values($1,$2,'Nome histórico',45,30)",[appointment,ids.cut]);
    await db.query("insert into public.notifications(client_id,appointment_id,kind,channel) values($1,$2,'booking','sms')",[client,appointment]);
    const tables=['appointments','appointment_services','clients','services','notifications'];
    const before={};for(const table of tables)before[table]=(await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
    await admin();const start=Date.now();await remove();
    for(const table of tables)assert.deepEqual((await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows,before[table]);
    const record=(await db.query('select to_jsonb(d) as row from public.barber_deletions d where barber_id=$1',[ids.barber])).rows[0].row;
    assert.equal(record.barber_name,'Geovane');assert.equal(record.deleted_by,ids.admin);assert.ok(Date.parse(record.deleted_at)>=start-1000);
    assert.equal(record.deleted_by_name,status==='completed'?'Administradora Real':null);
    const report=(await db.query('select * from public.appointment_history where id=$1',[appointment])).rows[0];
    assert.equal(report.barber_id,ids.barber);assert.equal(report.barber_name,'Geovane');assert.equal(report.barber_deleted_by,ids.admin);assert.equal(report.total_price,'45.00');
    const data={barbers:[],barber_deletions:[record]};
    assert.ok(barberHistoryFor(report,data).message.includes(status==='completed'?'administrador Administradora Real.':`administrador UUID ${ids.admin}.`));
    assert.deepEqual(historicalBarberOptions(data),[{id:ids.barber,name:'Geovane (excluído)'}]);
    await rejects(()=>db.query("update public.appointments set status='pending' where id=$1",[appointment]),'23514');
    await rejects(()=>db.query('delete from public.appointments where id=$1',[appointment]),'23514');
    await rejects(()=>db.query('update public.appointment_services set price=1 where appointment_id=$1',[appointment]),'23514');
    await rejects(()=>db.query('delete from public.appointment_services where appointment_id=$1',[appointment]),'23514');
    await rejects(()=>db.query("update public.barber_deletions set deleted_by_name='Falso'"),'42501');
    await rejects(()=>db.query('delete from public.barber_history_ids where id=$1',[ids.barber]),'42501');
    await db.exec('set role anon');await rejects(()=>db.query('select * from public.appointment_history'),'42501');
    await db.exec(`set role authenticated;set test.uid='${randomUUID()}'`);assert.equal((await db.query('select * from public.appointment_history')).rows.length,0);
    await db.exec('reset role');await db.query('delete from auth.users where id=$1',[ids.admin]);
    assert.deepEqual((await db.query('select to_jsonb(d) as row from public.barber_deletions d where barber_id=$1',[ids.barber])).rows[0].row,record,'actor attribution survives removal of the administrator account');
  });
  await isolated('wrong name and unknown cascading reference fail before any deletion',async()=>{
    await admin();await rejects(()=>remove(ids.barber,'wrong'),'22023');
    await db.exec('reset role; create table public.unexpected_reference(id uuid references public.barbers(id) on delete cascade)');
    await db.query('insert into public.unexpected_reference values($1)',[ids.barber]);await admin();await rejects(()=>remove(),'23514');
    assert.equal((await db.query('select * from public.barbers where id=$1',[ids.barber])).rows.length,1);
    assert.equal((await db.query('select * from public.unexpected_reference')).rows.length,1);
  });
  await isolated('shared photos are preserved and direct table deletion is refused',async()=>{
    await db.query("update public.barbers set photo_path='public/geovane.jpg' where id=$1",[ids.other]);
    await admin();await rejects(()=>db.query('delete from public.barbers where id=$1',[ids.barber]),'42501');
    await remove();
    assert.deepEqual((await db.query('select public.pending_barber_photo_cleanup() as result')).rows[0].result.paths,[]);
    assert.equal((await db.query('select photo_path from public.barbers where id=$1',[ids.other])).rows[0].photo_path,'public/geovane.jpg');
  });
  for(const role of ['anon','non-admin','no-mfa']) await isolated(`rejects ${role}`,async()=>{
    await admin();
    if(role==='anon')await db.exec('set role anon');
    if(role==='non-admin')await db.exec(`set test.uid='${randomUUID()}'`);
    if(role==='no-mfa')await db.exec("set test.aal='aal1'");
    await rejects(()=>remove(),'42501');await rejects(()=>db.query('select public.pending_barber_photo_cleanup()'),'42501');
    await db.exec('reset role');assert.equal((await db.query('select * from public.barbers where id=$1',[ids.barber])).rows.length,1);
  });
});

test('API: Storage failure retains deletion success and supports retry without removing arbitrary paths',async()=>{
  const calls=[];let fail=true,removed=false;
  const db={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='permanently_delete_barber')return {data:{id:ids.barber,deleted:true}};
    if(name==='pending_barber_photo_cleanup')return {data:{paths:removed?[]:['reserved/photo.jpg'],pending:removed?0:1}};
    if(name==='complete_barber_photo_cleanup')return {data:null};
    throw new Error('unexpected RPC');
  },storage:{from:bucket=>({remove:async paths=>{assert.equal(bucket,'barber-photos');assert.deepEqual(paths,['reserved/photo.jpg']);if(fail)return {error:new Error('offline')};removed=true;return {data:[]};}})}};
  const result=await runAction(db,'permanently_delete_barber',{id:ids.barber,confirm_name:'Geovane',paths:['other/private.jpg']});
  assert.equal(result.deleted,true);assert.equal(result.photo_cleanup.pending,true);
  fail=false;assert.deepEqual(await cleanupBarberPhotos(db),{pending:false,remaining:0});
  assert.equal(calls.filter(c=>c.name==='permanently_delete_barber').length,1);
  await assert.rejects(runAction(db,'permanently_delete_barber',{id:'bad',confirm_name:'Geovane'}));
});

test('HTTP permanently deleting a barber requires admin authorization and MFA',async()=>{
  for(const reason of ['unauthenticated','not_admin','mfa_required']){
    const handler=createAdminHandler({authorize:async()=>({authorized:false,reason}),clientFactory:()=>{throw new Error('Must not reach database');}});
    const response=await handler({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action:'permanently_delete_barber',input:{id:ids.barber,confirm_name:'Geovane'}})});
    assert.equal(response.statusCode,reason==='unauthenticated'?401:403);
  }
});
