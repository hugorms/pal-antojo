-- Pa'l Antojo · Delivery (repartidores). Correr UNA vez en Supabase > SQL Editor > Run. Se puede correr otra vez sin problema.
-- Necesita que ya esté corrido base-de-datos/3-seguridad.sql (usa puede_entrar() y es_admin()).
--
-- Cómo funciona la regla:
-- 1. La tienda pide repartidor para un pedido. Se le ofrece SOLO al repartidor disponible más cerca del local (GPS del teléfono).
-- 2. Tiene unos segundos (45 por defecto) para aceptar. Si dice "No puedo" o se le pasa el tiempo, pasa al siguiente más cerca.
--    La distancia se vuelve a medir en cada salto. Los que ya llevan un pedido van de últimos; los que no tienen GPS, después de los que sí.
-- 3. Si ya se le ofreció a todos y nadie aceptó, queda "sin repartidor": la tienda lo vuelve a ofrecer o lo asigna a mano.
-- 4. Un repartidor que no abre la app en 10 minutos deja de contar como disponible.
--
-- Para dar de alta un repartidor (dos formas):
-- a) Él mismo: abre /delivery/, toca "Crear mi cuenta" y llena su perfil. Le llega a la tienda como solicitud y el dueño la aprueba en Delivery > Repartidores.
--    (En Supabase > Authentication > Sign In / Providers > Email: "Allow new users to sign up" ENCENDIDO y "Confirm email" APAGADO.)
-- b) El dueño: Supabase > Authentication > Users > Add user (con Auto Confirm) y después Delivery > Repartidores > Agregar.
-- Los repartidores NO ven la caja, solo sus pedidos. El dueño puede editarlos, desactivarlos o borrarlos.

-- ---------- tablas ----------
create table if not exists public.repartidores (
  email text primary key check (email = lower(email)),
  nombre text not null,
  telefono text,
  activo boolean not null default true,
  disponible boolean not null default false,
  lat double precision, lng double precision, precision_m real,
  gps_visto timestamptz,                                         -- cuándo mandó su GPS por última vez
  visto timestamptz,                                             -- cuándo abrió la app por última vez
  push jsonb,
  creado timestamptz not null default now()
);

create table if not exists public.entregas (
  id text primary key check (id ~ '^[A-Za-z0-9:_.-]{1,80}$'),  -- el mismo id del pedido en la caja
  creado timestamptz not null default now(),
  cliente text, telefono text, direccion text, ubicacion text,
  dlat double precision, dlng double precision,                -- dónde va el pedido (si el cliente mandó la ubicación)
  resumen text, nota text,
  envio numeric(10,2) not null default 0,                        -- lo que se le cobró al cliente por el envío
  cobrar numeric(10,2) not null default 0,                       -- efectivo que el repartidor cobra al entregar
  segundos int not null default 45 check (segundos between 15 and 300),
  estado text not null default 'buscando' check (estado in ('buscando', 'asignado', 'en_camino', 'entregado', 'sin_repartidor', 'cancelado')),
  repartidor text references public.repartidores (email) on update cascade,
  oferta_a text, oferta_hasta timestamptz,
  ofrecidos text[] not null default '{}',                        -- a quién ya se le ofreció (en orden)
  aceptado timestamptz, salio timestamptz, entregado timestamptz,
  cobrado numeric(10,2),                                         -- efectivo que dice que cobró
  liquidado timestamptz,                                         -- cuándo se le pagaron los envíos
  pedido_por text,
  actualizado timestamptz not null default now()
);
-- Solicitudes: el repartidor que se registra solo queda sin aprobar hasta que el dueño lo acepte
alter table public.repartidores add column if not exists aprobado boolean not null default true;
alter table public.repartidores add column if not exists borrado boolean not null default false;
alter table public.repartidores add column if not exists solicitado timestamptz;

create index if not exists entregas_estado on public.entregas (estado);
create index if not exists entregas_repartidor on public.entregas (repartidor, creado);

