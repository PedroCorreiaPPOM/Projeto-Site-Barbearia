-- Read-only inventory before 011. Expect 001-010 already applied and the four-argument RPC.
select current_setting('server_version') as version;
select column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name='reminder_settings' order by ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.reminder_settings'::regclass;
select relname,relrowsecurity,relowner::regrole from pg_class where oid='public.reminder_settings'::regclass;
select * from pg_policies where schemaname='public' and tablename in ('reminder_settings','appointment_reminders');
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('reminder_settings','appointment_reminders');
select p.oid::regprocedure,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('admin_authorized','save_reminder_settings','sync_appointment_reminders','claim_appointment_reminder');
select tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid='public.reminder_settings'::regclass;
select to_regprocedure('public.save_reminder_settings(boolean,boolean,integer,integer,text,text)') as rpc_011;
