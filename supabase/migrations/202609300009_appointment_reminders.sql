begin;
-- Dedicated transactional reminders; legacy marketing preferences are untouched.
alter table public.barbers add column notification_phone text check(notification_phone ~ '^\+55[1-9][0-9]{9,10}$'),
  add column notification_consent boolean not null default false;
alter table public.clients add column whatsapp_reminder_consent boolean not null default false;
alter table public.appointments add column reminder_revision integer not null default 1;
create table public.reminder_settings (
  id boolean primary key default true check(id),
  client_enabled boolean not null default false, barber_enabled boolean not null default false,
  client_minutes integer not null default 1440 check(client_minutes between 15 and 10080),
  barber_minutes integer not null default 60 check(barber_minutes between 15 and 10080)
);
insert into public.reminder_settings(id) values(true);
create table public.appointment_reminders (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete restrict,
  revision integer not null, recipient_type text not null check(recipient_type in ('client','barber')),
  recipient_name text not null, recipient_phone text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled','retry')),
  attempts integer not null default 0 check(attempts between 0 and 4), last_attempt_at timestamptz, next_attempt_at timestamptz,
  claim_token uuid, lease_until timestamptz, provider_id text, error_code text,
  simulated boolean not null default false, sent_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(appointment_id,revision,recipient_type)
);
create index appointment_reminders_due on public.appointment_reminders(status,scheduled_at,next_attempt_at);
alter table public.reminder_settings enable row level security;
alter table public.appointment_reminders enable row level security;
revoke all on public.reminder_settings,public.appointment_reminders from public,anon,authenticated,service_role;
grant select on public.reminder_settings,public.appointment_reminders to authenticated;
create policy admin_read on public.reminder_settings for select to authenticated using ((select public.admin_authorized()));
create policy admin_read on public.appointment_reminders for select to authenticated using ((select public.admin_authorized()));

-- All queue decisions share the existing booking/catalog transaction lock.
create trigger reminder_client_lock before insert or update or delete on public.clients
for each statement execute function public.lock_catalog_booking_changes();
create function public.sync_appointment_reminders() returns void language plpgsql security definer set search_path='' as $$
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
    and ((q.recipient_type='client' and s.client_enabled and c.whatsapp_reminder_consent and c.phone_e164=q.recipient_phone)
      or(q.recipient_type='barber' and s.barber_enabled and b.notification_consent and b.notification_phone=q.recipient_phone)));
  insert into public.appointment_reminders(appointment_id,revision,recipient_type,recipient_name,recipient_phone,scheduled_at)
  select a.id,a.reminder_revision,r.kind,r.name,r.phone,a.starts_at-make_interval(mins=>r.minutes)
  from public.appointments a join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id
  cross join public.reminder_settings s cross join lateral (values
    ('client',c.full_name,c.phone_e164,s.client_minutes,s.client_enabled and c.whatsapp_reminder_consent),
    ('barber',b.name,b.notification_phone,s.barber_minutes,s.barber_enabled and b.notification_consent)) r(kind,name,phone,minutes,enabled)
  where a.status in ('pending','confirmed') and a.starts_at>now() and b.active and r.enabled and r.phone is not null
  on conflict(appointment_id,revision,recipient_type) do update
    set scheduled_at=excluded.scheduled_at,recipient_name=excluded.recipient_name,
      recipient_phone=excluded.recipient_phone,
      status=case when appointment_reminders.status='cancelled' then 'pending' else appointment_reminders.status end,
      updated_at=now()
    where appointment_reminders.status in ('pending','retry') or (appointment_reminders.status='cancelled' and appointment_reminders.attempts=0);
end $$;
create function public.reminder_change_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- A short dispatch lease protects the interval between claim and provider response.
  if exists(select 1 from public.appointment_reminders q join public.appointments a on a.id=q.appointment_id
    where q.status='processing' and q.lease_until>clock_timestamp()
    and ((tg_table_name='appointments' and a.id=old.id)
      or(tg_table_name='clients' and a.client_id=old.id)
      or(tg_table_name='barbers' and a.barber_id=old.id))) then
    raise exception 'Um lembrete está sendo processado. Tente novamente em até dois minutos.' using errcode='40001';
  end if;
  if tg_table_name='appointments' and tg_op='UPDATE' then
    if (new.starts_at,new.barber_id,new.client_id) is distinct from (old.starts_at,old.barber_id,old.client_id) then
      new.reminder_revision:=old.reminder_revision+1;
    else new.reminder_revision:=old.reminder_revision; end if;
  end if;
  if tg_table_name='clients' and tg_op='UPDATE' then
    if new.phone_e164 is distinct from old.phone_e164 then new.whatsapp_reminder_consent:=false; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger reminder_change_guard before update or delete on public.appointments for each row execute function public.reminder_change_guard();