-- Nadie toca las tablas directo: todo pasa por las funciones de abajo, que revisan quién es
alter table public.repartidores enable row level security;
alter table public.entregas enable row level security;
revoke all on public.repartidores from anon, authenticated;
revoke all on public.entregas from anon, authenticated;

-- ---------- quién es quién ----------
create or replace function public.correo_confirmado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now()));
$$;
revoke all on function public.correo_confirmado() from public, anon;

create or replace function public.es_repartidor() returns boolean
language sql stable security definer set search_path = public as $$
  select public.correo_confirmado() and exists (select 1 from public.repartidores where email = lower(auth.jwt() ->> 'email') and activo and aprobado and not borrado);
$$;
revoke all on function public.es_repartidor() from public, anon;
grant execute on function public.es_repartidor() to authenticated;

-- La app del delivery deja entrar a cualquier usuario con cuenta: adentro ve su solicitud o sus pedidos según lo que diga dlv_quien_soy()
create or replace function public.dlv_puedo_entrar() returns boolean
language sql stable security definer set search_path = public as $$ select public.correo_confirmado(); $$;
revoke all on function public.dlv_puedo_entrar() from public, anon;
grant execute on function public.dlv_puedo_entrar() to authenticated;

-- Protección: como cualquiera puede crearse una cuenta (para pedir ser repartidor), nadie puede registrarse con un correo
-- que ya esté en administradores o personal. Por eso, al dar de alta personal: PRIMERO crear el usuario y DESPUÉS ponerlo en la lista.
create or replace function public.proteger_correos_equipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.administradores where email = lower(new.email))
     or exists (select 1 from public.personal where email = lower(new.email)) then
    raise exception 'Ese correo es del equipo de la tienda. El dueño crea ese usuario desde Supabase.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.proteger_correos_equipo() from public, anon, authenticated;
drop trigger if exists proteger_correos_equipo on auth.users;
create trigger proteger_correos_equipo before insert on auth.users for each row execute function public.proteger_correos_equipo();

-- ---------- cuentas ----------
-- Distancia en línea recta, en km
create or replace function public.dlv_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) returns double precision
language sql immutable set search_path = '' as $$
  select case when a_lat is null or b_lat is null then null else
    6371 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))) end;
$$;
-- El local: Calle Urdaneta, local 16 H, Las Manzanas
create or replace function public.dlv_km_local(la double precision, lo double precision) returns double precision
language sql immutable set search_path = '' as $$ select public.dlv_km(10.0148284, -68.1568891, la, lo); $$;

-- Aviso al teléfono (solo si se configuró el paso 2: base-de-datos/5-delivery-avisos.sql). Si no, no hace nada.
create table if not exists public.dlv_privado (id int primary key default 1 check (id = 1), url text, secreto text);
alter table public.dlv_privado enable row level security;
revoke all on public.dlv_privado from anon, authenticated;

create or replace function public.dlv_avisar(para text, titulo text, cuerpo text, etiqueta text) returns void
language plpgsql security definer set search_path = public as $$
declare cfg public.dlv_privado; sub jsonb;
begin
  select * into cfg from public.dlv_privado where id = 1;
  if cfg.url is null or cfg.url = '' or to_regproc('net.http_post') is null then return; end if;
  select push into sub from public.repartidores where email = para;
  if sub is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using cfg.url, jsonb_build_object('sub', sub, 'titulo', titulo, 'cuerpo', cuerpo, 'tag', etiqueta),
          jsonb_build_object('content-type', 'application/json', 'x-secreto', cfg.secreto);
exception when others then return; -- un aviso que falla nunca frena el pedido
end $$;
revoke all on function public.dlv_avisar(text, text, text, text) from public, anon, authenticated;

