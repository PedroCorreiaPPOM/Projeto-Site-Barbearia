begin;
alter table public.reminder_settings
  add column client_unit text not null default 'minutes' check(client_unit in ('minutes','hours','days')),
  add column barber_unit text not null default 'minutes' check(barber_unit in ('minutes','hours','days'));
-- Legacy data has no record of the chosen unit. Infer only exact, friendly units once.
update public.reminder_settings set
  client_unit=case when client_minutes%1440=0 then 'days' when client_minutes%60=0 then 'hours' else 'minutes' end,
  barber_unit=case when barber_minutes%1440=0 then 'days' when barber_minutes%60=0 then 'hours' else 'minutes' end;

-- Retain the four-argument RPC for older clients. It preserves the stored units.
-- Reuse its MFA check, booking lock, processing guard and queue synchronization.
create function public.save_reminder_settings(p_client_enabled boolean,p_barber_enabled boolean,
  p_client_minutes integer,p_barber_minutes integer,p_client_unit text,p_barber_unit text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_client_unit is null or p_barber_unit is null
    or p_client_unit not in ('minutes','hours','days') or p_barber_unit not in ('minutes','hours','days') then
    raise exception 'Unidade inválida. Use minutos, horas ou dias.' using errcode='22023'; end if;
  perform public.save_reminder_settings(p_client_enabled,p_barber_enabled,p_client_minutes,p_barber_minutes);
  update public.reminder_settings set client_unit=p_client_unit,barber_unit=p_barber_unit where id;
end $$;
revoke all on function public.save_reminder_settings(boolean,boolean,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_reminder_settings(boolean,boolean,integer,integer,text,text) to authenticated;
commit;
