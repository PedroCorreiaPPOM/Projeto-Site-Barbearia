import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {bookingDatabase,ids} from './helpers/booking-db.js';
import {draftFromSnapshot} from '../src/admin/barberDraft.js';
import {renderMessage,validateMessage,MESSAGE_EXAMPLE} from '../src/lib/reminder-messages.js';
import {bookingAction} from '../netlify/functions/booking.mjs';

test('010: scoped public consent, atomic barber profile and immutable simulated message',async t=>{
  const {db}=await bookingDatabase();t.after(()=>db.close());
  for(const name of ['202609300009_appointment_reminders','202609300010_reminder_personalization']){
    const sql=await readFile(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
    try{await db.exec(sql);}catch(e){throw new Error(`${name}: ${e.message} near ${sql.slice(Number(e.position)-100,Number(e.position)+100)}`,{cause:e});}
  }
  await db.exec(await readFile(new URL('../supabase/checks/preflight_010.sql',import.meta.url),'utf8'));
  const day=(await db.query("select ((now() at time zone 'America/Fortaleza')::date+1)::text as day")).rows[0].day;
  await db.query(`insert into public.barber_date_overrides(barber_id,local_date,periods) values($1,$2,'[{"opens_at":"09:00","closes_at":"18:00","breaks":[]}]')`,[ids.barber,day]);
  await db.exec('select public.save_reminder_settings(true,false,10080,60)');
  const key=randomUUID();
  const book=(key,hour,consent)=>db.query("select public.create_public_booking($1,$2,$3,$4,'Pedro Real','+5585999999999',true,$5) as receipt",[key,ids.barber,[ids.cut],`${day}T${hour}:00-03:00`,consent]);
  await db.exec('set role anon');
  const first=(await book(key,'09:00',true)).rows[0].receipt;
  assert.deepEqual((await book(key,'09:00',true)).rows[0].receipt,first);
  await assert.rejects(()=>book(key,'09:00',false),e=>e.code==='22023');
  const second=(await book(randomUUID(),'10:00',false)).rows[0].receipt;
  await assert.rejects(()=>db.exec("select public.save_reminder_messages('test','test')"),e=>e.code==='42501');
  await assert.rejects(()=>db.exec('select rendered_message from public.appointment_reminders'),e=>e.code==='42501');
  await db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2'`);
  const q=(await db.query('select * from public.appointment_reminders')).rows;assert.equal(q.length,1);assert.equal(q[0].appointment_id,first.id);
  const appointments=(await db.query('select * from public.appointments order by starts_at')).rows;
  assert.equal(appointments[0].whatsapp_reminder_consent,true);assert.ok(appointments[0].reminder_consent_at);assert.equal(appointments[1].whatsapp_reminder_consent,false);
  assert.equal((await db.query('select whatsapp_reminder_consent from public.clients')).rows[0].whatsapp_reminder_consent,false,'public opt-in never changes global consent for other reservations');
  await db.query('select public.save_reminder_messages($1,$2)',['Olá {cliente}, {barbeiro}, {data} {horario}, {servicos}: {duracao} min','Olá {barbeiro}']);
  for(const text of ['{segredo}','{{cliente}}','{cliente','', '\n\t', 'x'.repeat(1501)])await assert.rejects(()=>db.query('select public.save_reminder_messages($1,$2)',[text,'Teste']),e=>e.code==='22023');
  await db.exec('set role service_role');
  const job=(await db.query('select public.claim_appointment_reminder(true) as job')).rows[0].job;
  assert.match(job.rendered_message,/Pedro Real/);assert.match(job.rendered_message,/09:00/);assert.match(job.rendered_message,/Corte: 30 min/);
  await db.query("select public.finish_appointment_reminder($1,$2,'accepted',null)",[job.id,job.claim_token]);
  await db.exec(`set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2'`);
  await db.query('select public.save_reminder_messages($1,$2)',['Outro texto','Outro barbeiro']);
  assert.equal((await db.query('select rendered_message from public.appointment_reminders where id=$1',[job.id])).rows[0].rendered_message,job.rendered_message);
  const snapshot=(await db.query('select public.barber_editor_snapshot($1) as s',[ids.barber])).rows[0].s;
  const profile=draftFromSnapshot(snapshot);profile.notification_phone='+5585988888888';profile.notification_consent=true;
  await db.query('select public.save_barber_profile($1,$2,$3)',[ids.barber,JSON.stringify(profile),JSON.stringify(snapshot)]);
  assert.equal((await db.query('select notification_phone from public.barbers where id=$1',[ids.barber])).rows[0].notification_phone,profile.notification_phone);
  const current=(await db.query('select public.barber_editor_snapshot($1) as s',[ids.barber])).rows[0].s;
  await assert.rejects(()=>db.query('select public.save_barber_profile($1,$2,$3)',[ids.barber,JSON.stringify({...profile,notification_phone:'geovane'}),JSON.stringify(current)]),e=>e.code==='22023');
  assert.deepEqual((await db.query('select public.barber_editor_snapshot($1) as s',[ids.barber])).rows[0].s,current);
  await db.exec("set test.aal='aal1'");await assert.rejects(()=>db.exec("select public.save_reminder_messages('test','test')"),e=>e.code==='42501');
  await db.exec("set test.aal='aal2'");
  const client=(await db.query('select client_id from public.appointments where id=$1',[first.id])).rows[0].client_id;
  await db.query('select public.revoke_client_reminder_consent($1)',[client]);
  assert.equal((await db.query('select whatsapp_reminder_consent from public.appointments where id=$1',[first.id])).rows[0].whatsapp_reminder_consent,false);
  assert.equal((await db.query('select whatsapp_reminder_consent from public.appointments where id=$1',[second.id])).rows[0].whatsapp_reminder_consent,false);
  await db.exec('reset role');
  assert.equal((await db.query("select public.render_reminder_message('{cliente} {barbeiro}',$1) as text",[JSON.stringify({cliente:'{barbeiro}',barbeiro:'Real'})])).rows[0].text,'{barbeiro} Real','values are not recursively expanded');
  assert.equal((await db.query("select has_function_privilege('authenticated','public.claim_appointment_reminder_009(boolean)','execute') as allowed")).rows[0].allowed,false);
});
test('message variables validate strictly and rendering never treats data as markup or placeholders',()=>{
  assert.equal(renderMessage('{cliente} {duracao}',MESSAGE_EXAMPLE),'Pedro (exemplo) 60');
  assert.equal(renderMessage('{cliente} {barbeiro}',{cliente:'{barbeiro}',barbeiro:'<script>'}),'{barbeiro} <script>');
  for(const text of ['{foo}','{{cliente}}','{data','horario}',''])assert.throws(()=>validateMessage(text));
  assert.throws(()=>renderMessage('{cliente}',{}));
});
test('public API only accepts explicit boolean WhatsApp consent',async()=>{
  let args;const db={rpc:async(_,input)=>{args=input;return {data:{}};}};
  const input={request_id:randomUUID(),barber_id:ids.barber,service_ids:[ids.cut],starts_at:'2099-01-01T12:00:00Z',full_name:'Pedro Real',phone:'+5585999999999',contact_consent:true};
  await bookingAction(db,'create',input);assert.equal(args.p_whatsapp_consent,false);
  await bookingAction(db,'create',{...input,whatsapp_consent:true});assert.equal(args.p_whatsapp_consent,true);
  await assert.rejects(()=>bookingAction(db,'create',{...input,whatsapp_consent:'true'}),/inválido/);
});
