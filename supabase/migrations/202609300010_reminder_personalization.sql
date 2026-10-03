begin;
-- Consent explicitly scoped to the public reservation, not to other bookings sharing a phone.
-- NULL preserves the prior rule only for legacy/admin-created appointments.
alter table public.appointments add column whatsapp_reminder_consent boolean,
  add column reminder_consent_phone text, add column reminder_consent_at timestamptz;
alter table public.appointment_reminders add column rendered_message text;
alter table public.reminder_settings add column client_message text not null default
  E'Olá, {cliente}! 👋 Seu horário na GEO''ROCHA está chegando.\nSeu atendimento com {barbeiro} está marcado para {data}, às {horario}.\nServiços: {servicos}. Te esperamos! 💈',
  add column barber_message text not null default
  E'Olá, {barbeiro}! Você tem um atendimento às {horario}.\nCliente: {cliente}.\nServiços: {servicos}.\nDuração prevista: {duracao} minutos.';

create function public.validate_reminder_message(p_text text) returns void language plpgsql set search_path='' as $$
begin
  if p_text is null or p_text !~ '[^[:space:]]' or length(p_text)>1500
    or regexp_replace(p_text,'\{(cliente|barbeiro|data|horario|servicos|duracao)\}','','g') ~ '[{}]' then
    raise exception 'Mensagem inválida: use até 1500 caracteres e somente as variáveis documentadas.' using errcode='22023'; end if;
end $$;
create function public.render_reminder_message(p_text text,p_values jsonb) returns text language plpgsql set search_path='' as $$
declare rest text:=p_text; output text:=''; token text[]; pos integer;
begin
  perform public.validate_reminder_message(p_text);
  loop
    token:=regexp_match(rest,'\{(cliente|barbeiro|data|horario|servicos|duracao)\}');
    if token is null then return output||rest; end if;
    if p_values->>token[1] is null then raise exception 'Variável sem valor' using errcode='22023'; end if;
    pos:=strpos(rest,'{'||token[1]||'}');
    output:=output||left(rest,pos-1)||(p_values->>token[1]);
    rest:=substring(rest from pos+length(token[1])+2);
  end loop;