-- Le pasa el pedido al siguiente repartidor más cerca del local que todavía no lo haya visto
create or replace function public.dlv_siguiente(eid text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.entregas; r record;
begin
  select * into e from public.entregas where id = eid for update;
  if not found or e.estado <> 'buscando' then return; end if;
  select x.email, x.nombre into r
  from public.repartidores x
  where x.activo and x.aprobado and not x.borrado and x.disponible and x.visto > now() - interval '10 minutes'
    and not (x.email = any (e.ofrecidos))
  order by
    exists (select 1 from public.entregas o where o.repartidor = x.email and o.estado in ('asignado', 'en_camino')),  -- libres primero
    (x.lat is null or x.gps_visto is null or x.gps_visto < now() - interval '3 minutes'),                                                        -- con GPS al día primero
    public.dlv_km_local(x.lat, x.lng) nulls last,                                                                     -- el más cerca del local
    x.visto desc
  limit 1;
  if r.email is null then
    update public.entregas set estado = 'sin_repartidor', oferta_a = null, oferta_hasta = null, actualizado = now() where id = eid;
  else
    update public.entregas set oferta_a = r.email, oferta_hasta = now() + make_interval(secs => e.segundos),
      ofrecidos = e.ofrecidos || r.email, actualizado = now() where id = eid;
    perform public.dlv_avisar(r.email, 'Pedido para llevar 🛵',
      coalesce(nullif(e.direccion, ''), 'Abre la app para ver la dirección') || case when e.envio > 0 then ' · envío ' || replace(e.envio::text, '.', ',') || ' $' else '' end,
      'oferta-' || e.id);
  end if;
end $$;
revoke all on function public.dlv_siguiente(text) from public, anon, authenticated;

-- Revisa las ofertas vencidas (o de un repartidor que se desconectó) y las pasa al siguiente. La llaman la tienda y los repartidores cada pocos segundos.
create or replace function public.dlv_revisar() returns void
language plpgsql security definer set search_path = public as $$
declare eid text;
begin
  for eid in
    select e.id from public.entregas e
    left join public.repartidores x on x.email = e.oferta_a
    where e.estado = 'buscando'
      and (e.oferta_a is null or e.oferta_hasta < now() - interval '2 seconds' or not coalesce(x.disponible and x.activo, false))
    for update of e skip locked
  loop
    perform public.dlv_siguiente(eid);
  end loop;
end $$;
revoke all on function public.dlv_revisar() from public, anon, authenticated;

-- ---------- para la tienda (usuarios de la caja) ----------
-- Pide repartidor. p = { id, cliente, telefono, direccion, ubicacion, resumen, nota, envio, cobrar, segundos, repartidor? }
-- Con "repartidor" se asigna a mano a esa persona; sin él empieza la búsqueda por cercanía.
create or replace function public.dlv_pedir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare eid text := p ->> 'id'; e public.entregas; existia boolean; m text[]; quien text := nullif(lower(p ->> 'repartidor'), '');
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if eid is null or eid !~ '^[A-Za-z0-9:_.-]{1,80}$' then raise exception 'id invalido' using errcode = '22023'; end if;
  if quien is not null and not exists (select 1 from public.repartidores where email = quien and activo) then raise exception 'ese repartidor no existe' using errcode = '22023'; end if;
  m := regexp_match(coalesce(p ->> 'ubicacion', ''), '(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)');
  select * into e from public.entregas where id = eid for update;
  existia := found;
  if existia and e.estado in ('asignado', 'en_camino', 'entregado') and quien is null then
    return to_jsonb(e);  -- ya tiene repartidor
  end if;
  insert into public.entregas as t (id, cliente, telefono, direccion, ubicacion, dlat, dlng, resumen, nota, envio, cobrar, segundos, pedido_por)
  values (eid, left(p ->> 'cliente', 120), left(p ->> 'telefono', 40), left(p ->> 'direccion', 400), left(p ->> 'ubicacion', 300),
          m[1]::double precision, m[2]::double precision, left(p ->> 'resumen', 600), left(p ->> 'nota', 300),
          greatest(coalesce((p ->> 'envio')::numeric, 0), 0), greatest(coalesce((p ->> 'cobrar')::numeric, 0), 0),
          least(greatest(coalesce((p ->> 'segundos')::int, 45), 15), 300), lower(auth.jwt() ->> 'email'))
  on conflict (id) do update set cliente = excluded.cliente, telefono = excluded.telefono, direccion = excluded.direccion, ubicacion = excluded.ubicacion,
    dlat = excluded.dlat, dlng = excluded.dlng, resumen = excluded.resumen, nota = excluded.nota, envio = excluded.envio, cobrar = excluded.cobrar,
    segundos = excluded.segundos, actualizado = now();
  if quien is not null then
    -- si estaba con otro repartidor, a ese le llega que se lo quitaron
    if e.repartidor is not null and e.repartidor <> quien and e.estado in ('asignado', 'en_camino') then
      perform public.dlv_avisar(e.repartidor, 'Pedido reasignado', 'La tienda le pasó el pedido de ' || coalesce(e.cliente, '') || ' a otro repartidor.', 'cancel-' || eid);
    end if;
    update public.entregas set estado = 'asignado', repartidor = quien, oferta_a = null, oferta_hasta = null, aceptado = now(), salio = null, entregado = null, cobrado = null, actualizado = now() where id = eid;
    perform public.dlv_avisar(quien, 'Te asignaron un pedido 🛵', coalesce(p ->> 'direccion', ''), 'asig-' || eid);
  elsif not existia or e.estado in ('sin_repartidor', 'cancelado') then
    -- empieza (o vuelve a empezar) la búsqueda: se le ofrece de nuevo a todos, empezando por el más cerca
    update public.entregas set estado = 'buscando', repartidor = null, oferta_a = null, oferta_hasta = null, ofrecidos = '{}', aceptado = null, salio = null, entregado = null, cobrado = null, actualizado = now() where id = eid;
    perform public.dlv_siguiente(eid);
  end if;
  select * into e from public.entregas where id = eid;
  return to_jsonb(e);
end $$;
revoke all on function public.dlv_pedir(jsonb) from public, anon;
grant execute on function public.dlv_pedir(jsonb) to authenticated;

create or replace function public.dlv_cancelar(eid text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.entregas;
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into e from public.entregas where id = eid for update;
  if not found or e.estado = 'entregado' then return; end if;
  update public.entregas set estado = 'cancelado', oferta_a = null, oferta_hasta = null, actualizado = now() where id = eid;
  if coalesce(e.repartidor, e.oferta_a) is not null then
    perform public.dlv_avisar(coalesce(e.repartidor, e.oferta_a), 'Pedido cancelado', 'La tienda canceló el pedido de ' || coalesce(e.cliente, '') || '.', 'cancel-' || eid);
  end if;
end $$;
revoke all on function public.dlv_cancelar(text) from public, anon;
grant execute on function public.dlv_cancelar(text) to authenticated;

-- Todo lo que ve la tienda: entregas de los últimos días y cómo está cada repartidor
create or replace function public.dlv_tablero(dias int default 35) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  perform public.dlv_revisar();
  return jsonb_build_object(
    'ahora', now(),
    'admin', public.es_admin(),
    'entregas', coalesce((select jsonb_agg(to_jsonb(e) - 'dlat' - 'dlng' order by e.creado desc) from public.entregas e
                          where e.creado > now() - make_interval(days => least(greatest(dias, 1), 120)) or e.estado in ('buscando', 'asignado', 'en_camino')), '[]'),
    'repartidores', coalesce((select jsonb_agg(jsonb_build_object(
        'email', x.email, 'nombre', x.nombre, 'telefono', x.telefono, 'activo', x.activo, 'aprobado', x.aprobado, 'borrado', x.borrado, 'solicitado', x.solicitado,
        'disponible', x.disponible and x.visto > now() - interval '10 minutes',
        'gps', x.lat is not null and x.gps_visto > now() - interval '3 minutes',
        'km', round(public.dlv_km_local(x.lat, x.lng)::numeric, 1),
        'visto', x.visto, 'avisos', x.push is not null,
        'ocupado', exists (select 1 from public.entregas o where o.repartidor = x.email and o.estado in ('asignado', 'en_camino'))
      ) order by x.nombre) from public.repartidores x), '[]'));
end $$;
revoke all on function public.dlv_tablero(int) from public, anon;
grant execute on function public.dlv_tablero(int) to authenticated;

-- Se le pagaron los envíos al repartidor (marca como pagadas sus entregas hasta ahora)
create or replace function public.dlv_liquidar(quien text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  update public.entregas set liquidado = now(), actualizado = now() where repartidor = lower(quien) and estado = 'entregado' and liquidado is null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.dlv_liquidar(text) from public, anon;
grant execute on function public.dlv_liquidar(text) to authenticated;

-- Agregar, cambiar o aprobar un repartidor (solo el dueño). Guardar desde la caja también aprueba la solicitud.
create or replace function public.dlv_guardar_repartidor(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare correo text := lower(trim(p ->> 'email'));
begin
  if not public.es_admin() then raise exception 'solo el dueño' using errcode = '42501'; end if;
  if correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or coalesce(trim(p ->> 'nombre'), '') = '' then raise exception 'falta correo o nombre' using errcode = '22023'; end if;
  insert into public.repartidores (email, nombre, telefono, activo, aprobado, borrado)
  values (correo, left(trim(p ->> 'nombre'), 60), left(p ->> 'telefono', 30), coalesce((p ->> 'activo')::boolean, true), true, false)
  on conflict (email) do update set nombre = excluded.nombre, telefono = excluded.telefono, activo = excluded.activo, aprobado = true, borrado = false,
    disponible = case when excluded.activo then repartidores.disponible else false end;
end $$;
revoke all on function public.dlv_guardar_repartidor(jsonb) from public, anon;
grant execute on function public.dlv_guardar_repartidor(jsonb) to authenticated;

-- Borrar un repartidor o rechazar su solicitud (solo el dueño). Si ya hizo entregas, se esconde pero sus cuentas quedan.
create or replace function public.dlv_borrar_repartidor(quien text) returns void
language plpgsql security definer set search_path = public as $$
declare correo text := lower(trim(quien));
begin
  if not public.es_admin() then raise exception 'solo el dueño' using errcode = '42501'; end if;
  if exists (select 1 from public.entregas where repartidor = correo and estado in ('asignado', 'en_camino')) then
    raise exception 'Lleva un pedido ahora. Reasígnalo o espera que lo entregue.' using errcode = '22023';
  end if;
  update public.entregas set oferta_a = null, oferta_hasta = null where oferta_a = correo and estado = 'buscando';
  if exists (select 1 from public.entregas where repartidor = correo) then
    update public.repartidores set borrado = true, activo = false, disponible = false, push = null where email = correo;
  else
    delete from public.repartidores where email = correo;
  end if;
end $$;
revoke all on function public.dlv_borrar_repartidor(text) from public, anon;
grant execute on function public.dlv_borrar_repartidor(text) to authenticated;

-- El repartidor nuevo manda su perfil (nombre y teléfono). Queda como solicitud hasta que el dueño lo apruebe.
create or replace function public.dlv_registrarme(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email'); r public.repartidores; nom text := left(trim(coalesce(p ->> 'nombre', '')), 60); tel text := left(trim(coalesce(p ->> 'telefono', '')), 30);
begin
  if not public.correo_confirmado() or yo is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  if nom = '' or length(regexp_replace(tel, '\D', '', 'g')) < 7 then raise exception 'Pon tu nombre y tu teléfono.' using errcode = '22023'; end if;
  select * into r from public.repartidores where email = yo;
  if found and r.borrado then raise exception 'La tienda te quitó del delivery. Habla con la tienda.' using errcode = '42501'; end if;
  if found then
    update public.repartidores set nombre = nom, telefono = tel where email = yo;
  else
    if (select count(*) from public.repartidores where not aprobado and not borrado) >= 30 then
      raise exception 'Hay muchas solicitudes pendientes. Avísale a la tienda.' using errcode = '22023';
    end if;
    insert into public.repartidores (email, nombre, telefono, activo, aprobado, solicitado) values (yo, nom, tel, true, false, now());
  end if;
  return public.dlv_quien_soy();
end $$;
revoke all on function public.dlv_registrarme(jsonb) from public, anon;
grant execute on function public.dlv_registrarme(jsonb) to authenticated;

-- En qué va la cuenta del que abrió la app del delivery
create or replace function public.dlv_quien_soy() returns jsonb
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email'); r public.repartidores;
begin
  if not public.correo_confirmado() then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into r from public.repartidores where email = yo;
  return jsonb_build_object('email', yo, 'registrado', r.email is not null, 'nombre', r.nombre, 'telefono', r.telefono,
    'aprobado', coalesce(r.aprobado, false), 'activo', coalesce(r.activo, false), 'borrado', coalesce(r.borrado, false));
end $$;
revoke all on function public.dlv_quien_soy() from public, anon;
grant execute on function public.dlv_quien_soy() to authenticated;

-- ---------- para el repartidor (app /delivery/) ----------
-- Cada pocos segundos: dice si está disponible y dónde está, y recibe su oferta, sus pedidos y sus cuentas.
-- p = { disponible: bool, lat, lng, precision }
create or replace function public.dlv_yo(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email'); r public.repartidores; hoy date := (now() at time zone 'America/Caracas')::date; oferta jsonb;
begin
  if not public.es_repartidor() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p ? 'disponible' then
    update public.repartidores set
      disponible = coalesce((p ->> 'disponible')::boolean, false),
      lat = case when (p ->> 'disponible')::boolean and p ? 'lat' then (p ->> 'lat')::double precision when (p ->> 'disponible')::boolean then lat end,
      lng = case when (p ->> 'disponible')::boolean and p ? 'lng' then (p ->> 'lng')::double precision when (p ->> 'disponible')::boolean then lng end,
      precision_m = case when (p ->> 'disponible')::boolean then (p ->> 'precision')::real end,
      gps_visto = case when (p ->> 'disponible')::boolean and p ? 'lat' then now() when (p ->> 'disponible')::boolean then gps_visto end,
      visto = now()
    where email = yo;
  end if;
  perform public.dlv_revisar();
  select * into r from public.repartidores where email = yo;
  select jsonb_build_object('id', e.id, 'direccion', e.direccion, 'resumen', e.resumen, 'nota', e.nota, 'envio', e.envio, 'cobrar', e.cobrar,
      'km_cliente', round(public.dlv_km_local(e.dlat, e.dlng)::numeric, 1), 'hasta', e.oferta_hasta, 'segundos', e.segundos)
    into oferta from public.entregas e where e.estado = 'buscando' and e.oferta_a = yo order by e.creado limit 1;
  return jsonb_build_object(
    'ahora', now(),
    'yo', jsonb_build_object('nombre', r.nombre, 'disponible', r.disponible, 'avisos', r.push is not null,
                             'km', round(public.dlv_km_local(r.lat, r.lng)::numeric, 1)),
    'oferta', oferta,
    'mias', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'estado', e.estado, 'cliente', e.cliente, 'telefono', e.telefono,
        'direccion', e.direccion, 'ubicacion', e.ubicacion, 'resumen', e.resumen, 'nota', e.nota, 'envio', e.envio, 'cobrar', e.cobrar,
        'km_cliente', round(public.dlv_km_local(e.dlat, e.dlng)::numeric, 1), 'aceptado', e.aceptado) order by e.aceptado)
      from public.entregas e where e.repartidor = yo and e.estado in ('asignado', 'en_camino')), '[]'),
    'hoy', (select jsonb_build_object('pedidos', count(*), 'envios', coalesce(sum(envio), 0), 'efectivo', coalesce(sum(cobrado), 0))
            from public.entregas e where e.repartidor = yo and e.estado = 'entregado' and (e.entregado at time zone 'America/Caracas')::date = hoy),
    'por_cobrar', (select coalesce(sum(envio), 0) from public.entregas e where e.repartidor = yo and e.estado = 'entregado' and e.liquidado is null),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'cliente', e.cliente, 'envio', e.envio, 'cobrado', e.cobrado, 'entregado', e.entregado, 'pagado', e.liquidado is not null) order by e.entregado desc)
      from (select * from public.entregas where repartidor = yo and estado = 'entregado' order by entregado desc limit 30) e), '[]')
  );
