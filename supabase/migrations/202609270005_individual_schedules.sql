-- Each barber owns their grid, preparation time and online booking settings.
alter table public.barbers drop constraint barbers_public_booking_key_check;
alter table public.barbers add constraint barbers_public_booking_key_check
  check (public_booking_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$');
alter table public.barbers
  add column booking_enabled boolean not null default false,
  add column slot_interval_minutes integer not null default 30 check (slot_interval_minutes in (5,10,15,20,30,45,60)),
  add column buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  add column minimum_notice_minutes integer not null default 60 check (minimum_notice_minutes between 0 and 10080),
  add column booking_horizon_days integer not null default 60 check (booking_horizon_days between 1 and 365);
alter table public.appointments add column buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120);
create function public.ensure_booking_key() returns trigger language plpgsql set search_path='' as $$
begin
  if new.booking_enabled and new.public_booking_key is null then new.public_booking_key := new.id::text; end if;
  return new;
end $$;
create trigger ensure_booking_key before insert or update on public.barbers for each row execute function public.ensure_booking_key();

create table public.barber_date_overrides (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id),
  local_date date not null,
  periods jsonb not null check (jsonb_typeof(periods)='array'),
  unique(barber_id,local_date)
);
alter table public.barber_date_overrides enable row level security;
create policy admin_all on public.barber_date_overrides for all to authenticated
using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create trigger audit_date_overrides after insert or update or delete on public.barber_date_overrides
for each row execute function public.audit_admin_change();

-- Reuse the catalog/booking transaction lock for every availability input.
create trigger catalog_write_lock before insert or update or delete on public.barber_hours for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.barber_breaks for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.barber_date_overrides for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.schedule_blocks for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.barber_services for each statement execute function public.lock_catalog_booking_changes();

