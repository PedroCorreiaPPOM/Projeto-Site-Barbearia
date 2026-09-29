-- Read-only metadata inventory for the real destination before migration 008.
-- No customer records, photographs, tokens or credentials are returned.
select current_setting('server_version') as server_version; -- security_invoker views require PostgreSQL 15+.
select c.conrelid::regclass as source_table,c.conname,c.confrelid::regclass as target_table,
  pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c
where c.contype='f' and c.confrelid in (
  'public.barbers'::regclass,'public.barber_hours'::regclass,'public.barber_breaks'::regclass,
  'public.barber_services'::regclass,'public.barber_date_overrides'::regclass,'public.schedule_blocks'::regclass,
  'public.appointments'::regclass,'public.appointment_services'::regclass,'public.clients'::regclass,
  'public.services'::regclass,'auth.users'::regclass)
  or (c.contype='f' and c.conrelid='public.appointments'::regclass)
order by c.conrelid::regclass::text,c.conname;
select tgrelid::regclass as table_name,tgname,pg_get_triggerdef(oid) as definition
from pg_catalog.pg_trigger where not tgisinternal and tgrelid in (
  'public.barbers'::regclass,'public.appointments'::regclass,'public.barber_hours'::regclass,
  'public.barber_breaks'::regclass,'public.barber_services'::regclass,'public.appointment_services'::regclass,
  'public.barber_date_overrides'::regclass,'public.schedule_blocks'::regclass);
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where (schemaname='public' and tablename in ('barbers','appointments','appointment_services','clients','services','admins','admin_audit_log','barber_hours','barber_breaks',
  'barber_services','barber_date_overrides','schedule_blocks','barber_history_ids','barber_deletions','barber_photo_cleanup')) or (schemaname='storage' and tablename='objects');
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('admin_authorized','lock_catalog_booking_changes','audit_admin_change',
  'prepare_appointment','validate_appointment_schedule','guard_booking_active_catalog','refresh_client_last_visit','catalog_deletion_preview');
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where (table_schema='public' and table_name in ('appointments','appointment_services','barbers','admin_audit_log'))
  or (table_schema='auth' and table_name='users' and column_name in ('id','raw_user_meta_data')) order by table_schema,table_name,ordinal_position;
-- Views/reports referencing appointments or the operational barber profile must use LEFT JOINs.
select distinct v.oid::regclass as dependent_view,pg_get_viewdef(v.oid,true) as definition
from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class v on v.oid=r.ev_class
where d.refobjid in ('public.appointments'::regclass,'public.barbers'::regclass) and v.relkind in ('v','m');
select r.rolname,r.rolsuper,r.rolbypassrls from pg_roles r where r.rolname in ('anon','authenticated');
select pg_get_userbyid(defaclrole) as owner,defaclnamespace::regnamespace as schema,defaclobjtype,defaclacl from pg_default_acl;