end $$;
revoke all on function public.dlv_yo(jsonb) from public, anon;
grant execute on function public.dlv_yo(jsonb) to authenticated;

create or replace function public.dlv_aceptar(eid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email');
begin
  if not public.es_repartidor() then raise exception 'sin permiso' using errcode = '42501'; end if;
  update public.entregas set estado = 'asignado', repartidor = yo, oferta_a = null, oferta_hasta = null, aceptado = now(), actualizado = now()
  where id = eid and estado = 'buscando' and oferta_a = yo and oferta_hasta > now() - interval '2 seconds';
  return found;
end $$;
revoke all on function public.dlv_aceptar(text) from public, anon;
grant execute on function public.dlv_aceptar(text) to authenticated;

create or replace function public.dlv_rechazar(eid text) returns void
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email');
begin
  if not public.es_repartidor() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if exists (select 1 from public.entregas where id = eid and estado = 'buscando' and oferta_a = yo) then
    perform public.dlv_siguiente_forzado(eid);
  end if;
end $$;

-- Pasa al siguiente aunque la oferta no haya vencido (cuando el repartidor dice "No puedo")
create or replace function public.dlv_siguiente_forzado(eid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.entregas set oferta_a = null, oferta_hasta = null where id = eid and estado = 'buscando';
  perform public.dlv_siguiente(eid);
end $$;
revoke all on function public.dlv_siguiente_forzado(text) from public, anon, authenticated;
revoke all on function public.dlv_rechazar(text) from public, anon;
grant execute on function public.dlv_rechazar(text) to authenticated;

-- Avance del repartidor: 'en_camino' (salió del local) o 'entregado' (con el efectivo que cobró)
create or replace function public.dlv_avance(eid text, paso text, efectivo numeric default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare yo text := lower(auth.jwt() ->> 'email');
begin
  if not public.es_repartidor() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if paso = 'en_camino' then
    update public.entregas set estado = 'en_camino', salio = now(), actualizado = now() where id = eid and repartidor = yo and estado = 'asignado';
  elsif paso = 'entregado' then
    update public.entregas set estado = 'entregado', entregado = now(), cobrado = greatest(coalesce(efectivo, cobrar), 0), actualizado = now()
    where id = eid and repartidor = yo and estado in ('asignado', 'en_camino');
  else
    raise exception 'paso invalido' using errcode = '22023';
  end if;
  return found;
end $$;
revoke all on function public.dlv_avance(text, text, numeric) from public, anon;
grant execute on function public.dlv_avance(text, text, numeric) to authenticated;

-- Guarda (o borra, con null) la suscripción de avisos del teléfono del repartidor
create or replace function public.dlv_push(sub jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_repartidor() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if sub is not null and (jsonb_typeof(sub) <> 'object' or length(sub::text) > 2000 or coalesce(sub ->> 'endpoint', '') !~ '^https://') then
    raise exception 'suscripcion invalida' using errcode = '22023';
  end if;
  update public.repartidores set push = sub where email = lower(auth.jwt() ->> 'email');
end $$;
revoke all on function public.dlv_push(jsonb) from public, anon;
grant execute on function public.dlv_push(jsonb) to authenticated;
