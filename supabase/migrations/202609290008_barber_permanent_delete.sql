-- Permanent deletion is separate from active=false. Storage is cleaned via its API.
begin;
lock table public.barbers,public.appointments in share row exclusive mode;
-- Tombstones reserve deleted namespaces, including late signed uploads.
-- Keep the original appointment.barber_id, NOT NULL and referential integrity.
-- Only this technical identity survives deletion of the operational profile.
create table public.barber_history_ids (id uuid primary key);
insert into public.barber_history_ids(id) select id from public.barbers;
alter table public.barber_history_ids enable row level security;
revoke all on public.barber_history_ids from public,anon,authenticated;
grant select on public.barber_history_ids to authenticated;
create policy admin_read on public.barber_history_ids for select to authenticated using ((select public.admin_authorized()));
do $$
declare fk text;
begin
  select c.conname into strict fk from pg_catalog.pg_constraint c
  where c.contype='f' and c.conrelid='public.appointments'::regclass and c.confrelid='public.barbers'::regclass
    and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='barber_id')]::smallint[]
    and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[];
  execute format('alter table public.appointments drop constraint %I',fk);
end $$;
alter table public.appointments add constraint appointments_barber_history_id_fkey
  foreign key(barber_id) references public.barber_history_ids(id) on delete restrict;
create function public.remember_barber_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.barber_history_ids(id) values(new.id);
  return new;
end $$;
create trigger remember_barber_identity after insert on public.barbers for each row execute function public.remember_barber_identity();

create table public.barber_deletions (
  barber_id uuid primary key references public.barber_history_ids(id) on delete restrict,
  barber_name text not null,
  deleted_by uuid not null,
  deleted_by_name text,
  photo_path text,
  -- No FK to auth.users: account removal must not erase the verified actor UUID.
  deleted_at timestamptz not null default clock_timestamp()
);
create table public.barber_photo_cleanup (
  path text primary key,
  barber_id uuid not null references public.barber_deletions(barber_id),
  completed_at timestamptz
);
alter table public.barber_deletions enable row level security;
alter table public.barber_photo_cleanup enable row level security;
revoke all on public.barber_deletions,public.barber_photo_cleanup from public,anon,authenticated;
grant select on public.barber_deletions,public.barber_photo_cleanup to authenticated;
create policy admin_read on public.barber_deletions for select to authenticated using ((select public.admin_authorized()));
create policy admin_read on public.barber_photo_cleanup for select to authenticated using ((select public.admin_authorized()));

create function public.guard_deleted_barber() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from public.barber_deletions where barber_id=old.id) then
      raise exception 'Use a operação de exclusão definitiva com confirmação' using errcode='42501';
    end if;
    if exists(select 1 from public.appointments where barber_id=old.id
      and (status not in ('completed','cancelled') or ends_at>now())) then
      raise exception 'Resolva os atendimentos pendentes, confirmados, futuros ou em andamento antes de excluir.' using errcode='23514';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and new.id is distinct from old.id then
    raise exception 'O identificador do barbeiro não pode ser alterado' using errcode='23514';
  end if;
  if exists(select 1 from public.barber_deletions where barber_id=new.id) then
    raise exception 'Este identificador foi excluído definitivamente' using errcode='23514';
  end if;
  if new.photo_path is not null and (tg_op='INSERT' or new.photo_path is distinct from old.photo_path) and (
    exists(select 1 from public.barber_photo_cleanup where path=new.photo_path)
    or exists(select 1 from public.barber_deletions where barber_id::text=split_part(new.photo_path,'/',1))) then
    raise exception 'Esta fotografia está reservada para remoção. Envie uma nova imagem.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_deleted_barber before insert or update or delete on public.barbers
for each row execute function public.guard_deleted_barber();

-- Closed appointments and service snapshots of deleted barbers are immutable.
-- Also disallow new appointments (even backdated) for an archived identity.
create function public.preserve_deleted_barber_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_barber uuid; new_barber uuid;
begin
  if tg_table_name='appointments' then
    if tg_op<>'INSERT' then old_barber:=old.barber_id; end if;
    if tg_op<>'DELETE' then new_barber:=new.barber_id; end if;
  else
    if tg_op<>'INSERT' then select barber_id into old_barber from public.appointments where id=old.appointment_id; end if;
    if tg_op<>'DELETE' then select barber_id into new_barber from public.appointments where id=new.appointment_id; end if;
  end if;
  if exists(select 1 from public.barber_deletions where barber_id=old_barber or barber_id=new_barber) then
    raise exception 'Histórico preservado: o barbeiro foi excluído. Não é permitido criar, alterar ou apagar estes atendimentos.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger a0_preserve_deleted_barber_history before insert or update or delete on public.appointments
for each row execute function public.preserve_deleted_barber_history();
create trigger a0_preserve_deleted_barber_history before insert or update or delete on public.appointment_services
for each row execute function public.preserve_deleted_barber_history();

-- Reports must use LEFT JOINs: deleting the operational profile never hides rows.
create view public.appointment_history with (security_invoker=true) as
select a.*,coalesce(d.barber_name,b.name) as barber_name,d.deleted_at as barber_deleted_at,
  d.deleted_by as barber_deleted_by,d.deleted_by_name as barber_deleted_by_name
