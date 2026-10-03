import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingDatabase,ids } from './helpers/booking-db.js';
import { draftFromSnapshot,copyWeek,noticeMinutes,normalizeDraft } from '../src/admin/barberDraft.js';
import { runAction } from '../netlify/functions/admin-api.mjs';

const periods=()=>[{opens_at:'09:00',closes_at:'12:00',breaks:[]},{opens_at:'14:00',closes_at:'20:00',breaks:[]}];
test('draft: independent copies, notice conversion, validation and loaded fields',()=>{
  const draft=draftFromSnapshot(null);draft.name='Novo Barbeiro';draft.week[1]=periods();
  const week=copyWeek(draft.week,1,[2,3,4,5,6]);
  week[2][0].opens_at='10:00';
  assert.equal(week[1][0].opens_at,'09:00');assert.equal(week[3][0].opens_at,'09:00');
  assert.equal(draft.week[2].length,0);
  assert.equal(copyWeek(week,1,[2])[2].length,2);
  assert.equal(noticeMinutes(1.5,60),90);assert.equal(noticeMinutes(2,1440),2880);
  assert.throws(()=>noticeMinutes(8,1440));assert.throws(()=>noticeMinutes('',1));assert.throws(()=>noticeMinutes(0.5,1));
  draft.booking_enabled=true;assert.throws(()=>normalizeDraft(draft,[],'2030-01-01'),/serviço ativo/);
  draft.services=[ids.cut];assert.doesNotThrow(()=>normalizeDraft(draft,[{id:ids.cut,active:true}],'2030-01-01'));
  draft.week[1][1].opens_at='11:00';assert.throws(()=>normalizeDraft(draft,[{id:ids.cut,active:true}],'2030-01-01'),/sobreposição/);
});

