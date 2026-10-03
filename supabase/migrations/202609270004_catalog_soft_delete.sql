-- Logical deletion reuses active=false. No historical rows or objects are deleted.
alter table public.barbers add column public_booking_key text unique
  check (public_booking_key in ('geovane', 'daniel'));

-- Serialize catalog and booking mutations before row locks are acquired.
-- Shared by direct RLS writes and RPCs, closing the check/update race.
create function public.lock_catalog_booking_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(270004, 1);
  return null;
end $$;
create trigger catalog_write_lock before insert or update or delete on public.barbers
for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.services
for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.appointments
for each statement execute function public.lock_catalog_booking_changes();
create trigger catalog_write_lock before insert or update or delete on public.appointment_services
for each statement execute function public.lock_catalog_booking_changes();

create function public.guard_catalog_deactivation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.active = false then
    if exists (
      select 1 from public.appointments a
      where a.status in ('pending','confirmed') and a.ends_at > now()
        and ((tg_table_name = 'barbers' and a.barber_id = new.id)
          or (tg_table_name = 'services' and exists (
            select 1 from public.appointment_services s
            where s.appointment_id = a.id and s.service_id = new.id)))
    ) then
      raise exception 'Existem atendimentos futuros ou em andamento. Resolva-os antes de excluir ou desativar.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_catalog_deactivation before update of active on public.barbers
for each row execute function public.guard_catalog_deactivation();
create trigger guard_catalog_deactivation before update of active on public.services
for each row execute function public.guard_catalog_deactivation();

-- Historical completed/cancelled appointments remain readable and unchanged.
create function public.guard_booking_active_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
declare booking public.appointments;
begin
  if tg_table_name = 'appointments' then booking := new;
  else select * into booking from public.appointments where id = new.appointment_id;
  end if;
  if booking.status in ('pending','confirmed') and booking.ends_at > now() then
    if not exists (select 1 from public.barbers where id = booking.barber_id and active) then
      raise exception 'Barbeiro indisponível para novos agendamentos.' using errcode = '23514';
    end if;
    if tg_table_name = 'appointment_services' then
      if not exists (select 1 from public.services where id = new.service_id and active) then
        raise exception 'Serviço indisponível para novos agendamentos.' using errcode = '23514';
      end if;
    elsif exists (select 1 from public.appointment_services s join public.services c on c.id = s.service_id
      where s.appointment_id = booking.id and not c.active) then
      raise exception 'O agendamento possui um serviço inativo.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_booking_active_catalog before insert or update on public.appointments
for each row execute function public.guard_booking_active_catalog();
create trigger guard_booking_active_catalog before insert or update on public.appointment_services
for each row execute function public.guard_booking_active_catalog();

create function public.catalog_deletion_preview(p_kind text, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare related jsonb;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('barber','service') or p_id is null then raise exception 'Seleção inválida'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
    'client_name', c.full_name, 'barber_name', b.name,
    'service_names', (select string_agg(s.service_name, ', ') from public.appointment_services s where s.appointment_id = a.id)
  ) order by a.starts_at), '[]'::jsonb) into related
  from public.appointments a join public.clients c on c.id = a.client_id join public.barbers b on b.id = a.barber_id
  where a.status in ('pending','confirmed') and a.ends_at > now()
    and ((p_kind = 'barber' and a.barber_id = p_id) or (p_kind = 'service' and exists (
      select 1 from public.appointment_services s where s.appointment_id = a.id and s.service_id = p_id)));
  return jsonb_build_object('count', jsonb_array_length(related), 'appointments', related);
end $$;

create function public.deactivate_catalog_item(p_kind text, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_kind = 'barber' then update public.barbers set active = false where id = p_id;
  elsif p_kind = 'service' then update public.services set active = false where id = p_id;
  else raise exception 'Seleção inválida'; end if;
  if not found then raise exception 'Registro não encontrado'; end if;
  return jsonb_build_object('id', p_id, 'active', false);
end $$;
revoke all on function public.catalog_deletion_preview(text,uuid), public.deactivate_catalog_item(text,uuid) from public, anon;
grant execute on function public.catalog_deletion_preview(text,uuid), public.deactivate_catalog_item(text,uuid) to authenticated;

-- Deliberately narrow public projection. No clients, schedules, photos or settings.
create function public.public_booking_barbers() returns table (booking_key text)
language sql stable security definer set search_path = '' as $$
  select public_booking_key from public.barbers where active and public_booking_key is not null;
$$;
revoke all on function public.public_booking_barbers() from public;
grant execute on function public.public_booking_barbers() to anon, authenticated;
