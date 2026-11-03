-- Pa'l Antojo · Blindaje de la base de datos (correr UNA vez, después de que la app nueva esté en Vercel).
-- Pegar todo en Supabase > SQL Editor > Run. Se puede correr otra vez sin problema.
--
-- Qué cambia:
-- 1. La tabla registros (pedidos, cierres, inventario) ya no se abre con la "clave de la tienda":
--    solo la leen y escriben los usuarios que entran con su correo y están en administradores o personal.
--    La clave vieja deja de servir, aunque alguien la tenga guardada.
-- 2. Nadie puede borrar registros desde afuera (antes, con la clave, se podía borrar todo).
-- 3. Guardar compara la versión (rev): un equipo atrasado ya no pisa lo que otro guardó después.
--    La app recibe lo que había y lo une con lo suyo.
-- 4. Se revisa el tamaño y el formato de lo que se guarda.
-- 5. La carpeta de fotos de facturas solo acepta imágenes de hasta 5 MB.

-- 1. Solo el equipo de la tienda (usuario con permiso) puede ver y guardar
alter table public.registros enable row level security;
drop policy if exists "clave de la tienda" on public.registros;
drop policy if exists "equipo: ver" on public.registros;
drop policy if exists "equipo: crear" on public.registros;
drop policy if exists "equipo: cambiar" on public.registros;
create policy "equipo: ver" on public.registros for select to authenticated using (public.puede_entrar());
create policy "equipo: crear" on public.registros for insert to authenticated with check (public.puede_entrar());
create policy "equipo: cambiar" on public.registros for update to authenticated using (public.puede_entrar()) with check (public.puede_entrar());

-- 2. Sin borrar, y nada para quien no entró
revoke all on public.registros from anon;
revoke all on public.registros from authenticated;
grant select, insert, update on public.registros to authenticated;

-- La clave de la tienda ya no hace falta
drop function if exists public.clave_tienda();

-- 4. Formato del id y tamaño máximo (500 mil caracteres por registro)
alter table public.registros drop constraint if exists registros_id_ok;
alter table public.registros add constraint registros_id_ok check (id ~ '^[A-Za-z0-9:_.-]{1,80}$');
alter table public.registros drop constraint if exists registros_tamano;
alter table public.registros add constraint registros_tamano check (jsonb_typeof(datos) = 'object' and length(datos::text) < 500000);

create or replace function public.registros_tocar() returns trigger language plpgsql set search_path = '' as $$
begin
  new.actualizado := clock_timestamp();
  return new;
end $$;

-- 3. Guardar con versión: solo entra lo que trae una rev mayor que la guardada.
--    Devuelve { rechazados: [{id, datos, actualizado}], invalidos: [id] } para que la app una los cambios.
create or replace function public.guardar_registros(filas jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  f jsonb; v public.registros; rid text; d jsonb;
  rechazados jsonb := '[]'::jsonb; invalidos jsonb := '[]'::jsonb;
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if jsonb_typeof(filas) <> 'array' or jsonb_array_length(filas) > 300 then raise exception 'lote invalido' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(filas) loop
    rid := f->>'id'; d := f->'datos';
    if rid is null or rid !~ '^[A-Za-z0-9:_.-]{1,80}$' or jsonb_typeof(d) is distinct from 'object' or length(d::text) >= 500000 then
      invalidos := invalidos || to_jsonb(coalesce(rid, '?')); continue;
    end if;
    insert into public.registros (id, datos) values (rid, d) on conflict (id) do nothing;
    if found then continue; end if;
    select * into v from public.registros where id = rid for update;
    if v.datos = d then continue; end if;
    if coalesce((d->>'rev')::numeric, 0) > coalesce((v.datos->>'rev')::numeric, 0) then
      update public.registros set datos = d where id = rid;
    else
      rechazados := rechazados || jsonb_build_object('id', v.id, 'datos', v.datos, 'actualizado', v.actualizado);
    end if;
  end loop;
  return jsonb_build_object('rechazados', rechazados, 'invalidos', invalidos);
end $$;
revoke all on function public.guardar_registros(jsonb) from public, anon;
grant execute on function public.guardar_registros(jsonb) to authenticated;

-- Permisos: solo cuentan los usuarios con el correo confirmado
create or replace function public.puede_entrar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now()))
     and (exists (select 1 from public.administradores where email = lower(auth.jwt() ->> 'email'))
       or exists (select 1 from public.personal where email = lower(auth.jwt() ->> 'email')));
$$;
revoke all on function public.puede_entrar() from public, anon;
grant execute on function public.puede_entrar() to authenticated;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now()))
     and exists (select 1 from public.administradores where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- Las listas de quién entra no se leen ni se cambian desde la app (solo desde este SQL Editor)
revoke all on public.administradores from anon, authenticated;
revoke all on public.personal from anon, authenticated;

-- 5. Fotos de facturas: solo imágenes, hasta 5 MB
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'facturas';
