import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bookingDatabase,ids} from './helpers/booking-db.js';
import {leadDisplay,leadMinutes,leadSettings,inferLeadUnit} from '../src/lib/reminder-lead-units.js';
import {runAction} from '../netlify/functions/admin-api.mjs';

test('lead units: deterministic formatting and exact bounded decimal parsing',()=>{
  for(const [minutes,unit,expected] of [[60,'hours','1'],[120,'hours','2'],[1440,'days','1'],[2880,'days','2'],[10080,'days','7'],[10080,'hours','168'],[1440,'hours','24'],[120,'days','0.0833']])assert.equal(leadDisplay(minutes,unit),expected);
  assert.equal(leadMinutes('1.1','hours'),66);assert.equal(leadMinutes('1,5','hours'),90);assert.equal(leadMinutes('0.0625','days'),90);
  for(const value of [-1,0,NaN,Infinity,'',' ','-1','1e2','0x10','7.71876923','0.0833',null,{},true])assert.equal(leadMinutes(value,'days'),null,`${value}`);
  assert.equal(leadMinutes('14','minutes'),null);assert.equal(leadMinutes('10081','minutes'),null);assert.equal(leadMinutes('8','days'),null);assert.equal(leadMinutes('1','weeks'),null);
  for(let minutes=15;minutes<=10080;minutes++)for(const unit of ['minutes','hours','days']){
    const shown=leadDisplay(minutes,unit);assert.match(shown,/^\d+(?:\.\d{1,4})?$/);
    assert.ok(Math.abs(Number(shown)-minutes/({minutes:1,hours:60,days:1440}[unit]))<=0.00005000001);
  }
  assert.equal(inferLeadUnit(10080),'days');assert.equal(inferLeadUnit(120),'hours');assert.equal(inferLeadUnit(90),'minutes');
  assert.equal(leadSettings({client_minutes:10080,barber_minutes:120}).client_value,'7');
});

test('011 preserves independent units, old RPC, limits, RLS/MFA and existing messages',async t=>{
  const {db}=await bookingDatabase();t.after(()=>db.close());
  for(const name of ['202609300009_appointment_reminders','202609300010_reminder_personalization'])await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  await db.exec('select public.save_reminder_settings(false,false,10080,120)');
  const before=(await db.query('select * from public.reminder_settings')).rows[0];
  await db.exec(await readFile(new URL('../supabase/checks/preflight_011.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202610030011_reminder_lead_units.sql',import.meta.url),'utf8'));
  const get=async()=>(await db.query('select * from public.reminder_settings')).rows[0];
  assert.deepEqual(await get(),{...before,client_unit:'days',barber_unit:'hours'});
  await db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2'`);
  await db.exec("select public.save_reminder_settings(false,false,10080,120,'days','hours')");
  let settings=leadSettings(await get());assert.equal(settings.client_value,'7');assert.equal(settings.client_unit,'days');assert.equal(settings.barber_value,'2');assert.equal(settings.barber_unit,'hours');
  await db.exec("select public.save_reminder_settings(false,false,120,10080,'days','minutes')");
  settings=leadSettings(await get());assert.equal(settings.client_minutes,120);assert.equal(settings.client_value,'0.0833');assert.equal(settings.barber_value,'10080');
  await db.exec('select public.save_reminder_settings(false,false,60,1440)');
  assert.equal((await get()).client_unit,'days');assert.equal((await get()).barber_unit,'minutes','legacy API preserves chosen units');
  const stable=await get();
  for(const sql of ["select public.save_reminder_settings(false,false,120,60,'weeks','hours')","select public.save_reminder_settings(false,false,120,60,null,'hours')","select public.save_reminder_settings(false,false,0,60,'days','hours')","select public.save_reminder_settings(false,false,10081,60,'days','hours')"]){await assert.rejects(()=>db.exec(sql));assert.deepEqual(await get(),stable);}
  await assert.rejects(()=>db.exec("update public.reminder_settings set client_unit='days'"),e=>e.code==='42501');
  for(const [role,user,aal] of [['anon',ids.admin,'aal2'],['authenticated',ids.other,'aal2'],['authenticated',ids.admin,'aal1']]){
    await db.exec(`set role ${role};set test.uid='${user}';set test.aal='${aal}'`);
    await assert.rejects(()=>db.exec("select public.save_reminder_settings(false,false,120,60,'days','hours')"),e=>e.code==='42501');
  }
});

test('API passes valid units, supports missing legacy units and rejects invalid durations/units',async()=>{
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:null};}};
  const input={client_enabled:true,barber_enabled:false,client_minutes:10080,barber_minutes:120,client_unit:'days',barber_unit:'hours'};
  await runAction(db,'save_reminder_settings',input);assert.equal(calls[0].args.p_client_unit,'days');assert.equal(calls[0].args.p_barber_unit,'hours');
  await runAction(db,'save_reminder_settings',{...input,client_unit:undefined,barber_unit:undefined});assert.equal(Object.hasOwn(calls[1].args,'p_client_unit'),false);
  for(const override of [{client_unit:'weeks'},{client_unit:null},{client_unit:undefined},{client_minutes:Infinity},{client_minutes:NaN},{client_minutes:0},{client_minutes:14},{client_minutes:10081},{client_minutes:120.001}])await assert.rejects(()=>runAction(db,'save_reminder_settings',{...input,...override}));
  assert.equal(calls.length,2);
});
