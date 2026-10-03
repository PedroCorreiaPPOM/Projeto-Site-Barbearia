-- Read-only inventory: run against the destination before applying 005/006.
-- Returns schema/security metadata only; never returns client records or secrets.
select current_setting('server_version') as postgres_version,
  current_setting('transaction_isolation') as isolation;

select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'barbers','services','barber_services','appointments','appointment_services','clients',
  'barber_hours','barber_breaks','schedule_blocks','barber_date_overrides','booking_requests')
order by table_name,ordinal_position;

select c.relname as table_name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as owner,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;

select c.conrelid::regclass::text as table_name,c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_namespace n on n.oid=c.connamespace
where n.nspname='public' order by table_name,c.conname;

select p.oid::regprocedure::text as signature,p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' and p.proname in (
  'admin_authorized','is_admin_member','lock_catalog_booking_changes',
  'validate_appointment_schedule','validate_block','replace_barber_hours',
  'guard_catalog_deactivation','guard_booking_active_catalog','public_booking_barbers',
  'booking_periods','booking_fits','create_public_booking','public_available_slots')
order by signature;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select tgrelid::regclass::text as table_name,tgname,pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and tgrelid in (
  select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
order by table_name,tgname;
select pg_get_userbyid(defaclrole) as owner,defaclnamespace::regnamespace as schema,
  defaclobjtype,defaclacl from pg_default_acl;
select rolname,rolsuper,rolinherit,rolbypassrls from pg_roles
where rolname in ('anon','authenticated','service_role');
select member.rolname as member,parent.rolname as inherited_role
from pg_auth_members m join pg_roles member on member.oid=m.member
join pg_roles parent on parent.oid=m.roleid
where member.rolname in ('anon','authenticated');
select extname,extversion,extnamespace::regnamespace as schema from pg_extension
where extname in ('pgcrypto','btree_gist');