create function public.validate_work_periods(p_periods jsonb) returns void language plpgsql set search_path='' as $$
declare p jsonb; b jsonb; last_end time; break_end time;
begin
  if p_periods is null or jsonb_typeof(p_periods)<>'array' then raise exception 'Períodos inválidos'; end if;
  for p in select value from jsonb_array_elements(p_periods) order by value->>'opens_at' loop
    if coalesce(p->>'opens_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(p->>'closes_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (p->>'opens_at')::time >= (p->>'closes_at')::time
      or (last_end is not null and (p->>'opens_at')::time < last_end)
      then raise exception 'Períodos inválidos ou sobrepostos'; end if;
    last_end := (p->>'closes_at')::time; break_end := null;
    if jsonb_typeof(coalesce(p->'breaks','[]'))<>'array' then raise exception 'Pausas inválidas'; end if;
    for b in select value from jsonb_array_elements(coalesce(p->'breaks','[]')) order by value->>'starts_at' loop
      if coalesce(b->>'starts_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(b->>'ends_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (b->>'starts_at')::time >= (b->>'ends_at')::time
        or (b->>'starts_at')::time < (p->>'opens_at')::time or (b->>'ends_at')::time > last_end
        or (break_end is not null and (b->>'starts_at')::time < break_end)
        then raise exception 'Pausas inválidas ou sobrepostas'; end if;
      break_end := (b->>'ends_at')::time;
    end loop;
  end loop;
end $$;

create function public.save_barber_schedule(p_barber_id uuid,p_weekday integer,p_periods jsonb,p_date date default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p jsonb; b jsonb; hour_id uuid;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  if p_weekday is null or p_weekday not between 0 and 6 then raise exception 'Dia inválido'; end if;
  if not exists(select 1 from public.barbers where id=p_barber_id) then raise exception 'Barbeiro inválido'; end if;
  perform public.validate_work_periods(p_periods);
  if exists(select 1 from public.appointments where barber_id=p_barber_id and status in ('pending','confirmed') and ends_at>now()
    and ((p_date is not null and local_date=p_date) or (p_date is null and extract(dow from starts_at at time zone 'America/Fortaleza')=p_weekday)))
    then raise exception 'Resolva os agendamentos futuros deste dia antes de alterar o expediente' using errcode='23514'; end if;
  if p_date is not null then
    insert into public.barber_date_overrides(barber_id,local_date,periods) values(p_barber_id,p_date,p_periods)
    on conflict(barber_id,local_date) do update set periods=excluded.periods;
  else
    delete from public.barber_hours where barber_id=p_barber_id and weekday=p_weekday;
    for p in select value from jsonb_array_elements(p_periods) loop
      insert into public.barber_hours(barber_id,weekday,opens_at,closes_at) values(p_barber_id,p_weekday,(p->>'opens_at')::time,(p->>'closes_at')::time) returning id into hour_id;
      for b in select value from jsonb_array_elements(coalesce(p->'breaks','[]')) loop
        insert into public.barber_breaks(barber_hour_id,starts_at,ends_at) values(hour_id,(b->>'starts_at')::time,(b->>'ends_at')::time);
      end loop;
    end loop;
  end if;
  return '{"ok":true}'::jsonb;
end $$;
create function public.remove_date_override(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.barber_date_overrides;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  select * into d from public.barber_date_overrides where id=p_id;
  if exists(select 1 from public.appointments where barber_id=d.barber_id and local_date=d.local_date and status in ('pending','confirmed') and ends_at>now())
    then raise exception 'Resolva os agendamentos deste dia antes de remover a exceção' using errcode='23514'; end if;
  delete from public.barber_date_overrides where id=p_id;
  return '{"ok":true}'::jsonb;
end $$;
create function public.apply_geovane_schedule(p_barber_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare day integer;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  if not exists(select 1 from public.barbers where id=p_barber_id and public_booking_key='geovane') then raise exception 'Selecione o cadastro vinculado a Geovane'; end if;
  if exists(select 1 from public.barber_hours where barber_id=p_barber_id) or exists(select 1 from public.barber_date_overrides where barber_id=p_barber_id)
    then raise exception 'Já existem horários. Revise-os individualmente; o modelo não sobrescreve a jornada.'; end if;
  for day in 0..6 loop
    perform public.save_barber_schedule(p_barber_id,day,case when day=0 then '[]'::jsonb else '[{"opens_at":"09:00","closes_at":"12:00"},{"opens_at":"14:00","closes_at":"20:00"}]'::jsonb end);
  end loop;
  return '{"ok":true}'::jsonb;
end $$;
revoke all on function public.save_barber_schedule(uuid,integer,jsonb,date),public.remove_date_override(uuid),public.apply_geovane_schedule(uuid) from public,anon;
grant execute on function public.save_barber_schedule(uuid,integer,jsonb,date),public.remove_date_override(uuid),public.apply_geovane_schedule(uuid) to authenticated;

-- Keep the previous API contract, using the same locked validation path.
create or replace function public.replace_barber_hours(p_barber_id uuid,p_weekday smallint,p_closed boolean,p_opens time,p_closes time,p_break_start time,p_break_end time)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_closed is null or ((p_break_start is null) <> (p_break_end is null)) then raise exception 'Horários inválidos'; end if;
  perform public.save_barber_schedule(p_barber_id,p_weekday,
    case when p_closed then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'opens_at',left(p_opens::text,5),'closes_at',left(p_closes::text,5),
      'breaks',case when p_break_start is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'starts_at',left(p_break_start::text,5),'ends_at',left(p_break_end::text,5))) end)) end);
end $$;

-- Internal schedule representation; never granted to public callers.
create function public.booking_periods(p_barber_id uuid,p_date date) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select periods from public.barber_date_overrides where barber_id=p_barber_id and local_date=p_date),
    (select jsonb_agg(jsonb_build_object('opens_at',h.opens_at,'closes_at',h.closes_at,'breaks',
      coalesce((select jsonb_agg(jsonb_build_object('starts_at',b.starts_at,'ends_at',b.ends_at)) from public.barber_breaks b where b.barber_hour_id=h.id),'[]'::jsonb)))
    from public.barber_hours h where h.barber_id=p_barber_id and h.weekday=extract(dow from p_date)), '[]'::jsonb);
