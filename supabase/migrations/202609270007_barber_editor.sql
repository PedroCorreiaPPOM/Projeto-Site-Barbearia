-- Complete barber editor: atomic writes, existing RLS/MFA and agenda locks.
create function public.barber_editor_snapshot(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('barber',to_jsonb(b),
    'hours',coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.barber_hours h where h.barber_id=b.id),'[]'),
    'breaks',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.barber_breaks x join public.barber_hours h on h.id=x.barber_hour_id where h.barber_id=b.id),'[]'),
    'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.service_id) from public.barber_services x where x.barber_id=b.id),'[]'),
    'overrides',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.barber_date_overrides x where x.barber_id=b.id),'[]'),
    'blocks',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.schedule_blocks x where x.barber_id=b.id),'[]'))
  from public.barbers b where b.id=p_id and public.admin_authorized();
$$;

create function public.save_barber_profile(p_id uuid,p_profile jsonb,p_expected jsonb default null) returns jsonb
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
revoke all on function public.barber_editor_snapshot(uuid),public.save_barber_profile(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.barber_editor_snapshot(uuid),public.save_barber_profile(uuid,jsonb,jsonb) to authenticated;
