-- Read-only inventory. Compare with locally applied 001-008 before installing 009.
select current_setting('server_version') as version;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name in ('appointments','appointment_services','barbers','clients','notification_settings','notifications','barber_history_ids','barber_deletions')
order by table_name,ordinal_position;
select conrelid::regclass as source,confrelid::regclass as target,conname,pg_get_constraintdef(oid)
from pg_constraint where conrelid in ('public.appointments'::regclass,'public.clients'::regclass,'public.barbers'::regclass,'public.appointment_services'::regclass);
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in
('public.appointments'::regclass,'public.clients'::regclass,'public.barbers'::regclass,'public.appointment_services'::regclass);
select p.oid::regprocedure,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('admin_authorized','lock_catalog_booking_changes','preserve_deleted_barber_history','permanently_delete_barber','create_public_booking');
select * from pg_policies where schemaname='public' and tablename in ('clients','barbers','appointments','appointment_services');
select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role');
select defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl from pg_default_acl;
select to_regclass('public.reminder_settings') as settings_009,to_regclass('public.appointment_reminders') as queue_009;
