create table public.dlv_pago_movil (
  email text primary key,
  titular text not null, banco text not null, cedula text not null, telefono text not null
);
create table public.dlv_retiros (
  id uuid primary key default gen_random_uuid(), email text not null,
  creado timestamptz not null default now(), pagado timestamptz,
  monto numeric not null check (monto > 0), entregas text[] not null, destino jsonb not null
);
create unique index dlv_retiro_pendiente on public.dlv_retiros(email) where pagado is null;
alter table public.dlv_pago_movil enable row level security;
alter table public.dlv_retiros enable row level security;
revoke all on public.dlv_pago_movil, public.dlv_retiros from public, anon, authenticated;

create function public.dlv_billetera(accion text default 'ver', p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare yo text := lower(auth.jwt()->>'email'); ficha jsonb; ids text[]; total numeric;
begin
  if public.es_repartidor() is not true then raise exception 'Sin permiso'; end if;
  if accion in ('guardar','solicitar') then perform pg_advisory_xact_lock(hashtextextended(yo,0)); end if;
  if accion='guardar' then
    if not coalesce(length(trim(p->>'titular')) between 2 and 80 and length(trim(p->>'banco')) between 2 and 80
      and upper(trim(p->>'cedula')) ~ '^[VEJP]-?[0-9]{5,10}$' and trim(p->>'telefono') ~ '^04[0-9]{9}$',false)
      then raise exception 'Revisa el titular, banco, documento y teléfono de Pago Móvil.'; end if;
    insert into public.dlv_pago_movil values(yo,trim(p->>'titular'),trim(p->>'banco'),upper(trim(p->>'cedula')),trim(p->>'telefono'))
    on conflict(email) do update set titular=excluded.titular,banco=excluded.banco,cedula=excluded.cedula,telefono=excluded.telefono;
  end if;
  select to_jsonb(f)-'email' into ficha from public.dlv_pago_movil f where email=yo;
  if accion='solicitar' and not exists(select from public.dlv_retiros where email=yo and pagado is null) then
    if ficha is null then raise exception 'Guarda tus datos de pago primero.'; end if;
    select array_agg(e.id),sum(e.envio) into ids,total from public.entregas e where repartidor=yo and estado='entregado' and liquidado is null;
    if coalesce(total,0)<=0 then raise exception 'No tienes saldo para retirar.'; end if;
    insert into public.dlv_retiros(email,monto,entregas,destino) values(yo,total,ids,ficha);
  end if;
  return jsonb_build_object('ficha',ficha,'retiros',coalesce((select jsonb_agg(to_jsonb(h) order by h.creado desc) from
    (select id,monto,creado,pagado from public.dlv_retiros where email=yo order by creado desc limit 30) h),'[]'::jsonb));
end $$;

create function public.dlv_retiros_caja() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if public.puede_entrar() is not true then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.creado) from
    (select id,email,creado,monto,destino from public.dlv_retiros where pagado is null) h),'[]'::jsonb);
end $$;

create function public.dlv_pagar_retiro(solicitud uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.dlv_retiros;
begin
  if public.puede_entrar() is not true then raise exception 'Sin permiso'; end if;
  select * into strict r from public.dlv_retiros where id=solicitud;
  perform pg_advisory_xact_lock(hashtextextended(r.email,0));
  if exists(select from public.dlv_retiros where id=solicitud and pagado is null) then
    update public.entregas set liquidado=now(),actualizado=now() where repartidor=r.email and id=any(r.entregas) and liquidado is null;
    update public.dlv_retiros set pagado=now() where id=solicitud;
  end if;
end $$;

create or replace function public.dlv_liquidar(quien text) returns int language plpgsql security definer set search_path='' as $$
declare n int;
begin
  if public.puede_entrar() is not true then raise exception 'Sin permiso'; end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(quien),0));
  if exists(select from public.dlv_retiros where email=lower(quien) and pagado is null) then
    raise exception 'Confirma primero la solicitud en Retiros pendientes.'; end if;
  update public.entregas set liquidado=now(),actualizado=now() where repartidor=lower(quien) and estado='entregado' and liquidado is null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.dlv_billetera(text,jsonb), public.dlv_retiros_caja(), public.dlv_pagar_retiro(uuid) from public, anon;
grant execute on function public.dlv_billetera(text,jsonb), public.dlv_retiros_caja(), public.dlv_pagar_retiro(uuid) to authenticated;