$$;
create function public.booking_fits(p_barber_id uuid,p_start timestamptz,p_end timestamptz,p_buffer integer,p_ignore uuid default null)
returns boolean language sql volatile security definer set search_path='' as $$
  select p_end>p_start and exists (
    select 1 from jsonb_array_elements(public.booking_periods(p_barber_id,(p_start at time zone 'America/Fortaleza')::date)) p
    where p_start >= (((p_start at time zone 'America/Fortaleza')::date + (p->>'opens_at')::time) at time zone 'America/Fortaleza')
      and p_end + make_interval(mins=>p_buffer) <= (((p_start at time zone 'America/Fortaleza')::date + (p->>'closes_at')::time) at time zone 'America/Fortaleza')
      and not exists(select 1 from jsonb_array_elements(coalesce(p->'breaks','[]')) b where
        tstzrange(p_start,p_end+make_interval(mins=>p_buffer),'[)') && tstzrange(
          (((p_start at time zone 'America/Fortaleza')::date+(b->>'starts_at')::time) at time zone 'America/Fortaleza'),
          (((p_start at time zone 'America/Fortaleza')::date+(b->>'ends_at')::time) at time zone 'America/Fortaleza'),'[)'))
  ) and not exists(select 1 from public.schedule_blocks x where x.barber_id=p_barber_id
    and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(p_start,p_end+make_interval(mins=>p_buffer),'[)'))
  and not exists(select 1 from public.appointments a where a.barber_id=p_barber_id and a.status in ('pending','confirmed') and (p_ignore is null or a.id<>p_ignore)
    and tstzrange(a.starts_at,a.ends_at+make_interval(mins=>a.buffer_minutes),'[)') && tstzrange(p_start,p_end+make_interval(mins=>p_buffer),'[)'));
$$;
create or replace function public.validate_appointment_schedule() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('pending','confirmed') and not public.booking_fits(new.barber_id,new.starts_at,new.ends_at,new.buffer_minutes,new.id)
    then raise exception 'Horário indisponível, fora do expediente ou em intervalo' using errcode='23514'; end if;
  return new;
end $$;
-- Include preparation-time edits in the existing schedule validator.
drop trigger validate_appointment_schedule on public.appointments;
create trigger validate_appointment_schedule before insert or update of starts_at,ends_at,barber_id,status,buffer_minutes on public.appointments
for each row execute function public.validate_appointment_schedule();
create or replace function public.validate_block() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.appointments a where a.barber_id=new.barber_id and a.status in ('pending','confirmed')
    and tstzrange(a.starts_at,a.ends_at+make_interval(mins=>a.buffer_minutes),'[)') && tstzrange(new.starts_at,new.ends_at,'[)'))
    then raise exception 'Resolva os agendamentos existentes antes de bloquear este período' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.booking_periods(uuid,date),public.booking_fits(uuid,timestamptz,timestamptz,integer,uuid) from public,anon,authenticated;

-- A lock acquired after a REPEATABLE READ snapshot cannot refresh that snapshot.
create or replace function public.lock_catalog_booking_changes() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Use READ COMMITTED para alterar a agenda' using errcode='25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  return null;
end $$;

