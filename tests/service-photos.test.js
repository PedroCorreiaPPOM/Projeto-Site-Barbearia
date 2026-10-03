import test from "node:test";
import assert from "node:assert/strict";
import { runAction } from "../netlify/functions/admin-api.mjs";
const id = "11111111-1111-1111-1111-111111111111";
test("rejects unsupported, oversized and foreign service photographs", async () => {
  const db = {};
  for (const input of [{type:"image/svg+xml",size:100},{type:"image/png",size:2097153},{type:"image/jpeg",size:0}]) await assert.rejects(runAction(db,"service_photo_upload_url",{service_id:id,...input}), /2 MB/);
  for (const path of ["other/photo.jpg",`${id}/../photo.jpg`,`${id}/photo.svg`,undefined]) await assert.rejects(runAction(db,"save_service_photo",{service_id:id,path}), /inválida/);
});
test("does not attach missing storage objects", async () => {
  const db = {storage:{from(bucket){assert.equal(bucket,"service-photos");return {list:async()=>({data:[]})};}}};
  await assert.rejects(runAction(db,"save_service_photo",{service_id:id,path:`${id}/${id}.jpg`}), /Envie a imagem/);
});
test("removes only the service photo reference", async () => {
  const db = {from(table){assert.equal(table,"services");return {update(fields){assert.deepEqual(fields,{photo_path:null});return {eq(key,value){assert.equal(key,"id");assert.equal(value,id);return {select(){return {single:async()=>({data:{id,...fields}})};}};}};}};}};
  assert.equal((await runAction(db,"save_service_photo",{service_id:id,path:null})).photo_path,null);
});
