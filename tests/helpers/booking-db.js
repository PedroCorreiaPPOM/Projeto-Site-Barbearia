import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

export const ids={barber:"10000000-0000-0000-0000-000000000001",other:"10000000-0000-0000-0000-000000000002",cut:"20000000-0000-0000-0000-000000000001",beard:"20000000-0000-0000-0000-000000000002",admin:"40000000-0000-0000-0000-000000000001"};
export async function bookingDatabase(connection) {
  const db=connection || new PGlite({extensions:{pgcrypto,btree_gist}});
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated;`);
  for(const name of ["202609270001_initial","202609270002_admin_panel","202609270003_service_photos","202609270004_catalog_soft_delete","202609270005_individual_schedules","202609270006_public_booking","202609270007_barber_editor"])
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),"utf8"));
  await db.exec(`grant usage on schema public,auth,storage to anon,authenticated;
    grant select on storage.objects to anon,authenticated;
    grant usage on all sequences in schema public to authenticated;
    insert into auth.users values('${ids.admin}'); insert into public.admins(user_id) values('${ids.admin}');
    insert into public.barbers(id,name,public_booking_key,booking_enabled,minimum_notice_minutes,photo_path) values
      ('${ids.barber}','Geovane','geovane',true,0,'public/geovane.jpg'),('${ids.other}','Daniel','daniel',false,0,'private/daniel.jpg');
    insert into public.services(id,name,price,duration_minutes,photo_path) values('${ids.cut}','Corte',45,30,'public/corte.jpg'),('${ids.beard}','Barba',25,20,null);
    insert into public.barber_services values('${ids.barber}','${ids.cut}'),('${ids.barber}','${ids.beard}');
    insert into storage.objects values(gen_random_uuid(),'barber-photos','public/geovane.jpg'),(gen_random_uuid(),'barber-photos','private/daniel.jpg'),(gen_random_uuid(),'service-photos','public/corte.jpg');
    set test.uid='${ids.admin}'; set test.aal='aal2';
    select public.apply_geovane_schedule('${ids.barber}');`);
  const day=(await db.query("select ((now() at time zone 'America/Fortaleza')::date + ((8-extract(dow from now() at time zone 'America/Fortaleza')::int)%7+7))::text as day")).rows[0].day;
  return {db,day};
}
