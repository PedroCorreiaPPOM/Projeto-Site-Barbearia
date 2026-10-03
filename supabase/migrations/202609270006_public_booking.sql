create table public.booking_requests (
  request_id uuid primary key, fingerprint text not null, phone_hash text not null,
  receipt jsonb not null, created_at timestamptz not null default now()
);
create index booking_requests_rate on public.booking_requests(created_at);
create index booking_requests_phone_rate on public.booking_requests(phone_hash,created_at);
alter table public.booking_requests enable row level security;
create policy admin_read on public.booking_requests for select to authenticated using ((select public.admin_authorized()));
revoke all on public.booking_requests from public,anon,authenticated;
grant select on public.booking_requests to authenticated;

create function public.public_booking_catalog() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'booking_key',b.public_booking_key,'name',b.name,'description',b.description,'photo_path',b.photo_path,
    'booking_horizon_days',b.booking_horizon_days,
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'price',s.price,'duration_minutes',s.duration_minutes,'photo_path',s.photo_path) order by s.name)
      from public.services s join public.barber_services bs on bs.service_id=s.id where bs.barber_id=b.id and s.active),'[]'::jsonb)
  ) order by b.name),'[]'::jsonb) from public.barbers b
  where b.active and b.booking_enabled and b.public_booking_key is not null
    and (exists(select 1 from public.barber_hours h where h.barber_id=b.id)
      or exists(select 1 from public.barber_date_overrides d where d.barber_id=b.id and d.local_date>=(now() at time zone 'America/Fortaleza')::date and jsonb_array_length(d.periods)>0));
$$;

create function public.public_available_slots(p_barber_id uuid,p_service_ids uuid[],p_date date)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare barber public.barbers; duration integer; price numeric; result jsonb; today date := (now() at time zone 'America/Fortaleza')::date;
begin
  select * into barber from public.barbers where id=p_barber_id and active and booking_enabled and public_booking_key is not null;
  if not found then raise exception 'Barbeiro indisponível. Atualize sua seleção.' using errcode='23514'; end if;
  if p_date is null or p_date<today or p_date>today+barber.booking_horizon_days then raise exception 'Data fora do período de agendamento' using errcode='23514'; end if;
  if coalesce(cardinality(p_service_ids),0)=0 or cardinality(p_service_ids)<>(select count(distinct x) from unnest(p_service_ids) x)
    then raise exception 'Selecione serviços válidos, sem repetições' using errcode='23514'; end if;
  if (select count(*) from public.services s join public.barber_services bs on bs.service_id=s.id and bs.barber_id=p_barber_id
    where s.id=any(p_service_ids) and s.active)<>cardinality(p_service_ids)
    then raise exception 'Um serviço não está mais disponível para este barbeiro. Atualize sua seleção.' using errcode='23514'; end if;
  select sum(duration_minutes),sum(s.price) into duration,price from public.services s where id=any(p_service_ids);
  select coalesce(jsonb_agg(jsonb_build_object('starts_at',slot,'ends_at',slot+make_interval(mins=>duration)) order by slot),'[]'::jsonb) into result
  from (select distinct slot from jsonb_array_elements(public.booking_periods(p_barber_id,p_date)) p
    cross join lateral generate_series((p_date+(p->>'opens_at')::time) at time zone 'America/Fortaleza',
      ((p_date+(p->>'closes_at')::time) at time zone 'America/Fortaleza')-make_interval(mins=>duration+barber.buffer_minutes),
      make_interval(mins=>barber.slot_interval_minutes)) slot
    where slot>now() and slot>=now()+make_interval(mins=>barber.minimum_notice_minutes)
      and public.booking_fits(p_barber_id,slot,slot+make_interval(mins=>duration),barber.buffer_minutes)) candidates;
  return jsonb_build_object('slots',result,'total_price',price,'total_duration_minutes',duration);
end $$;

