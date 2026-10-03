import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {bookingDatabase,ids} from './helpers/booking-db.js';
import {processReminders,sendReminder,templateBody,metaReady} from '../netlify/lib/reminder-worker.mjs';
import {runAction} from '../netlify/functions/admin-api.mjs';

test('reminder queue: scheduling, consent, revisions, RLS and retries',async t=>{
  const {db}=await bookingDatabase();t.after(()=>db.close());
  await db.exec(await readFile(new URL('../supabase/checks/preflight_009.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609300009_appointment_reminders.sql',import.meta.url),'utf8'));
  const day=(await db.query("select ((now() at time zone 'America/Fortaleza')::date+1)::text as day")).rows[0].day;
  await db.query(`insert into public.barber_date_overrides(barber_id,local_date,periods) values($1,$2,'[{"opens_at":"09:00","closes_at":"18:00","breaks":[]}]')`,[ids.barber,day]);
  await db.query("select public.create_public_booking($1,$2,$3,$4,'Cliente Real','+5585999999999',true)",[randomUUID(),ids.barber,[ids.cut],`${day}T09:00:00-03:00`]);
  const appt=(await db.query('select * from public.appointments')).rows[0];
  const rows=async()=>(await db.query('select * from public.appointment_reminders order by recipient_type')).rows;
  const settings=()=>db.exec('select public.save_reminder_settings(true,true,1440,60)');
  const contacts=()=>db.exec(`update public.clients set whatsapp_reminder_consent=true;update public.barbers set notification_phone='+5585988888888',notification_consent=true where id='${ids.barber}'`);
  const due=()=>db.exec("update public.reminder_settings set client_minutes=10080,barber_minutes=10080;update public.appointment_reminders set next_attempt_at=null");
  const claim=async()=>(await db.query('select public.claim_appointment_reminder(true) as q')).rows[0].q;
  const finish=(q,result)=>db.query('select public.finish_appointment_reminder($1,$2,$3,null)',[q.id,q.claim_token,result]);
  async function isolated(name,fn){await t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});}
  async function rejects(fn,code){await db.exec('savepoint expected_error');await assert.rejects(fn,e=>e.code===code);await db.exec('rollback to savepoint expected_error');}
  await isolated('booking contact consent is not WhatsApp consent; disabled defaults send nothing',async()=>{
    await settings();assert.equal((await rows()).length,0);await contacts();assert.equal((await rows()).length,2);
  });
  await isolated('different lead times, duplicate requests and configuration edits are idempotent',async()=>{
    await contacts();await settings();await settings();const q=await rows();assert.equal(q.length,2);
    assert.equal(Date.parse(appt.starts_at)-Date.parse(q[0].scheduled_at),60*60000);
    assert.equal(Date.parse(appt.starts_at)-Date.parse(q[1].scheduled_at),1440*60000);
    await db.exec('select public.save_reminder_settings(true,true,30,4320)');
    assert.equal((await rows()).length,2);assert.equal(Date.parse(appt.starts_at)-Date.parse((await rows())[0].scheduled_at),4320*60000);
    await rejects(()=>db.exec('select public.save_reminder_settings(true,true,10,60)'),'23514');
  });
  await isolated('rescheduling cancels old revision and creates exactly two new reminders',async()=>{
    await contacts();await settings();await db.query("update public.appointments set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour' where id=$1",[appt.id]);
    const q=await rows();assert.equal(q.filter(x=>x.status==='cancelled').length,2);assert.equal(q.filter(x=>x.status==='pending'&&x.revision===2).length,2);
  });
  for(const status of ['cancelled','completed','no_show'])await isolated(`${status} cancels pending reminders`,async()=>{
    await contacts();await settings();await db.query('update public.appointments set status=$1 where id=$2',[status,appt.id]);assert.ok((await rows()).every(x=>x.status==='cancelled'));
  });
  await isolated('revoking consent and disabling recipients cancels queue',async()=>{
    await contacts();await settings();await db.exec('update public.clients set whatsapp_reminder_consent=false');
    assert.equal((await rows()).find(x=>x.recipient_type==='client').status,'cancelled');
    await db.exec('select public.save_reminder_settings(false,false,1440,60)');assert.ok((await rows()).every(x=>x.status==='cancelled'));
  });
  await isolated('changing client phone resets consent and cancels old destination',async()=>{
    await contacts();await settings();await db.exec("update public.clients set phone_e164='+5585977777777'");
    assert.equal((await db.query('select whatsapp_reminder_consent from public.clients')).rows[0].whatsapp_reminder_consent,false);
    assert.equal((await rows()).find(x=>x.recipient_type==='client').status,'cancelled');
  });
  await isolated('claim owns one attempt, blocks appointment edits, sanitizes outcomes and limits retry',async()=>{
    await contacts();await settings();await due();const q=await claim();assert.equal(q.attempts,1);assert.equal(q.status,'processing');
    await rejects(()=>db.query("update public.appointments set status='cancelled' where id=$1",[appt.id]),'40001');
    await finish(q,'temporary');assert.equal((await rows()).find(x=>x.id===q.id).status,'retry');
    assert.ok(Date.parse((await rows()).find(x=>x.id===q.id).next_attempt_at)>Date.now());
    await db.query("update public.appointment_reminders set status='cancelled' where id<>$1",[q.id]);
    // Prevent another recipient being recreated during sync.
    await db.exec(`update public.reminder_settings set ${q.recipient_type==='barber'?'client':'barber'}_enabled=false`);
    for(let n=2;n<=4;n++){await due();const next=await claim();assert.equal(next.id,q.id);assert.equal(next.attempts,n);await finish(next,'temporary');}
    assert.equal((await rows()).find(x=>x.id===q.id).error_code,'ATTEMPT_LIMIT');assert.equal(await claim(),null);
  });
  await isolated('permanent or uncertain failures never automatically resend',async()=>{
    await contacts();await settings();await due();await finish(await claim(),'permanent');const second=await claim();await finish(second,'unknown');assert.equal(await claim(),null);
    assert.ok((await rows()).every(x=>x.status==='failed'&&x.attempts===1));
  });
  await isolated('expired worker lease is uncertain, never requeued',async()=>{
    await contacts();await settings();await due();const q=await claim();await db.query("update public.appointment_reminders set lease_until=now()-interval '1 second' where id=$1",[q.id]);await db.exec('select public.sync_appointment_reminders()');
    assert.equal((await rows()).find(x=>x.id===q.id).error_code,'OUTCOME_UNKNOWN');
  });
  await isolated('dry run processes persistent queue without any Meta call',async()=>{
    await contacts();await settings();await due();
    const adapter={rpc:async(name,args)=>{try{const result=name==='claim_appointment_reminder'?await db.query('select public.claim_appointment_reminder($1) as result',[args.p_simulated]):await db.query('select public.finish_appointment_reminder($1,$2,$3,$4) as result',[args.p_id,args.p_token,args.p_result,args.p_provider_id]);return {data:result.rows[0].result};}catch(error){return {error};}}};
    const result=await processReminders(adapter,{},()=>{throw new Error('Network forbidden');});assert.equal(result.state,'dry-run');assert.equal(result.processed,1);
    const q=(await rows()).find(x=>x.status==='sent');assert.equal(q.simulated,true);assert.equal(q.provider_id,null);assert.ok(q.sent_at);
  });
  await isolated('anonymous, non-admin and missing MFA cannot write settings or queue or claim',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role};set test.uid='${randomUUID()}';set test.aal='aal2'`);
      await rejects(()=>db.exec('select public.save_reminder_settings(true,true,60,60)'),'42501');
      await rejects(()=>db.exec("update public.appointment_reminders set status='sent'"),'42501');
      await rejects(()=>db.exec('select public.claim_appointment_reminder(true)'),'42501');
      if(role==='authenticated')assert.equal((await rows()).length,0);
      await db.exec('reset role');
    }
    await db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal1'`);
    await rejects(()=>settings(),'42501');await db.exec("set test.aal='aal2'");await settings();
    await rejects(()=>db.exec('select public.claim_appointment_reminder(true)'),'42501');
    await db.exec('set role service_role');assert.equal(await claim(),null);
  });
});

