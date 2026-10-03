import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('history renders administrator name, verifiable UUID, timestamp and fallback',async t=>{
  const target=new URL(`./.history-ui-${process.pid}.mjs`,import.meta.url);
  const bundle=await build({entryPoints:['src/admin/BarberHistoryNote.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
  await writeFile(target,bundle.outputFiles[0].text);t.after(()=>unlink(target));
  const {default:Note}=await import(target.href);
  const deletion={barber_id:'barber',barber_name:'Geovane',deleted_by:'40000000-0000-0000-0000-000000000001',deleted_by_name:'Maria',deleted_at:'2026-09-29T12:00:00Z'};
  const render=()=>renderToStaticMarkup(React.createElement(Note,{appointment:{barber_id:'barber'},data:{barbers:[],barber_deletions:[deletion]}}));
  assert.match(render(),/administrador Maria\./);
  assert.ok(render().includes(deletion.deleted_by));
  assert.match(render(),/dateTime="2026-09-29T12:00:00Z"/);
  deletion.deleted_by_name=null;
  assert.ok(render().includes(`administrador UUID ${deletion.deleted_by}.`));
  assert.equal(renderToStaticMarkup(React.createElement(Note,{appointment:{barber_id:'other'},data:{barbers:[],barber_deletions:[deletion]}})),'');
});