from public.appointments a left join public.barbers b on b.id=a.barber_id
left join public.barber_deletions d on d.barber_id=a.barber_id;
revoke all on public.appointment_history from public,anon,authenticated;
grant select on public.appointment_history to authenticated;

create function public.permanently_delete_barber(p_id uuid,p_confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare barber public.barbers; actor uuid; actor_name text;
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED' using errcode='25000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  select * into barber from public.barbers where id=p_id for update;
  if not found then raise exception 'Barbeiro não encontrado. Atualize a listagem.' using errcode='22023'; end if;
  if p_confirm_name is distinct from barber.name then raise exception 'Digite o nome exato do barbeiro para confirmar.' using errcode='22023'; end if;
  if exists(select 1 from public.appointments where barber_id=p_id
    and (status not in ('completed','cancelled') or ends_at>now())) then
    raise exception 'Exclusão bloqueada: resolva os atendimentos pendentes, confirmados, futuros ou em andamento. Somente concluídos ou cancelados já encerrados permitem excluir.' using errcode='23514';
  end if;
  -- Refuse schema drift, including newly introduced cascading references.
  if exists(select 1 from pg_catalog.pg_constraint c where c.contype='f'
    and c.confrelid in ('public.barbers'::regclass,'public.barber_hours'::regclass,'public.barber_breaks'::regclass,
      'public.barber_services'::regclass,'public.barber_date_overrides'::regclass,'public.schedule_blocks'::regclass)
    and not (
      (c.confrelid='public.barbers'::regclass and c.conrelid in ('public.barber_hours'::regclass,
        'public.barber_services'::regclass,'public.barber_date_overrides'::regclass,'public.schedule_blocks'::regclass)
        and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='barber_id')]::smallint[])
      or (c.confrelid='public.barber_hours'::regclass and c.conrelid='public.barber_breaks'::regclass
        and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='barber_hour_id')]::smallint[]))) then
    raise exception 'Há referências adicionais no esquema. Revise-as antes de excluir; use Desativar.' using errcode='23514';
  end if;
  actor := auth.uid();
  select nullif(trim(to_jsonb(u)->'raw_user_meta_data'->>'full_name'),'') into actor_name from auth.users u where u.id=actor;
  insert into public.barber_deletions(barber_id,barber_name,deleted_by,deleted_by_name,photo_path)
    values(p_id,barber.name,actor,actor_name,barber.photo_path);
  -- Explicitly remove owned rows; never delete appointments, clients or services.
  delete from public.barber_breaks where barber_hour_id in(select id from public.barber_hours where barber_id=p_id);
  delete from public.barber_hours where barber_id=p_id;
  delete from public.barber_services where barber_id=p_id;
  delete from public.barber_date_overrides where barber_id=p_id;
  delete from public.schedule_blocks where barber_id=p_id;
  delete from public.barbers where id=p_id;
  -- Preserve files still referenced by another barber. Reserve unused paths now.
  insert into public.barber_photo_cleanup(path,barber_id)
    select o.name,p_id from storage.objects o where o.bucket_id='barber-photos'
      and (split_part(o.name,'/',1)=p_id::text or o.name=barber.photo_path)
      and not exists(select 1 from public.barbers b where b.photo_path=o.name)
    on conflict(path) do nothing;
  return jsonb_build_object('id',p_id,'deleted',true);
end $$;

-- Rescan tombstones to cover uploads whose signed URL was issued before deletion.
create function public.pending_barber_photo_cleanup() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED' using errcode='25000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  insert into public.barber_photo_cleanup(path,barber_id)
    select distinct on(o.name) o.name,d.barber_id from storage.objects o join public.barber_deletions d
      on split_part(o.name,'/',1)=d.barber_id::text or o.name=d.photo_path
    where o.bucket_id='barber-photos' and not exists(select 1 from public.barbers b where b.photo_path=o.name)
    order by o.name,d.barber_id
    on conflict(path) do update set completed_at=null;
  return jsonb_build_object('paths',coalesce((select jsonb_agg(path order by path) from
    (select path from public.barber_photo_cleanup where completed_at is null order by path limit 100) x),'[]'::jsonb),
    'pending',(select count(*) from public.barber_photo_cleanup where completed_at is null));
end $$;

create function public.complete_barber_photo_cleanup(p_paths text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.admin_authorized() is not true then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(270004,1);
  -- Never mark a remaining object as removed. Storage metadata is read-only here.
  update public.barber_photo_cleanup q set completed_at=now() where q.path=any(p_paths)
    and not exists(select 1 from storage.objects o where o.bucket_id='barber-photos' and o.name=q.path);
end $$;
revoke all on function public.remember_barber_identity(),public.preserve_deleted_barber_history(),public.guard_deleted_barber(),public.permanently_delete_barber(uuid,text),
  public.pending_barber_photo_cleanup(),public.complete_barber_photo_cleanup(text[]) from public,anon,authenticated;
grant execute on function public.permanently_delete_barber(uuid,text),public.pending_barber_photo_cleanup(),
  public.complete_barber_photo_cleanup(text[]) to authenticated;
commit;