create function public.create_public_booking(p_request_id uuid,p_barber_id uuid,p_service_ids uuid[],p_start timestamptz,p_full_name text,p_phone text,p_contact_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous public.booking_requests; availability jsonb; client_id uuid; booking_id uuid;
  receipt jsonb; barber public.barbers; finish timestamptz;
begin
  if p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_start is null or coalesce(length(trim(p_full_name)),0) not between 3 and 200
    or trim(p_full_name) !~ '^[^[:space:]]+[[:space:]]+[^[:space:]].*$'
    or coalesce(p_phone,'') !~ '^\+55[1-9][0-9]{9,10}$' or p_contact_consent is not true
    then raise exception 'Informe nome completo, telefone com DDD e consentimento de contato.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  -- Exact payload comparison avoids hash collisions; timestamp is session-timezone independent.
  fingerprint := jsonb_build_array(p_barber_id,(select array_agg(x order by x) from unnest(p_service_ids) x),
    extract(epoch from p_start),trim(p_full_name),p_phone,p_contact_consent)::text;
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
  insert into public.appointments(client_id,barber_id,local_date,starts_at,ends_at,total_price,total_duration_minutes,status,buffer_minutes)
    values(client_id,p_barber_id,(p_start at time zone 'America/Fortaleza')::date,p_start,finish,
      (availability->>'total_price')::numeric,(availability->>'total_duration_minutes')::integer,'pending',barber.buffer_minutes) returning id into booking_id;
  insert into public.appointment_services(appointment_id,service_id,service_name,price,duration_minutes)
    select booking_id,id,name,price,duration_minutes from public.services where id=any(p_service_ids);
  receipt := jsonb_build_object('id',booking_id,'status','pending','barber_name',barber.name,'booking_key',barber.public_booking_key,
    'starts_at',p_start,'ends_at',finish,'total_price',availability->'total_price','total_duration_minutes',availability->'total_duration_minutes',
    'services',(select jsonb_agg(jsonb_build_object('name',service_name,'price',price,'duration_minutes',duration_minutes) order by service_name) from public.appointment_services where appointment_id=booking_id));
  insert into public.booking_requests(request_id,fingerprint,phone_hash,receipt) values(p_request_id,fingerprint,md5(p_phone),receipt);
  return receipt;
end $$;

-- Photos stay in private buckets. Only currently published catalog images are readable.
create function public.is_public_booking_photo(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.barbers b where b.active and b.booking_enabled and b.public_booking_key is not null
    and (exists(select 1 from public.barber_hours h where h.barber_id=b.id)
      or exists(select 1 from public.barber_date_overrides d where d.barber_id=b.id and d.local_date>=(now() at time zone 'America/Fortaleza')::date and jsonb_array_length(d.periods)>0))
    and ((p_bucket='barber-photos' and b.photo_path=p_path) or (p_bucket='service-photos' and exists(
      select 1 from public.barber_services bs join public.services s on s.id=bs.service_id where bs.barber_id=b.id and s.active and s.photo_path=p_path))));
$$;
create policy published_booking_photo_read on storage.objects for select to anon,authenticated
using ((bucket_id in ('barber-photos','service-photos')) and public.is_public_booking_photo(bucket_id,name));

-- Preserve the old RPC signature for clients that only need public identifiers.
create or replace function public.public_booking_barbers() returns table(booking_key text)
language sql stable security definer set search_path='' as $$
  select value->>'booking_key' from jsonb_array_elements(public.public_booking_catalog());
$$;

revoke all on function public.public_booking_catalog(),public.public_available_slots(uuid,uuid[],date),
  public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean),public.is_public_booking_photo(text,text) from public;
grant execute on function public.public_booking_catalog(),public.public_available_slots(uuid,uuid[],date),
  public.create_public_booking(uuid,uuid,uuid[],timestamptz,text,text,boolean),public.is_public_booking_photo(text,text) to anon,authenticated;
