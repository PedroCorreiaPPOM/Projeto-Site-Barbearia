import { createClient } from "@supabase/supabase-js";

// Netlify enforces this before invocation; database quotas also protect direct RPC calls.
export const config = { rateLimit: { windowLimit:60, windowSize:60, aggregateBy:["ip","domain"] } };

const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function bookingAction(db, action, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Requisição inválida.");
  if (action === "create" && (!uuid(input.request_id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_id))) throw new Error("Identificador da solicitação inválido. Reabra o agendamento.");
  let result;
  if (action === "catalog") {
    result = await db.rpc("public_booking_catalog");
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Não foi possível consultar os profissionais. Tente novamente em instantes.');
    const signed = new Map();
    async function photo(bucket, path) {
      if (!path) return null;
      const key = `${bucket}/${path}`;
      if (!signed.has(key)) signed.set(key, db.storage.from(bucket).createSignedUrl(path, 600).then(({data}) => data?.signedUrl || null));
      return signed.get(key);
    }
    return Promise.all(result.data.map(async (b) => {
      const {photo_path, ...barber} = b;
      return {...barber, photo_url:await photo("barber-photos",photo_path), services:await Promise.all(b.services.map(async ({photo_path,...s})=>({...s,photo_url:await photo("service-photos",photo_path)})))};
    }));
  }
  if (!["availability","create"].includes(action) || !uuid(input.barber_id) || !Array.isArray(input.service_ids) || !input.service_ids.length || !input.service_ids.every(uuid) || new Set(input.service_ids).size !== input.service_ids.length) throw new Error("Seleção inválida.");
  if (action === "availability") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || "")) throw new Error("Data inválida.");
    result = await db.rpc("public_available_slots", {p_barber_id:input.barber_id,p_service_ids:input.service_ids,p_date:input.date});
  } else {
    if (!uuid(input.request_id) || typeof input.full_name !== "string" || input.full_name.trim().length > 200 || !/^\S+\s+\S/.test(input.full_name.trim()) || !/^\+55[1-9]\d{9,10}$/.test(input.phone || "") || input.contact_consent !== true || !Number.isFinite(Date.parse(input.starts_at)) || input.website) throw new Error("Informe nome completo, telefone com DDD e consentimento de contato.");
    result = await db.rpc("create_public_booking", {p_request_id:input.request_id,p_barber_id:input.barber_id,p_service_ids:input.service_ids,p_start:input.starts_at,p_full_name:input.full_name.trim(),p_phone:input.phone,p_contact_consent:true});
  }
  if(result.error) throw result.error;
  return result.data;
}
const response = (statusCode,body) => ({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
export async function handler(event) {
  if (!['GET','POST'].includes(event.httpMethod)) return response(405,{error:"Método inválido."});
  if ((event.body || "").length > 65536) return response(413,{error:"Requisição muito grande."});
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return response(503,{error:"Agendamento temporariamente indisponível."});
  try {
    const payload = event.httpMethod === "GET" ? {action:"catalog"} : JSON.parse(event.body || "{}");
    if(!payload || typeof payload !== "object" || Array.isArray(payload)) return response(400,{error:"Requisição inválida."});
    const db = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    return response(200,{data:await bookingAction(db,payload.action,payload.input)});
  } catch(error) {
    const conflict = ["23514","23P01"].includes(error.code);
    const limited = error.code === "P0001" && /Limite/.test(error.message);
    // Database internals and identifiers are not exposed to public clients.
    const safe = conflict || limited || !error.code || error.code === "22023";
    return response(limited ? 429 : conflict ? 409 : 400,{error:safe ? (error instanceof SyntaxError ? "Requisição inválida." : error.message) : "Não foi possível concluir. Atualize os dados e tente novamente."});
  }
}
