-- Panel del menú de Pa'l Antojo (/admin/): carpeta pública "menu" para el menú y las fotos,
-- y solo los correos de la lista de administradores pueden cambiarlos.
-- Pegar todo esto en Supabase > SQL Editor > Run.
-- ANTES de correrlo, cambia CAMBIA-TU-CORREO por el correo con el que vas a entrar al panel.

-- Carpeta pública: el enlace lee menu.json y las fotos sin clave
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 5242880, array['application/json', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Quiénes pueden cambiar el menú (nadie la puede leer desde afuera)
create table if not exists public.administradores (email text primary key);
alter table public.administradores enable row level security;
insert into public.administradores (email) values (lower('CAMBIA-TU-CORREO')) on conflict do nothing;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administradores where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

drop policy if exists "admin lee menu" on storage.objects;
drop policy if exists "admin sube menu" on storage.objects;
drop policy if exists "admin cambia menu" on storage.objects;
drop policy if exists "admin borra menu" on storage.objects;
create policy "admin lee menu" on storage.objects for select to authenticated
  using (bucket_id = 'menu' and public.es_admin());
create policy "admin sube menu" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu' and public.es_admin());
create policy "admin cambia menu" on storage.objects for update to authenticated
  using (bucket_id = 'menu' and public.es_admin()) with check (bucket_id = 'menu' and public.es_admin());
create policy "admin borra menu" on storage.objects for delete to authenticated
  using (bucket_id = 'menu' and public.es_admin());

-- Entrada a la app (/app/): el dueño y el personal. Para dar acceso a alguien del personal:
-- 1) Authentication > Users > Add user (con Auto Confirm)  2) insert into public.personal (email, nombre) values ('correo', 'Nombre');
create table if not exists public.personal (email text primary key, nombre text);
alter table public.personal enable row level security;
create or replace function public.puede_entrar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administradores where email = lower(auth.jwt() ->> 'email'))
      or exists (select 1 from public.personal where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.puede_entrar() from public, anon;
grant execute on function public.puede_entrar() to authenticated;