create trigger reminder_change_guard before update of name,notification_phone,notification_consent,active or delete on public.barbers for each row execute function public.reminder_change_guard();
create trigger reminder_change_guard before update of full_name,phone_e164,whatsapp_reminder_consent or delete on public.clients for each row execute function public.reminder_change_guard();
create function public.reminder_service_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare previous_id uuid; next_id uuid;
begin
  if tg_op<>'INSERT' then previous_id:=old.appointment_id; end if;
  if tg_op<>'DELETE' then next_id:=new.appointment_id; end if;
  if exists(select 1 from public.appointment_reminders where appointment_id in (previous_id,next_id)
    and status='processing' and lease_until>clock_timestamp()) then
    raise exception 'Um lembrete está sendo processado. Tente novamente em até dois minutos.' using errcode='40001'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger reminder_service_guard before insert or update or delete on public.appointment_services
for each row execute function public.reminder_service_guard();
create function public.reminder_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.sync_appointment_reminders(); return null; end $$;
create trigger reminder_changed after insert or update or delete on public.appointments for each statement execute function public.reminder_changed();
create trigger reminder_changed after insert or update or delete on public.barbers for each statement execute function public.reminder_changed();
create trigger reminder_changed after insert or update or delete on public.clients for each statement execute function public.reminder_changed();

create function public.save_reminder_settings(p_client_enabled boolean,p_barber_enabled boolean,p_client_minutes integer,p_barber_minutes integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  if exists(select 1 from public.appointment_reminders where status='processing' and lease_until>clock_timestamp()) then
    raise exception 'Aguarde o processamento dos lembretes e tente novamente.' using errcode='40001'; end if;
  update public.reminder_settings set client_enabled=p_client_enabled,barber_enabled=p_barber_enabled,
    client_minutes=p_client_minutes,barber_minutes=p_barber_minutes where id;
  perform public.sync_appointment_reminders();
end $$;

create function public.claim_appointment_reminder(p_simulated boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.appointment_reminders; payload jsonb;
begin
  perform public.sync_appointment_reminders();
  select * into q from public.appointment_reminders where status in ('pending','retry') and scheduled_at<=now()
    and coalesce(next_attempt_at,scheduled_at)<=now() and attempts<4 order by scheduled_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.appointment_reminders set status='processing',attempts=attempts+1,last_attempt_at=clock_timestamp(),
    claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',simulated=p_simulated,updated_at=now()
    where id=q.id returning * into q;
  select jsonb_build_object('client_name',c.full_name,'barber_name',b.name,'starts_at',a.starts_at,
    'duration_minutes',a.total_duration_minutes,'services',coalesce((select string_agg(s.service_name,', ' order by s.service_name)
    from public.appointment_services s where s.appointment_id=a.id),'')) into payload
    from public.appointments a join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id where a.id=q.appointment_id;
  return to_jsonb(q)||jsonb_build_object('payload',payload);
end $$;
create function public.finish_appointment_reminder(p_id uuid,p_token uuid,p_result text,p_provider_id text default null)
returns void language plpgsql security definer set search_path='' as $$
declare q public.appointment_reminders;
begin
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  select * into q from public.appointment_reminders where id=p_id for update;
  if q.status is distinct from 'processing' or q.claim_token is distinct from p_token then raise exception 'Aquisição inválida' using errcode='23514'; end if;
  if p_result not in ('accepted','temporary','permanent','unknown') or p_result is null then raise exception 'Resultado inválido'; end if;
  update public.appointment_reminders set
    status=case when p_result='accepted' then 'sent' when p_result='temporary' and attempts<4 then 'retry' else 'failed' end,
    sent_at=case when p_result='accepted' then clock_timestamp() end,
    provider_id=case when p_result='accepted' and not simulated then left(p_provider_id,200) end,
    error_code=case p_result when 'temporary' then case when attempts<4 then 'PROVIDER_TEMPORARY' else 'ATTEMPT_LIMIT' end
      when 'permanent' then 'PROVIDER_REJECTED' when 'unknown' then 'OUTCOME_UNKNOWN' end,
    next_attempt_at=case when p_result='temporary' and attempts<4 then now()+make_interval(mins=>power(2,attempts)::integer) end,
    lease_until=null,updated_at=now() where id=p_id;
end $$;
revoke all on function public.sync_appointment_reminders(),public.reminder_change_guard(),public.reminder_service_guard(),public.reminder_changed(),
 public.save_reminder_settings(boolean,boolean,integer,integer),public.claim_appointment_reminder(boolean),
 public.finish_appointment_reminder(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_reminder_settings(boolean,boolean,integer,integer) to authenticated;
grant execute on function public.claim_appointment_reminder(boolean),public.finish_appointment_reminder(uuid,uuid,text,text) to service_role;
commit;
