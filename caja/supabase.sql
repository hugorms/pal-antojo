-- Caja Pa'l Antojo: tabla compartida entre el teléfono y la PC de la tienda.
-- Pegar todo esto en Supabase > SQL Editor > Run.
-- ANTES de correrlo, cambia CAMBIA-ESTA-CLAVE (las dos veces) por una clave tuya, la misma que pones en Ajustes de la caja.

create table if not exists public.registros (
  id text primary key,
  datos jsonb not null,
  actualizado timestamptz not null default clock_timestamp()
);

create index if not exists registros_actualizado on public.registros (actualizado);

-- Cada vez que se guarda algo, se marca la hora del servidor
create or replace function public.registros_tocar() returns trigger language plpgsql as $$
begin
  new.actualizado := clock_timestamp();
  return new;
end $$;

drop trigger if exists registros_tocar on public.registros;
create trigger registros_tocar before insert or update on public.registros
  for each row execute function public.registros_tocar();

-- Solo quien tenga la clave de la tienda puede leer o escribir
alter table public.registros enable row level security;
drop policy if exists "clave de la tienda" on public.registros;
create policy "clave de la tienda" on public.registros for all to anon
  using ((current_setting('request.headers', true)::json ->> 'x-clave') = 'CAMBIA-ESTA-CLAVE')
  with check ((current_setting('request.headers', true)::json ->> 'x-clave') = 'CAMBIA-ESTA-CLAVE');

grant select, insert, update on public.registros to anon;
