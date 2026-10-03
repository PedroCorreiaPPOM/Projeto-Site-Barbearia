import test from 'node:test';
import assert from 'node:assert/strict';
import { barberPublication } from '../src/admin/barberPublication.js';
import { bookingApi } from '../src/lib/booking.js';
import { bookingDatabase, ids } from './helpers/booking-db.js';

test('publication: online is insufficient without hours; services determine booking readiness',()=>{
  const b={id:'test',active:true,booking_enabled:true,public_booking_key:'test'};
  const data={barber_hours:[],barber_services:[],services:[]};
  assert.equal(barberPublication(b,data).listed,false);
  data.barber_hours.push({barber_id:b.id});
  assert.equal(barberPublication(b,data).listed,true);
  assert.equal(barberPublication(b,data).ready,false);
  data.services.push({id:'cut',active:true});data.barber_services.push({barber_id:b.id,service_id:'cut'});
  assert.equal(barberPublication(b,data).ready,true);
  assert.equal(barberPublication({...b,active:false},data).listed,false);
  assert.equal(barberPublication({...b,booking_enabled:false},data).listed,false);
  data.barber_hours=[];
  data.barber_date_overrides=[{barber_id:b.id,local_date:'2030-01-02',periods:[{}]}];
  assert.equal(barberPublication(b,data,'2030-01-01').ready,true);
  assert.equal(barberPublication(b,data,'2030-01-03').ready,false);
});

test('public RPCs agree for generated keys, missing hours, missing services and anonymous permissions',async t=>{
  const {db}=await bookingDatabase();t.after(()=>db.close());
  await db.query('update public.barbers set booking_enabled=true,public_booking_key=null where id=$1',[ids.other]);
  await db.exec('set role anon');
  const catalog=async()=>(await db.query('select public.public_booking_catalog() as catalog')).rows[0].catalog;
  assert.ok(!(await catalog()).some(b=>b.id===ids.other));
  await db.exec(`reset role; set test.uid='${ids.admin}';set test.aal='aal2'`);
  await db.query('select public.save_barber_schedule($1,1,$2)',[ids.other,JSON.stringify([{opens_at:'09:00',closes_at:'12:00'}])]);
  await db.exec('set role anon');
  const result=await catalog();
  assert.equal(result.find(b=>b.id===ids.other).booking_key,ids.other);
  assert.deepEqual(result.find(b=>b.id===ids.other).services,[]);
  const keys=(await db.query('select * from public.public_booking_barbers()')).rows.map(r=>r.booking_key).sort();
  assert.deepEqual(keys,result.map(b=>b.booking_key).sort());
  assert.deepEqual((await db.query('select * from public.barbers')).rows,[]);
});

test('catalog fetch distinguishes empty success, HTTP error and malformed deployment response',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[]}));
  assert.deepEqual(await bookingApi('catalog'),[]);
  for(const payload of ['<html>SPA fallback</html>','null','{}','{"data":null}','{"data":[{}]}']) {
    globalThis.fetch=async()=>new Response(payload);
    await assert.rejects(bookingApi('catalog'),/consultar/);
  }
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'Serviço indisponível'}),{status:503});
  await assert.rejects(bookingApi('catalog'),error=>error.status===503 && error.message==='Serviço indisponível');
});
