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
});
