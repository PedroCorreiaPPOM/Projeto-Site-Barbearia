export function reminderMode(env) { return env.WHATSAPP_REMINDERS_MODE === 'live' ? 'live' : 'dry-run'; }
export function metaReady(env) {
  return !!(env.META_WHATSAPP_TOKEN && /^\d+$/.test(env.META_WHATSAPP_PHONE_NUMBER_ID || '') &&
    /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || '') &&
    /^[a-z0-9_]+$/.test(env.META_CLIENT_REMINDER_TEMPLATE || '') &&
    /^[a-z0-9_]+$/.test(env.META_BARBER_REMINDER_TEMPLATE || '') &&
    /^[a-z]{2}(?:_[A-Z]{2})?$/.test(env.META_TEMPLATE_LANGUAGE || ''));
}
export function templateBody(job,env) {
  const p=job.payload;
  const when=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',dateStyle:'short',timeStyle:'short'}).format(new Date(p.starts_at));
  const values=job.recipient_type==='client' ? [p.client_name,p.barber_name,when] : [p.barber_name,p.client_name,when,p.services,String(p.duration_minutes)];
  return {messaging_product:'whatsapp',to:job.recipient_phone.replace('+',''),type:'template',template:{
    name:job.recipient_type==='client'?env.META_CLIENT_REMINDER_TEMPLATE:env.META_BARBER_REMINDER_TEMPLATE,
    language:{code:env.META_TEMPLATE_LANGUAGE},components:[{type:'body',parameters:values.map(text=>({type:'text',text}))}]}};
}
export async function sendReminder(job,env,fetcher=fetch) {
  if(reminderMode(env)!=='live')return {result:'accepted',providerId:null};
  if(!metaReady(env))throw new Error('REMINDERS_CONFIGURATION_MISSING');
  // Never start a network request after a delayed worker has lost its dispatch window.
  if(!job.lease_until || Date.parse(job.lease_until)<Date.now()+10000 || Date.parse(job.payload.starts_at)<Date.now()+10000)return {result:'unknown'};
  try {
    const response=await fetcher(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`,{
      method:'POST',headers:{Authorization:`Bearer ${env.META_WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify(templateBody(job,env)),signal:AbortSignal.timeout(8000)});
    const body=await response.json().catch(()=>null);
    if(response.ok && typeof body?.messages?.[0]?.id==='string')return {result:'accepted',providerId:body.messages[0].id};
    // Only explicit rate-limit rejections are safe to retry. 5xx/timeouts may have accepted the message.
    if(body?.error && (response.status===429 || (response.status===400 && [130429,131056].includes(body.error.code))))return {result:'temporary'};
    if(response.status>=400 && response.status<500 && body?.error)return {result:'permanent'};
    return {result:'unknown'};
  } catch {return {result:'unknown'};}
}
export async function processReminders(db,env={},fetcher=fetch) {
  const simulated=reminderMode(env)!=='live';
  if(!simulated && !metaReady(env))return {processed:0,state:'configuration_missing'};
  // One item per invocation keeps provider + database calls within the scheduler's time budget.
  const claim=await db.rpc('claim_appointment_reminder',{p_simulated:simulated});
  if(claim.error)throw new Error('REMINDER_CLAIM_FAILED');
  if(!claim.data)return {processed:0,state:simulated?'dry-run':'live'};
  const result=await sendReminder(claim.data,env,fetcher);
  const done=await db.rpc('finish_appointment_reminder',{p_id:claim.data.id,p_token:claim.data.claim_token,p_result:result.result,p_provider_id:result.providerId||null});
  if(done.error)throw new Error('REMINDER_RESULT_NOT_RECORDED');
  return {processed:1,state:simulated?'dry-run':'live',result:result.result};
}