test('complete editor RPC: atomic create/edit, snapshots, RLS and public publication',async t=>{
  const {db,day}=await bookingDatabase();t.after(()=>db.close());
  await db.exec(`alter table storage.objects add column metadata jsonb;set role authenticated;set test.uid='${ids.admin}';set test.aal='aal2';`);
  const state=async id=>(await db.query('select public.barber_editor_snapshot($1) as state',[id])).rows[0].state;
  const save=async(id,profile,expected=null)=>(await db.query('select public.save_barber_profile($1,$2,$3) as saved',[id,JSON.stringify(profile),expected===null?null:JSON.stringify(expected)])).rows[0].saved;
  const complete=()=>{const p=draftFromSnapshot(null);p.name='Barbeiro Completo';p.description='Descrição';p.week[1]=periods();p.services=[ids.cut,ids.beard];p.booking_enabled=true;p.minimum_notice_minutes=90;return p;};
  const id=randomUUID();
  await t.test('opening/cancelling local draft creates no database rows',async()=>{
    draftFromSnapshot(null);assert.equal(await state(id),null);
  });
  await t.test('complete create publishes once with all associations and generated key',async()=>{
    const p=complete();p.overrides=[{local_date:day,periods:periods()}];
    const saved=await save(id,p);assert.equal(saved.public_booking_key,id);assert.equal(saved.minimum_notice_minutes,90);
    const snapshot=await state(id);assert.equal(snapshot.hours.length,2);assert.equal(snapshot.links.length,2);assert.equal(snapshot.overrides.length,1);
    assert.deepEqual(draftFromSnapshot(snapshot),p);
    await db.exec('set role anon');
    assert.ok((await db.query('select public.public_booking_catalog() as c')).rows[0].c.some(b=>b.id===id && b.services.length===2));
    await db.exec('set role authenticated');
    await assert.rejects(save(id,p),e=>e.code==='40001');
    assert.equal((await db.query('select count(*)::int as n from public.barbers where id=$1',[id])).rows[0].n,1);
  });
  await t.test('edit loads actual data; changes one day without replacing others',async()=>{
    const before=await state(id),p=draftFromSnapshot(before);p.name='Nome Editado';p.week=copyWeek(p.week,1,[2,3]);p.week[2][0].opens_at='10:00';p.services=[ids.cut];
    await save(id,p,before);
    const after=await state(id);assert.equal(after.barber.name,'Nome Editado');assert.equal(after.links.length,1);
    assert.ok(after.hours.some(h=>h.weekday===2 && h.opens_at==='10:00:00'));assert.ok(after.hours.some(h=>h.weekday===3 && h.opens_at==='09:00:00'));
    assert.deepEqual(after.hours.filter(h=>h.weekday===1),before.hours);
    await assert.rejects(save(id,p,before),e=>e.code==='40001');
  });
  await t.test('invalid services and incomplete online profile roll back entire creation',async()=>{
    for(const mutate of [p=>{p.services=[randomUUID()];},p=>{p.week=Array.from({length:7},()=>[]);},p=>{p.services=[];},p=>{p.week[1][1].opens_at='11:00';}]) {
      const newId=randomUUID(),p=complete();mutate(p);await assert.rejects(save(newId,p));assert.equal(await state(newId),null);
    }
    const newId=randomUUID(),p=complete();p.booking_enabled=false;p.week=Array.from({length:7},()=>[]);p.services=[];await save(newId,p);
    assert.ok(!(await db.query('select public.public_booking_catalog() as c')).rows[0].c.some(b=>b.id===newId));
  });
  await t.test('future reservations protect hours; failed edit leaves profile and services intact',async()=>{
    await db.query('select public.create_public_booking($1,$2,$3,$4,$5,$6,true)',[randomUUID(),ids.barber,[ids.cut],`${day}T09:00:00-03:00`,'Cliente Teste','+5585999999999']);
    const before=await state(ids.barber),p=draftFromSnapshot(before);p.name='Não pode salvar';p.services=[ids.beard];p.week[1]=[];
    await assert.rejects(save(ids.barber,p,before),e=>e.code==='23514');assert.deepEqual(await state(ids.barber),before);
    const valid=draftFromSnapshot(before);valid.description='Descrição atualizada';await save(ids.barber,valid,before);
    assert.equal((await state(ids.barber)).barber.description,valid.description);
  });
  await t.test('blocks validate conflicts atomically and foreign block IDs are rejected',async()=>{
    const before=await state(ids.barber),p=draftFromSnapshot(before);p.name='Revertido';p.blocks=[{kind:'block',starts_at:`${day}T09:00:00-03:00`,ends_at:`${day}T10:00:00-03:00`,reason:'Teste'}];
    await assert.rejects(save(ids.barber,p,before),e=>e.code==='23514');assert.deepEqual(await state(ids.barber),before);
    p.blocks[0].id=randomUUID();await assert.rejects(save(ids.barber,p,before),e=>e.code==='22023');
  });
  await t.test('legacy date override without breaks can be preserved while editing a reserved profile',async()=>{
    const newId=randomUUID(),p=complete();p.overrides=[{local_date:day,periods:[{opens_at:'09:00',closes_at:'12:00'}]}];await save(newId,p);
    await db.query('select public.create_public_booking($1,$2,$3,$4,$5,$6,true)',[randomUUID(),newId,[ids.cut],`${day}T09:00:00-03:00`,'Cliente Legado','+5585999999988']);
    const before=await state(newId),draft=draftFromSnapshot(before);draft.description='Novo texto';
    const profile=normalizeDraft(draft,[{id:ids.cut,active:true},{id:ids.beard,active:true}],day);
    await save(newId,profile,before);
    assert.deepEqual((await state(newId)).overrides,before.overrides);
  });
  await t.test('photo reference must be private uploaded valid object; failures leave no profile',async()=>{
    const photoId=randomUUID(),p=complete();p.photo_path=`${photoId}/${randomUUID()}.jpg`;
    await assert.rejects(save(photoId,p),e=>e.code==='23514');assert.equal(await state(photoId),null);
    await db.exec('reset role');await db.query('insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4)',[randomUUID(),'barber-photos',p.photo_path,JSON.stringify({mimetype:'image/jpeg',size:1000})]);await db.exec('set role authenticated');
    await save(photoId,p);assert.equal((await state(photoId)).barber.photo_path,p.photo_path);
  });
  await t.test('anonymous, non-admin and administrator without MFA cannot save',async()=>{
    await db.exec('set role anon');await assert.rejects(save(randomUUID(),complete()),e=>e.code==='42501');
    await db.exec("set role authenticated;set test.aal='aal1'");await assert.rejects(save(randomUUID(),complete()),e=>e.code==='42501');
    await db.exec(`set test.aal='aal2';set test.uid='${randomUUID()}'`);await assert.rejects(save(randomUUID(),complete()),e=>e.code==='42501');
  });
});

test('admin API forwards complete profile and expected snapshot through one RPC',async()=>{
  const id=randomUUID(),profile={name:'Teste'},expected={barber:{id}};
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{id}};}};
  assert.deepEqual(await runAction(db,'save_barber_profile',{id,profile,expected}),{id});
  assert.deepEqual(calls,[{name:'save_barber_profile',args:{p_id:id,p_profile:profile,p_expected:expected}}]);
  await assert.rejects(runAction(db,'save_barber_profile',{id:'invalid',profile}));assert.equal(calls.length,1);
});