end $$;
create function public.save_reminder_messages(p_client text,p_barber text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED' using errcode='25000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  perform public.validate_reminder_message(p_client);perform public.validate_reminder_message(p_barber);
  update public.reminder_settings set client_message=p_client,barber_message=p_barber where id;
end $$;

-- The prior claim/retry state machine is retained as an internal implementation.
alter function public.claim_appointment_reminder(boolean) rename to claim_appointment_reminder_009;
revoke all on function public.claim_appointment_reminder_009(boolean) from public,anon,authenticated,service_role;
create function public.claim_appointment_reminder(p_simulated boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb; message text; stamp timestamp;
begin
  job:=public.claim_appointment_reminder_009(p_simulated);
  if job is null then return null; end if;
  if p_simulated then
    stamp:=(job->'payload'->>'starts_at')::timestamptz at time zone 'America/Fortaleza';
    select case when job->>'recipient_type'='client' then client_message else barber_message end into message from public.reminder_settings where id;
    message:=public.render_reminder_message(message,jsonb_build_object(
      'cliente',job->'payload'->>'client_name','barbeiro',job->'payload'->>'barber_name',
      'data',to_char(stamp,'DD/MM/YYYY'),'horario',to_char(stamp,'HH24:MI'),
      'servicos',job->'payload'->>'services','duracao',job->'payload'->>'duration_minutes'));
    update public.appointment_reminders set rendered_message=message where id=(job->>'id')::uuid;
    job:=job||jsonb_build_object('rendered_message',message);
  end if;
  return job;
end $$;
revoke all on function public.validate_reminder_message(text),public.render_reminder_message(text,jsonb),
  public.save_reminder_messages(text,text),public.claim_appointment_reminder(boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_reminder_messages(text,text) to authenticated;
grant execute on function public.claim_appointment_reminder(boolean) to service_role;

create or replace function public.sync_appointment_reminders() returns void language plpgsql security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED' using errcode='25000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  if not exists(select 1 from public.reminder_settings where client_enabled or barber_enabled)
    and not exists(select 1 from public.appointment_reminders where status in ('pending','retry','processing')) then return; end if;
  -- An expired claim might already have reached Meta. Never resend it automatically.
  update public.appointment_reminders set status='failed',error_code='OUTCOME_UNKNOWN',updated_at=now()
    where status='processing' and lease_until<clock_timestamp();
  update public.appointment_reminders q set status='cancelled',error_code='BOOKING_OR_CONSENT_CHANGED',updated_at=now()
  where q.status in ('pending','retry') and not exists(
    select 1 from public.appointments a join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id
    cross join public.reminder_settings s where a.id=q.appointment_id and a.reminder_revision=q.revision
    and a.status in ('pending','confirmed') and a.starts_at>now() and b.active
    and ((q.recipient_type='client' and s.client_enabled and (coalesce(a.whatsapp_reminder_consent,c.whatsapp_reminder_consent) and (a.reminder_consent_phone is null or a.reminder_consent_phone=c.phone_e164)) and c.phone_e164=q.recipient_phone)
      or(q.recipient_type='barber' and s.barber_enabled and b.notification_consent and b.notification_phone=q.recipient_phone)));
  insert into public.appointment_reminders(appointment_id,revision,recipient_type,recipient_name,recipient_phone,scheduled_at)
  select a.id,a.reminder_revision,r.kind,r.name,r.phone,a.starts_at-make_interval(mins=>r.minutes)
  from public.appointments a join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id
  cross join public.reminder_settings s cross join lateral (values
    ('client',c.full_name,c.phone_e164,s.client_minutes,s.client_enabled and (coalesce(a.whatsapp_reminder_consent,c.whatsapp_reminder_consent) and (a.reminder_consent_phone is null or a.reminder_consent_phone=c.phone_e164))),
    ('barber',b.name,b.notification_phone,s.barber_minutes,s.barber_enabled and b.notification_consent)) r(kind,name,phone,minutes,enabled)
  where a.status in ('pending','confirmed') and a.starts_at>now() and b.active and r.enabled and r.phone is not null
  on conflict(appointment_id,revision,recipient_type) do update
    set scheduled_at=excluded.scheduled_at,recipient_name=excluded.recipient_name,
      recipient_phone=excluded.recipient_phone,
      status=case when appointment_reminders.status='cancelled' then 'pending' else appointment_reminders.status end,
      updated_at=now()
    where appointment_reminders.status in ('pending','retry') or (appointment_reminders.status='cancelled' and appointment_reminders.attempts=0);
end $$;

create or replace function public.save_barber_profile(p_id uuid,p_profile jsonb,p_expected jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_state jsonb; saved public.barbers; item jsonb; old_periods jsonb; day integer; linked uuid[]; photo text;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED' using errcode='25000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  current_state := public.barber_editor_snapshot(p_id);
  if current_state is distinct from p_expected then
    raise exception 'Este cadastro foi alterado em outra sessão. Volte à lista e abra os dados atualizados.' using errcode='40001';
  end if;
  if p_id is null or jsonb_typeof(p_profile) is distinct from 'object'
    or coalesce(length(trim(p_profile->>'name')),0) not between 2 and 120
    or coalesce(length(p_profile->>'description'),0)>1000
    or jsonb_typeof(p_profile->'booking_enabled') is distinct from 'boolean'
    or jsonb_typeof(p_profile->'services') is distinct from 'array'
    or jsonb_typeof(p_profile->'week') is distinct from 'array'
    or jsonb_array_length(p_profile->'week')<>7
    or jsonb_typeof(p_profile->'overrides') is distinct from 'array'
    or jsonb_typeof(p_profile->'blocks') is distinct from 'array'
    then raise exception 'Cadastro incompleto ou inválido' using errcode='22023'; end if;
  if (p_profile->>'slot_interval_minutes')::integer not in (5,10,15,20,30,45,60)
    or (p_profile->>'buffer_minutes')::integer not between 0 and 120
    or (p_profile->>'minimum_notice_minutes')::integer not between 0 and 10080
    or (p_profile->>'booking_horizon_days')::integer not between 1 and 365 then
    raise exception 'Preferências inválidas' using errcode='22023'; end if;
  select coalesce(array_agg(value::uuid),'{}') into linked from jsonb_array_elements_text(p_profile->'services');
  if cardinality(linked)<>(select count(distinct x) from unnest(linked) x)
    or exists(select 1 from unnest(linked) x where not exists(select 1 from public.services s where s.id=x and
      (s.active or exists(select 1 from public.barber_services bs where bs.barber_id=p_id and bs.service_id=x)))) then
    raise exception 'Selecione serviços ativos válidos' using errcode='23514'; end if;
  for day in 0..6 loop perform public.validate_work_periods(p_profile->'week'->day); end loop;
  for item in select value from jsonb_array_elements(p_profile->'overrides') loop
    if item->>'local_date' is null then raise exception 'Data inválida' using errcode='22023'; end if;
    perform (item->>'local_date')::date;
    perform public.validate_work_periods(item->'periods');
  end loop;
  if (select count(*)<>count(distinct value->>'local_date') from jsonb_array_elements(p_profile->'overrides')) then
    raise exception 'Datas duplicadas' using errcode='22023'; end if;
  photo := nullif(p_profile->>'photo_path','');
  if photo is not null and photo is distinct from current_state->'barber'->>'photo_path' then
    if photo !~ ('^'||p_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') or not exists(
      select 1 from storage.objects o where o.bucket_id='barber-photos' and o.name=photo
        and to_jsonb(o)->'metadata'->>'mimetype' in ('image/jpeg','image/png','image/webp')
        and (to_jsonb(o)->'metadata'->>'size')::bigint between 1 and 2097152) then
      raise exception 'Envie uma foto JPG, PNG ou WebP de até 2 MB antes de salvar' using errcode='23514'; end if;
  end if;
  if current_state is null then
    insert into public.barbers(id,name,active,booking_enabled) values(p_id,trim(p_profile->>'name'),true,false);
  end if;
  if p_profile ? 'notification_phone' or p_profile ? 'notification_consent' then
    if jsonb_typeof(p_profile->'notification_consent') is distinct from 'boolean'
      or (nullif(p_profile->>'notification_phone','') is not null and (p_profile->>'notification_phone') !~ '^\+55[1-9][0-9]{9,10}$')
      or ((p_profile->>'notification_consent')::boolean and nullif(p_profile->>'notification_phone','') is null)
      then raise exception 'Informe telefone válido e consentimento para notificações.' using errcode='22023'; end if;
    update public.barbers set notification_phone=nullif(p_profile->>'notification_phone',''),
      notification_consent=(p_profile->>'notification_consent')::boolean where id=p_id;
  end if;
  -- Unchanged weekdays are untouched, preserving reservations and row identities.
  for day in 0..6 loop
    select coalesce(jsonb_agg(jsonb_build_object('opens_at',left(h.opens_at::text,5),'closes_at',left(h.closes_at::text,5),
      'breaks',coalesce((select jsonb_agg(jsonb_build_object('starts_at',left(b.starts_at::text,5),'ends_at',left(b.ends_at::text,5)) order by b.starts_at)
        from public.barber_breaks b where b.barber_hour_id=h.id),'[]')) order by h.opens_at),'[]') into old_periods
      from public.barber_hours h where h.barber_id=p_id and h.weekday=day;
    if old_periods is distinct from p_profile->'week'->day then
      perform public.save_barber_schedule(p_id,day,p_profile->'week'->day);
    end if;
  end loop;
  for item in select to_jsonb(d) from public.barber_date_overrides d where d.barber_id=p_id
    and not exists(select 1 from jsonb_array_elements(p_profile->'overrides') x where (x->>'local_date')::date=d.local_date) loop
    perform public.remove_date_override((item->>'id')::uuid);
  end loop;
  for item in select value from jsonb_array_elements(p_profile->'overrides') loop
    if not exists(select 1 from public.barber_date_overrides d where d.barber_id=p_id and d.local_date=(item->>'local_date')::date and d.periods=item->'periods') then
      perform public.save_barber_schedule(p_id,extract(dow from (item->>'local_date')::date)::integer,item->'periods',(item->>'local_date')::date);
    end if;
  end loop;
  -- Existing blocks are identified explicitly; foreign IDs cannot be modified.
  if exists(select 1 from jsonb_array_elements(p_profile->'blocks') x where x->>'id' is not null
    and not exists(select 1 from public.schedule_blocks b where b.id=(x->>'id')::uuid and b.barber_id=p_id)) then
    raise exception 'Bloqueio inválido' using errcode='22023'; end if;
  if (select count(value->>'id')<>count(distinct value->>'id') from jsonb_array_elements(p_profile->'blocks')) then
    raise exception 'Bloqueios duplicados' using errcode='22023'; end if;
  delete from public.schedule_blocks b where b.barber_id=p_id and not exists(
    select 1 from jsonb_array_elements(p_profile->'blocks') x where (x->>'id')::uuid=b.id);
  for item in select value from jsonb_array_elements(p_profile->'blocks') loop
    if item->>'id' is null then
      insert into public.schedule_blocks(barber_id,starts_at,ends_at,kind,reason)
      values(p_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,item->>'kind',coalesce(item->>'reason',''));
    else
      update public.schedule_blocks set starts_at=(item->>'starts_at')::timestamptz,ends_at=(item->>'ends_at')::timestamptz,kind=item->>'kind',reason=coalesce(item->>'reason','')
      where id=(item->>'id')::uuid and (starts_at,ends_at,kind,reason) is distinct from
        ((item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,item->>'kind',coalesce(item->>'reason',''));
    end if;
  end loop;
  delete from public.barber_services where barber_id=p_id and not(service_id=any(linked));
  insert into public.barber_services(barber_id,service_id) select p_id,x from unnest(linked) x on conflict do nothing;
  if (p_profile->>'booking_enabled')::boolean and (
    not exists(select 1 from public.services s where s.id=any(linked) and s.active)
    or (not exists(select 1 from public.barber_hours where barber_id=p_id) and not exists(
      select 1 from public.barber_date_overrides where barber_id=p_id and local_date>=(now() at time zone 'America/Fortaleza')::date and jsonb_array_length(periods)>0))) then
    raise exception 'Para receber reservas online, configure expediente e pelo menos um serviço ativo' using errcode='23514'; end if;
  update public.barbers set name=trim(p_profile->>'name'),description=coalesce(p_profile->>'description',''),photo_path=photo,
    booking_enabled=(p_profile->>'booking_enabled')::boolean,slot_interval_minutes=(p_profile->>'slot_interval_minutes')::integer,
    buffer_minutes=(p_profile->>'buffer_minutes')::integer,minimum_notice_minutes=(p_profile->>'minimum_notice_minutes')::integer,
    booking_horizon_days=(p_profile->>'booking_horizon_days')::integer where id=p_id returning * into saved;
  return to_jsonb(saved);
end $$;

create function public.create_public_booking(p_request_id uuid,p_barber_id uuid,p_service_ids uuid[],p_start timestamptz,p_full_name text,p_phone text,p_contact_consent boolean,p_whatsapp_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous public.booking_requests; availability jsonb; client_id uuid; booking_id uuid;
  receipt jsonb; barber public.barbers; finish timestamptz;
begin
  if p_whatsapp_consent is null or p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_start is null or coalesce(length(trim(p_full_name)),0) not between 3 and 200
    or trim(p_full_name) !~ '^[^[:space:]]+[[:space:]]+[^[:space:]].*$'
    or coalesce(p_phone,'') !~ '^\+55[1-9][0-9]{9,10}$' or p_contact_consent is not true
    then raise exception 'Informe nome completo, telefone com DDD e consentimento de contato.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  -- Exact payload comparison avoids hash collisions; timestamp is session-timezone independent.
  fingerprint := jsonb_build_array(p_barber_id,(select array_agg(x order by x) from unnest(p_service_ids) x),
    extract(epoch from p_start),trim(p_full_name),p_phone,p_contact_consent)::text;
  if p_whatsapp_consent then fingerprint:=fingerprint||':whatsapp-consent-v1'; end if;
  select * into previous from public.booking_requests where request_id=p_request_id;
  if found then
    if previous.fingerprint<>fingerprint then raise exception 'Identificador de solicitação já utilizado' using errcode='22023'; end if;
    return previous.receipt;
  end if;
  -- Enforced inside the transaction, including requests made directly to the RPC.
  if (select count(*) from public.booking_requests where phone_hash=md5(p_phone) and created_at>now()-interval '1 hour')>=3
    or (select count(*) from public.booking_requests where created_at>now()-interval '10 minutes')>=120
    then raise exception 'Limite de reservas atingido. Tente novamente mais tarde.' using errcode='P0001'; end if;
  availability := public.public_available_slots(p_barber_id,p_service_ids,(p_start at time zone 'America/Fortaleza')::date);
  if not exists(select 1 from jsonb_array_elements(availability->'slots') x where (x->>'starts_at')::timestamptz=p_start)
    then raise exception 'Este horário acabou de ficar indisponível. Escolha outro.' using errcode='23514'; end if;
  select * into barber from public.barbers where id=p_barber_id;
  finish := p_start+make_interval(mins=>(availability->>'total_duration_minutes')::integer);
  -- Do not let unauthenticated callers overwrite existing client identity or marketing consent.
  insert into public.clients(full_name,phone_e164,booking_contact_consent)
    values(trim(p_full_name),p_phone,true) on conflict(phone_e164) do nothing;
  select id into client_id from public.clients where phone_e164=p_phone;
  insert into public.appointments(client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status,buffer_minutes,whatsapp_reminder_consent,reminder_consent_phone,reminder_consent_at)
    values(client_id,p_barber_id,(p_start at time zone 'America/Fortaleza')::date,p_start,finish,
      (availability->>'total_price')::numeric,(availability->>'total_duration_minutes')::integer,'pending',barber.buffer_minutes,p_whatsapp_consent,p_phone,case when p_whatsapp_consent then clock_timestamp() end) returning id into booking_id;
  insert into public.appointment_services(appointment_id,service_id,service_name,price,duration_minutes)
    select booking_id,id,name,price,duration_minutes from public.services where id=any(p_service_ids);
  receipt := jsonb_build_object('id',booking_id,'status','pending','barber_name',barber.name,'booking_key',barber.public_booking_key,
    'starts_at',p_start,'ends_at',finish,'total_price',availability->'total_price','total_duration_minutes',availability->'total_duration_minutes',
    'services',(select jsonb_agg(jsonb_build_object('name',service_name,'price',price,'duration_minutes',duration_minutes) order by service_name) from public.appointment_services where appointment_id=booking_id));
  insert into public.booking_requests(request_id,fingerprint,phone_hash,receipt) values(p_request_id,fingerprint,md5(p_phone),receipt);
  return receipt;
end $$;

-- Backward-compatible callers never implicitly opt in to WhatsApp.
create or replace function public.create_public_booking(p_request_id uuid,p_barber_id uuid,p_service_ids uuid[],p_start timestamptz,p_full_name text,p_phone text,p_contact_consent boolean)
returns jsonb language sql security definer set search_path='' as $$
  select public.create_public_booking(p_request_id,p_barber_id,p_service_ids,p_start,p_full_name,p_phone,p_contact_consent,false);
$$;
create function public.revoke_client_reminder_consent(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  update public.appointments set whatsapp_reminder_consent=false where client_id=p_id and status in ('pending','confirmed') and starts_at>now();
  update public.clients set whatsapp_reminder_consent=false where id=p_id;
end $$;
revoke all on function public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean,boolean),
  public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean),public.revoke_client_reminder_consent(uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean,boolean),
  public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean) to anon,authenticated;
grant execute on function public.revoke_client_reminder_consent(uuid) to authenticated;
commit;
