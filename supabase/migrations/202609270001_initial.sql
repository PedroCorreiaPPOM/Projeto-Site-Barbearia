-- All local appointment dates/times are interpreted in America/Fortaleza.
-- Absolute instants are stored as timestamptz. Apply via Supabase migrations.
create extension if not exists pgcrypto;

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.barbers (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 2 and 120),
  photo_path text, active boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now()
);
create table public.services (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  description text not null default '', price numeric(10,2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  active boolean not null default true, created_at timestamptz not null default now()
);
create table public.barber_services (
  barber_id uuid not null references public.barbers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (barber_id, service_id)
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 200),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  booking_contact_consent boolean not null default false,
  marketing_consent boolean not null default false,
  marketing_consented_at timestamptz,
  marketing_revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_visit_at timestamptz,
  constraint marketing_timestamp_consistency check (not marketing_consent or marketing_consented_at is not null)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
  barber_id uuid not null references public.barbers(id),
  local_date date not null, starts_at timestamptz not null, ends_at timestamptz not null,
  total_price numeric(10,2) not null check (total_price >= 0),
  total_duration_minutes integer not null check (total_duration_minutes > 0),
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled','no_show')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at = starts_at + total_duration_minutes * interval '1 minute'),
  check (local_date = (starts_at at time zone 'America/Fortaleza')::date)
);
create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  service_name text not null, price numeric(10,2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  primary key (appointment_id, service_id)
);
create table public.barber_hours (
  id uuid primary key default gen_random_uuid(), barber_id uuid not null references public.barbers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null, closes_at time not null, check (closes_at > opens_at),
  unique (barber_id, weekday, opens_at)
);
create table public.barber_breaks (
  id uuid primary key default gen_random_uuid(), barber_hour_id uuid not null references public.barber_hours(id) on delete cascade,
  starts_at time not null, ends_at time not null, check (ends_at > starts_at)
);
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(), barber_id uuid not null references public.barbers(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null,
  reason text not null default '', kind text not null check (kind in ('time_off','exception','block')),
  check (ends_at > starts_at)
);
create table public.notification_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false, inactivity_days integer not null default 30 check (inactivity_days between 1 and 365),
  channel text not null default 'none' check (channel in ('none','whatsapp','sms','email')),
  template text not null default '', updated_at timestamptz not null default now()
);
insert into public.notification_settings (id) values (true);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id),
  kind text not null check (kind in ('booking','reminder','inactive_client')),
  channel text not null check (channel in ('whatsapp','sms','email')),
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  scheduled_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now()
);
create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
  attempted_at timestamptz not null default now(), success boolean not null,
  provider_reference text, error_code text
);
create table public.admin_audit_log (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
  action text not null, entity_type text not null, entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index appointments_barber_time on public.appointments (barber_id, starts_at, ends_at);
create index appointments_client_time on public.appointments (client_id, starts_at desc);
create index appointments_status_time on public.appointments (status, starts_at);
create index schedule_blocks_barber_time on public.schedule_blocks (barber_id, starts_at, ends_at);
create index barber_hours_barber_weekday on public.barber_hours (barber_id, weekday);
create index notifications_due on public.notifications (status, scheduled_at);
create index notification_attempts_notification on public.notification_attempts (notification_id, attempted_at desc);
create index admin_audit_log_time on public.admin_audit_log (occurred_at desc);

-- Security definer reads only the caller's own membership; no public roster exposure.
create function public.is_admin_member() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin_member() from public, anon;
grant execute on function public.is_admin_member() to authenticated;
create function public.admin_authorized() returns boolean language sql stable security definer
set search_path = '' as $$
  select (select public.is_admin_member()) and (select auth.jwt() ->> 'aal') = 'aal2';
$$;
revoke all on function public.admin_authorized() from public, anon;
grant execute on function public.admin_authorized() to authenticated;

alter table public.admins enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.barber_services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.barber_hours enable row level security;
alter table public.barber_breaks enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.admin_audit_log enable row level security;

-- Admin mutations use authenticated user JWT; membership and MFA are checked by RLS.
create policy admin_all on public.admins for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.barbers for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.services for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.barber_services for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.clients for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.appointments for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.appointment_services for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.barber_hours for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.barber_breaks for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.schedule_blocks for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.notification_settings for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.notifications for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_all on public.notification_attempts for all to authenticated using ((select public.admin_authorized())) with check ((select public.admin_authorized()));
create policy admin_read on public.admin_audit_log for select to authenticated using ((select public.admin_authorized()));
-- Audit entries are appended by trusted server/trigger code; no direct client writes.

-- Private object storage. Signed reads and writes require authorized admin + MFA.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('barber-photos', 'barber-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy admin_photo_read on storage.objects for select to authenticated
using (bucket_id = 'barber-photos' and (select public.admin_authorized()));
create policy admin_photo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'barber-photos' and (select public.admin_authorized()));
create policy admin_photo_update on storage.objects for update to authenticated
using (bucket_id = 'barber-photos' and (select public.admin_authorized()))
with check (bucket_id = 'barber-photos' and (select public.admin_authorized()));
create policy admin_photo_delete on storage.objects for delete to authenticated
using (bucket_id = 'barber-photos' and (select public.admin_authorized()));