const env={WHATSAPP_REMINDERS_MODE:'live',META_WHATSAPP_TOKEN:'test-only',META_WHATSAPP_PHONE_NUMBER_ID:'123',META_GRAPH_VERSION:'v99.0',META_CLIENT_REMINDER_TEMPLATE:'client_template',META_BARBER_REMINDER_TEMPLATE:'barber_template',META_TEMPLATE_LANGUAGE:'pt_BR'};
const job={recipient_type:'client',recipient_phone:'+5585999999999',lease_until:new Date(Date.now()+120000).toISOString(),payload:{client_name:'Pedro',barber_name:'Geovane',starts_at:'2099-10-01T19:30:00Z',duration_minutes:60,services:'Corte e barba'}};
test('official provider adapter: Fortaleza, templates, missing credentials, dry run, retries and sanitized errors',async()=>{
  assert.ok(metaReady(env));assert.match(templateBody(job,env).template.components[0].parameters[2].text,/16:30/);
  assert.equal(templateBody({...job,recipient_type:'barber'},env).template.components[0].parameters.length,5);
  assert.deepEqual(await processReminders({rpc(){throw new Error('must not claim');}},{WHATSAPP_REMINDERS_MODE:'live'}),{processed:0,state:'configuration_missing'});
  assert.equal((await sendReminder(job,{},()=>{throw new Error('no calls');})).result,'accepted');
  for(const [status,result] of [[429,'temporary'],[400,'permanent'],[401,'permanent'],[500,'unknown']]){
    const outcome=await sendReminder(job,env,async()=>({status,ok:false,json:async()=>({error:{message:'secret token personal data'}})}));assert.deepEqual(outcome,{result});
  }
  assert.deepEqual(await sendReminder(job,env,async()=>{throw new Error('timeout secret');}),{result:'unknown'});
  assert.equal((await sendReminder(job,env,async()=>({status:400,ok:false,json:async()=>({error:{code:130429}})}))).result,'temporary');
  assert.deepEqual(await sendReminder({...job,lease_until:'2020-01-01T00:00:00Z'},env,()=>{throw new Error('must not send expired claim');}),{result:'unknown'});
  assert.equal((await sendReminder(job,env,async(url,options)=>{assert.ok(url.startsWith('https://graph.facebook.com/'));assert.equal(JSON.parse(options.body).type,'template');return {ok:true,json:async()=>({messages:[{id:'wamid.test'}]})};})).providerId,'wamid.test');
});
test('administrative API validates minutes and notification phones before DB writes',async()=>{
  const db={rpc(){throw new Error('must not write');},from(){throw new Error('must not write');}};
  await assert.rejects(()=>runAction(db,'save_reminder_settings',{client_enabled:true,barber_enabled:true,client_minutes:10,barber_minutes:60}),/15/);
  await assert.rejects(()=>runAction(db,'save_reminder_contact',{id:ids.barber,kind:'barber',consent:true,phone:'geovane'}),/telefone/);
});
