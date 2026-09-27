-- Service photographs remain private; only administrators with MFA can access them.
alter table public.services add column if not exists photo_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', false, 2097152, array['image/jpeg','image/png','image/webp']);
create policy admin_service_photo_read on storage.objects for select to authenticated
using (bucket_id = 'service-photos' and (select public.admin_authorized()));
create policy admin_service_photo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'service-photos' and (select public.admin_authorized()));
create policy admin_service_photo_delete on storage.objects for delete to authenticated
using (bucket_id = 'service-photos' and (select public.admin_authorized()));
