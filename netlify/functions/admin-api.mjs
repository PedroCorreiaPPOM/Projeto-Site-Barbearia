import { createClient } from "@supabase/supabase-js";
import { bearerToken, authorizeAdmin } from "./admin-status.mjs";

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const allowedStatuses = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
const text = (value, max = 200) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const errorFor = (error) => { if (error) throw error; };

export async function runAction(db, action, input = {}) {
  let result;
  switch (action) {
    case "save_schedule": {
      if (!uuid(input.barber_id) || !Number.isInteger(input.weekday) || input.weekday<0 || input.weekday>6 || !Array.isArray(input.periods) || (input.date && !isoDate(input.date))) throw new Error("Expediente inválido.");
      result = await db.rpc("save_barber_schedule", {p_barber_id:input.barber_id,p_weekday:input.weekday,p_periods:input.periods,p_date:input.date || null});
      errorFor(result.error); return result.data;
    }
    case "remove_date_override":
    case "apply_geovane_schedule": {
      if (!uuid(input.id)) throw new Error("Seleção inválida.");
      result = await db.rpc(action, action === "remove_date_override" ? {p_id:input.id} : {p_barber_id:input.id});
      errorFor(result.error); return result.data;
    }
    case "deletion_preview":
    case "delete_barber":
    case "delete_service": {
      const kind = action === "deletion_preview" ? input.kind : action === "delete_barber" ? "barber" : "service";
      if (!uuid(input.id) || !["barber", "service"].includes(kind)) throw new Error("Seleção inválida.");
      result = await db.rpc(action === "deletion_preview" ? "catalog_deletion_preview" : "deactivate_catalog_item", { p_kind: kind, p_id: input.id });
      errorFor(result.error); return result.data;
    }
    case "bootstrap": {
      const tables = ["barbers", "services", "barber_services", "barber_hours", "barber_breaks", "barber_date_overrides", "schedule_blocks", "clients", "appointments", "appointment_services", "notification_settings"];
      const records = {};
      for (const table of tables) {
        // Page through rows; recent public bookings must not disappear after 2000 records.
        records[table] = [];
        let offset = 0;
        while (true) {
          let query = db.from(table).select("*");
          if (table === "barber_services") query = query.order("barber_id").order("service_id");
          else if (table === "appointment_services") query = query.order("appointment_id").order("service_id");
          else query = query.order("id");
          const { data, error } = await query.range(offset,offset+499);
          errorFor(error); records[table].push(...data);
          if(data.length<500) break;
          offset+=500;
        }
      }
      records.photo_urls = {};
      records.service_photo_urls = {};
      for (const service of records.services) if (service.photo_path) {
        const { data } = await db.storage.from("service-photos").createSignedUrl(service.photo_path, 3600);
        if (data?.signedUrl) records.service_photo_urls[service.id] = data.signedUrl;
      }
      for (const barber of records.barbers) if (barber.photo_path) {
        const { data } = await db.storage.from("barber-photos").createSignedUrl(barber.photo_path, 3600);
        if (data?.signedUrl) records.photo_urls[barber.id] = data.signedUrl;
      }
      return records;
    }
    case "service_photo_upload_url": {
      if (!uuid(input.service_id) || !["image/jpeg", "image/png", "image/webp"].includes(input.type) || !Number.isInteger(input.size) || input.size <= 0 || input.size > 2097152) throw new Error("Use JPG, PNG ou WebP de até 2 MB.");
      const service = await db.from("services").select("id").eq("id", input.service_id).single(); errorFor(service.error);
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[input.type];
      const path = `${input.service_id}/${crypto.randomUUID()}.${extension}`;
      const { data, error } = await db.storage.from("service-photos").createSignedUploadUrl(path); errorFor(error);
      return { path, token: data.token };
    }
    case "save_service_photo": {
      if (!uuid(input.service_id) || (input.path !== null && (typeof input.path !== "string" || !new RegExp(`^${input.service_id}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(input.path)))) throw new Error("Imagem inválida.");
      // Verify the uploaded object exists before attaching it to the service.
      if (input.path) {
        const { data, error } = await db.storage.from("service-photos").list(input.service_id, { search: input.path.split("/")[1] }); errorFor(error);
        if (!data?.some((item) => item.name === input.path.split("/")[1])) throw new Error("Envie a imagem antes de salvar.");
      }
      result = await db.from("services").update({ photo_path: input.path }).eq("id", input.service_id).select().single(); errorFor(result.error); return result.data;
    }
    case "photo_upload_url": {
      if (!uuid(input.barber_id) || !["image/jpeg", "image/png", "image/webp"].includes(input.type)) throw new Error("Imagem inválida.");
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[input.type];
      const path = `${input.barber_id}/${crypto.randomUUID()}.${extension}`;
      const { data, error } = await db.storage.from("barber-photos").createSignedUploadUrl(path); errorFor(error);
      return { path, token: data.token };
    }
    case "save_photo_path": {
      if (!uuid(input.barber_id) || typeof input.path !== "string" || !input.path.startsWith(`${input.barber_id}/`)) throw new Error("Imagem inválida.");
      result = await db.from("barbers").update({ photo_path: input.path }).eq("id", input.barber_id).select().single(); errorFor(result.error); return result.data;
    }
    case "save_barber": {
      if (!text(input.name, 120)) throw new Error("Nome inválido.");
      const fields = { name: input.name.trim(), description: String(input.description || "").slice(0, 1000), active: !!input.active };
      if (input.public_booking_key !== undefined) {
        if (input.public_booking_key && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.public_booking_key)) throw new Error("Vínculo público inválido.");
        fields.public_booking_key = input.public_booking_key || null;
      }
      if (input.booking_enabled !== undefined) fields.booking_enabled = !!input.booking_enabled;
      for (const [key,min,max] of [["slot_interval_minutes",5,60],["buffer_minutes",0,120],["minimum_notice_minutes",0,10080],["booking_horizon_days",1,365]]) {
        if(input[key] === undefined) continue;
        const value = Number(input[key]);
        if(!Number.isInteger(value) || value<min || value>max || (key === "slot_interval_minutes" && ![5,10,15,20,30,45,60].includes(value))) throw new Error("Preferências de agenda inválidas.");
        fields[key]=value;
      }
      result = input.id ? await db.from("barbers").update(fields).eq("id", input.id).select().single() : await db.from("barbers").insert(fields).select().single();
      errorFor(result.error); return result.data;
    }
    case "save_service": {
      const price = Number(input.price), duration = Number(input.duration_minutes);
      if (!text(input.name, 120) || !Number.isFinite(price) || price < 0 || !Number.isInteger(duration) || duration < 5 || duration > 720) throw new Error("Dados do serviço inválidos.");
      const fields = { name: input.name.trim(), description: String(input.description || "").slice(0, 1000), price, duration_minutes: duration, active: !!input.active };
      result = input.id ? await db.from("services").update(fields).eq("id", input.id).select().single() : await db.from("services").insert(fields).select().single();
      errorFor(result.error); return result.data;
    }
    case "set_barber_service": {
      if (!uuid(input.barber_id) || !uuid(input.service_id)) throw new Error("Seleção inválida.");
      result = input.enabled ? await db.from("barber_services").upsert({ barber_id: input.barber_id, service_id: input.service_id }) : await db.from("barber_services").delete().eq("barber_id", input.barber_id).eq("service_id", input.service_id);
      errorFor(result.error); return { ok: true };
    }
    case "save_hours": {
      if (!uuid(input.barber_id) || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new Error("Dia inválido.");
      if (!input.closed && (!/^\d\d:\d\d$/.test(input.opens_at || "") || !/^\d\d:\d\d$/.test(input.closes_at || "") || input.opens_at >= input.closes_at)) throw new Error("Expediente inválido.");
      result = await db.rpc("replace_barber_hours", {
        p_barber_id: input.barber_id, p_weekday: input.weekday, p_closed: !!input.closed,
        p_opens: input.closed ? null : input.opens_at, p_closes: input.closed ? null : input.closes_at,
        p_break_start: input.closed ? null : input.break_start || null,
        p_break_end: input.closed ? null : input.break_end || null,
      }); errorFor(result.error);
      return { ok: true };
    }
    case "save_block": {
      if (!uuid(input.barber_id) || !["time_off", "exception", "block"].includes(input.kind) || !Date.parse(input.starts_at) || !Date.parse(input.ends_at) || input.starts_at >= input.ends_at) throw new Error("Bloqueio inválido.");
      result = await db.from("schedule_blocks").insert({ barber_id: input.barber_id, kind: input.kind, starts_at: input.starts_at, ends_at: input.ends_at, reason: String(input.reason || "").slice(0, 300) }).select().single(); errorFor(result.error); return result.data;
    }
    case "delete_block": {
      if (!uuid(input.id)) throw new Error("Bloqueio inválido.");
      result = await db.from("schedule_blocks").delete().eq("id", input.id); errorFor(result.error); return { ok: true };
    }
    case "update_appointment": {
      if (!uuid(input.id) || !allowedStatuses.includes(input.status)) throw new Error("Agendamento inválido.");
      const fields = { status: input.status, updated_at: new Date().toISOString() };
      if (input.starts_at || input.ends_at || input.barber_id) {
        if (!input.starts_at || !input.ends_at || !uuid(input.barber_id)) throw new Error("Dados da remarcação incompletos.");
        const start = new Date(input.starts_at), end = new Date(input.ends_at);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Horário inválido.");
        fields.starts_at = start.toISOString(); fields.ends_at = end.toISOString(); fields.barber_id = input.barber_id;
        fields.total_duration_minutes = (end - start) / 60000;
        fields.local_date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
      }
      result = await db.from("appointments").update(fields).eq("id", input.id).select().single(); errorFor(result.error); return result.data;
    }
    case "save_settings": {
      const minutes = Number(input.reminder_minutes), days = Number(input.inactivity_days);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080 || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Configurações inválidas.");
      result = await db.from("notification_settings").update({ enabled: !!input.enabled, reminder_minutes: minutes, inactivity_days: days, updated_at: new Date().toISOString() }).eq("id", true).select().single(); errorFor(result.error); return result.data;
    }
    default: throw new Error("Operação desconhecida.");
  }
}

export function createAdminHandler({ authorize = authorizeAdmin, clientFactory = createClient } = {}) {
  return async function handleAdmin(event) {
    if (!["GET", "POST"].includes(event.httpMethod)) return json(405, { error: "Método inválido." });
    const token = bearerToken(event.headers || {});
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
    const access = await authorize(token, url, key);
    if (!access.authorized) return json(access.reason === "unauthenticated" ? 401 : 403, { error: "Acesso negado." });
    const db = clientFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    try {
      const payload = event.httpMethod === "GET" ? { action: "bootstrap" } : JSON.parse(event.body || "{}");
      const data = await runAction(db, payload.action, payload.input);
      return json(200, { data });
    } catch (error) {
      return json(error.code === "23P01" || error.code === "23514" ? 409 : 400, { error: error.message || "Operação não concluída." });
    }
  };
}
export const handler = createAdminHandler();
