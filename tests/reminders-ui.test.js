import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {build} from 'esbuild';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';

test('reminder UI converts units, blocks double submit and labels simulations',async t=>{
  const target=new URL(`./.reminders-ui-${process.pid}.mjs`,import.meta.url);
  const bundle=await build({entryPoints:['src/admin/Reminders.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
  await writeFile(target,bundle.outputFiles[0].text);t.after(()=>unlink(target));
  const {default:Reminders,minutesFrom}=await import(target.href);
  for(const [n,u,result] of [[30,1,30],[1.5,60,90],[2,1440,2880],[0,1,null],[8,1440,null]])assert.equal(minutesFrom(n,u),result);
  let release,view;const writes=[],reads=[];
  const overview={mode:'dry-run',configured:false,worker_configured:false,settings:{client_enabled:true,barber_enabled:false,client_minutes:1440,barber_minutes:60},history:[{id:'one',recipient_name:'Cliente',recipient_phone:'+5585999999999',recipient_type:'client',status:'sent',simulated:true,attempts:1,scheduled_at:'2026-09-30T19:30:00Z',sent_at:'2026-09-30T19:30:00Z'}]};
  const api=async(action,input)=>{if(action==='reminder_overview'){reads.push(input);return overview;}writes.push({action,input});return new Promise(resolve=>release=resolve);};
  await act(async()=>{view=Renderer.create(React.createElement(Reminders,{api,data:{barbers:[],clients:[]},onChanged:async()=>{}}));});
  t.after(()=>act(()=>view.unmount()));
  const unit=()=>view.root.findAllByType('select').find(x=>x.props['aria-label']==='Antecedência para clientes: unidade');
  const value=()=>view.root.findAllByType('input').find(x=>x.props['aria-label']==='Antecedência para clientes: valor');
  await act(async()=>unit().props.onChange({target:{value:'60'}}));
  await act(async()=>value().props.onChange({target:{value:'1.5'}}));
  assert.equal(value().props.value,1.5);
  const form=view.root.findAllByType('form')[0];
  await act(async()=>{form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});});
  assert.equal(writes.length,1);assert.equal(writes[0].input.client_minutes,90);
  assert.ok(JSON.stringify(view.toJSON()).includes('SIMULADO'));
  await act(async()=>release(true));assert.equal(reads.length,2);
  assert.ok(!JSON.stringify(view.toJSON()).includes('Destinatários e consentimento'));
  assert.equal(view.root.findAllByType('textarea').length,2);
  assert.ok(JSON.stringify(view.toJSON()).includes('dados fictícios de exemplo'));
});

test('message editor inserts at cursor and rejects unknown placeholders',async t=>{
  const target=new URL(`./.message-editor-${process.pid}.mjs`,import.meta.url);
  const bundle=await build({entryPoints:['src/admin/ReminderMessageEditor.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
  await writeFile(target,bundle.outputFiles[0].text);t.after(()=>unlink(target));
  const {default:Editor}=await import(target.href);
  const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();t.after(()=>{globalThis.requestAnimationFrame=previous;});
  let changed,view;const node={selectionStart:4,selectionEnd:4,focus(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  await act(async()=>{view=Renderer.create(React.createElement(Editor,{label:'Cliente',value:'Olá !',onChange:v=>changed=v}),{createNodeMock:()=>node});});
  t.after(()=>act(()=>view.unmount()));
  await act(async()=>view.root.findAllByType('button')[0].props.onClick());
  assert.equal(changed,'Olá {cliente}!');assert.equal(node.selectionStart,13);
  await act(async()=>view.update(React.createElement(Editor,{label:'Cliente',value:'{inexistente}',onChange(){}})));
  assert.equal(view.root.findAllByProps({role:'alert'}).length,1);
});

test('public booking consent is optional, starts unchecked and resets for another reservation',async t=>{
  const target=new URL(`./.booking-consent-${process.pid}.mjs`,import.meta.url);
  const bundle=await build({entryPoints:['src/components/Agendamento.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty','.png':'dataurl','.jpg':'dataurl'}});
  await writeFile(target,bundle.outputFiles[0].text);t.after(()=>unlink(target));
  const {default:Booking}=await import(target.href);
  const previous=globalThis.fetch,requests=[];
  const day=new Date(Date.now()+86400000).toISOString().slice(0,10),slot={starts_at:`${day}T12:00:00Z`,ends_at:`${day}T12:30:00Z`};
  globalThis.fetch=async(_,options)=>{const {action,input}=JSON.parse(options.body);if(action==='create')requests.push(input);return {ok:true,json:async()=>({data:action==='availability'?{slots:[slot],total_price:45,total_duration_minutes:30}:{id:'receipt',barber_name:'Geovane',services:[{name:'Corte'}],...slot,total_price:45,total_duration_minutes:30}})};};
  t.after(()=>{globalThis.fetch=previous;});
  const catalog={barbers:[{id:'barber',name:'Geovane',booking_horizon_days:60,services:[{id:'cut',name:'Corte',price:45,duration_minutes:30}]}]};let view;
  await act(async()=>{view=Renderer.create(React.createElement(Booking,{catalog}));});t.after(()=>act(()=>view.unmount()));
  const text=node=>node.children.map(c=>typeof c==='string'?c:text(c)).join('');
  const button=label=>view.root.findAllByType('button').find(b=>text(b)===label);
  async function toConfirmation(){
    await act(async()=>view.root.findAllByType('button').find(b=>b.props.className?.startsWith('booking-choice')).props.onClick());
    await act(async()=>view.root.findAllByType('button').find(b=>b.props.className?.startsWith('booking-choice')).props.onClick());
    await act(async()=>button('Escolher data').props.onClick());
    await act(async()=>view.root.findByProps({id:'booking-date'}).props.onChange({target:{value:day}}));
    await act(async()=>button('Consultar horários').props.onClick());
    await act(async()=>view.root.findAllByType('button').find(b=>b.props['aria-label']?.startsWith('Das ')).props.onClick());
  }
  await toConfirmation();
  const checks=()=>view.root.findAllByType('input').filter(i=>i.props.type==='checkbox');
  assert.equal(checks()[1].props.checked,false);assert.equal(checks()[1].props.required,undefined);
  await act(async()=>view.root.findByProps({id:'booking-name'}).props.onChange({target:{value:'Pedro Real'}}));
  await act(async()=>view.root.findByProps({id:'booking-phone'}).props.onChange({target:{value:'85999999999'}}));
  await act(async()=>{checks()[0].props.onChange({target:{checked:true}});checks()[1].props.onChange({target:{checked:true}});});
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(requests[0].whatsapp_consent,true);
  await act(async()=>button('Novo agendamento').props.onClick());await toConfirmation();assert.equal(checks()[1].props.checked,false);
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(requests[1].whatsapp_consent,false);
  assert.notEqual(requests[0].request_id,requests[1].request_id);
});