-- Direct administrative writes must obey the same protection as schedule RPCs.
create function public.guard_schedule_edit() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; incoming jsonb; item jsonb; barber uuid; weekday integer; day date;
begin
  if tg_op <> 'INSERT' then previous := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then incoming := to_jsonb(new); end if;
  if tg_table_name='barber_date_overrides' and incoming is not null then
    perform public.validate_work_periods(new.periods);
  end if;
  for item in select value from jsonb_array_elements(jsonb_build_array(previous,incoming)) where value <> 'null'::jsonb loop
    if tg_table_name='barber_breaks' then
      select h.barber_id,h.weekday into barber,weekday from public.barber_hours h where h.id=(item->>'barber_hour_id')::uuid;
    else
      barber := (item->>'barber_id')::uuid;
      weekday := (item->>'weekday')::integer;
    end if;
    day := (item->>'local_date')::date;
    if exists(select 1 from public.appointments a where a.barber_id=barber and a.status in ('pending','confirmed')
      and a.ends_at+make_interval(mins=>a.buffer_minutes)>now()
      and ((day is not null and a.local_date=day) or (weekday is not null and extract(dow from a.local_date)=weekday))) then
      raise exception 'Resolva os agendamentos deste dia antes de alterar o expediente' using errcode='23514';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger guard_schedule_edit before insert or update or delete on public.barber_hours for each row execute function public.guard_schedule_edit();
create trigger guard_schedule_edit before insert or update or delete on public.barber_breaks for each row execute function public.guard_schedule_edit();
create trigger guard_schedule_edit before insert or update or delete on public.barber_date_overrides for each row execute function public.guard_schedule_edit();

-- Preparation is captured on creation/rescheduling, before schedule validation.
-- Duration and price snapshots cannot be rewritten by a rescheduling request.
create function public.prepare_appointment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.total_duration_minutes is distinct from old.total_duration_minutes
      or new.total_price is distinct from old.total_price then
      raise exception 'A remarcação deve preservar duração e valor dos serviços' using errcode='23514';
    end if;
    if new.starts_at=old.starts_at and new.barber_id=old.barber_id then
      new.buffer_minutes := old.buffer_minutes;
      return new;
    end if;
  end if;
  select b.buffer_minutes into new.buffer_minutes from public.barbers b where b.id=new.barber_id;
  return new;
end $$;
create trigger a_prepare_appointment before insert or update on public.appointments for each row execute function public.prepare_appointment();

-- Supabase installations may grant EXECUTE directly through default privileges.
revoke all on function public.ensure_booking_key(),public.guard_schedule_edit(),public.prepare_appointment(),
  public.lock_catalog_booking_changes(),public.validate_appointment_schedule(),public.validate_block(),
  public.audit_admin_change(),public.refresh_client_last_visit(),public.guard_catalog_deactivation(),public.guard_booking_active_catalog(),
  public.validate_work_periods(jsonb),public.save_barber_schedule(uuid,integer,jsonb,date),public.remove_date_override(uuid),public.apply_geovane_schedule(uuid),
  public.replace_barber_hours(uuid,smallint,boolean,time,time,time,time),public.catalog_deletion_preview(text,uuid),public.deactivate_catalog_item(text,uuid),
  public.admin_authorized(),public.is_admin_member() from public,anon,authenticated;
grant execute on function public.validate_work_periods(jsonb),public.save_barber_schedule(uuid,integer,jsonb,date),public.remove_date_override(uuid),public.apply_geovane_schedule(uuid),
  public.replace_barber_hours(uuid,smallint,boolean,time,time,time,time),public.catalog_deletion_preview(text,uuid),public.deactivate_catalog_item(text,uuid),
  public.admin_authorized(),public.is_admin_member() to authenticated;
revoke all on public.barber_date_overrides from public,anon,authenticated;
grant select,insert,update,delete on public.barber_date_overrides to authenticated;
-- TRUNCATE bypasses RLS; application roles never need it (nor trigger creation).
revoke truncate,references,trigger on public.barbers,public.services,public.barber_services,public.appointments,
  public.appointment_services,public.barber_hours,public.barber_breaks,public.schedule_blocks,public.clients,
  public.admins,public.admin_audit_log,public.notification_settings,public.notifications,public.notification_attempts from public,anon,authenticated;
