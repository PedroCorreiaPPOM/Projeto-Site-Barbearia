-- Additive changes for the administrative panel.
create extension if not exists btree_gist;
alter table public.barbers add column if not exists description text not null default '';
alter table public.notification_settings add column if not exists reminder_minutes integer not null default 1440 check (reminder_minutes between 15 and 10080);

-- Prevent concurrent bookings for one barber, including simultaneous requests.
alter table public.appointments add constraint appointments_no_overlap
exclude using gist (barber_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
where (status in ('pending','confirmed'));

create or replace function public.validate_appointment_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  local_start timestamp := new.starts_at at time zone 'America/Fortaleza';
  local_end timestamp := new.ends_at at time zone 'America/Fortaleza';
  wday integer := extract(dow from local_start);
begin
  if new.status in ('pending','confirmed') then
    if local_start::date <> local_end::date or not exists (
      select 1 from public.barber_hours h
      where h.barber_id = new.barber_id and h.weekday = wday
        and local_start::time >= h.opens_at and local_end::time <= h.closes_at
        and not exists (
          select 1 from public.barber_breaks b where b.barber_hour_id = h.id
            and local_start::time < b.ends_at and local_end::time > b.starts_at
        )
    ) then raise exception 'Horário fora do expediente ou intervalo' using errcode = '23514'; end if;
    if exists (select 1 from public.schedule_blocks x
      where x.barber_id = new.barber_id and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)'))
    then raise exception 'Horário bloqueado' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger validate_appointment_schedule before insert or update of starts_at, ends_at, barber_id, status
on public.appointments for each row execute function public.validate_appointment_schedule();

-- Log changes centrally instead of trusting clients to write the audit trail.
create or replace function public.audit_admin_change() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), tg_op, tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    jsonb_build_object('at', now()));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger audit_appointments after insert or update or delete on public.appointments for each row execute function public.audit_admin_change();
create trigger audit_barbers after insert or update or delete on public.barbers for each row execute function public.audit_admin_change();
create trigger audit_services after insert or update or delete on public.services for each row execute function public.audit_admin_change();
create trigger audit_clients after insert or update or delete on public.clients for each row execute function public.audit_admin_change();
create trigger audit_schedule_blocks after insert or update or delete on public.schedule_blocks for each row execute function public.audit_admin_change();

-- RLS already enabled in migration 001. No public data policies are added.

create or replace function public.replace_barber_hours(p_barber_id uuid, p_weekday smallint, p_closed boolean, p_opens time, p_closes time, p_break_start time, p_break_end time)
returns void language plpgsql security invoker set search_path = '' as $$
declare new_hour uuid;
begin
  if not (select public.admin_authorized()) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_weekday not between 0 and 6 then raise exception 'Dia inválido'; end if;
  if exists (select 1 from public.appointments a where a.barber_id = p_barber_id and a.starts_at >= now()
    and a.status in ('pending','confirmed') and extract(dow from a.starts_at at time zone 'America/Fortaleza') = p_weekday)
  then raise exception 'Remarque os atendimentos futuros deste dia antes de alterar o expediente'; end if;
  if not p_closed and (p_opens is null or p_closes is null or p_opens >= p_closes
    or ((p_break_start is null) <> (p_break_end is null))
    or (p_break_start is not null and (p_break_start < p_opens or p_break_end > p_closes or p_break_start >= p_break_end)))
  then raise exception 'Horários inválidos'; end if;
  delete from public.barber_hours where barber_id = p_barber_id and weekday = p_weekday;
  if not p_closed then
    insert into public.barber_hours(barber_id,weekday,opens_at,closes_at)
    values(p_barber_id,p_weekday,p_opens,p_closes) returning id into new_hour;
    if p_break_start is not null then
      insert into public.barber_breaks(barber_hour_id,starts_at,ends_at) values(new_hour,p_break_start,p_break_end);
    end if;
  end if;
end $$;
revoke all on function public.replace_barber_hours(uuid,smallint,boolean,time,time,time,time) from public, anon;
grant execute on function public.replace_barber_hours(uuid,smallint,boolean,time,time,time,time) to authenticated;

create or replace function public.validate_block() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.appointments a where a.barber_id = new.barber_id
    and a.status in ('pending','confirmed')
    and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)'))
  then raise exception 'Remarque os agendamentos existentes antes de bloquear este período' using errcode='23514'; end if;
  return new;
end $$;
create trigger validate_block before insert or update on public.schedule_blocks
for each row execute function public.validate_block();

create or replace function public.refresh_client_last_visit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clients c set last_visit_at = (
    select max(a.ends_at) from public.appointments a
    where a.client_id = c.id and a.status = 'completed'
  ) where c.id = new.client_id;
  return new;
end $$;
create trigger refresh_client_last_visit after insert or update of status, ends_at on public.appointments
for each row execute function public.refresh_client_last_visit();
