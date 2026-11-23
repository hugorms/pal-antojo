-- Horario del menú, en hora de Caracas. NULL indica que el local está cerrado.
begin;
create or replace function public.dlv_cierre_local(instante timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
 with h as (select instante at time zone 'America/Caracas' as local),
 horario as (select local, date_trunc('day',local) +
   case when extract(isodow from local) >= 4 then interval '1 day' else interval '15 hours' end as cierre from h)
 select case when local::time >= time '06:00' and local < cierre then cierre at time zone 'America/Caracas' end from horario
$$;
alter table public.repartidores add column if not exists turno_avisado timestamptz;
create or replace function public.dlv_limitar_turno() returns trigger
language plpgsql security definer set search_path = public as $$
declare cierre timestamptz := public.dlv_cierre_local(now());
begin
 if new.disponible then
   if cierre is null or new.turno_hasta <= now() then new.disponible := false;
   else new.turno_hasta := least(coalesce(new.turno_hasta,cierre),cierre); end if;
 end if;
 if not new.disponible then new.turno_hasta := null; new.turno_avisado := null; end if;
 if tg_op = 'UPDATE' then
   if old.disponible and old.turno_hasta <= now() and old.turno_hasta > now() - interval '10 minutes'
      and old.turno_hasta is distinct from new.turno_hasta and old.push is not null then
     perform public.dlv_avisar(old.email,'Terminó tu turno','Ya no recibirás ofertas nuevas. Si tienes un pedido en curso, puedes terminarlo.','turno-fin');
   end if;
 end if;
 return new;
end $$;
revoke all on function public.dlv_limitar_turno() from public, anon, authenticated;
drop trigger if exists dlv_horario_turno on public.repartidores;
create trigger dlv_horario_turno before insert or update of disponible,turno_hasta on public.repartidores
for each row execute function public.dlv_limitar_turno();
create or replace function public.dlv_recordar_turnos() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
 update public.repartidores set disponible=false where disponible and turno_hasta <= now();
 for r in update public.repartidores set turno_avisado=turno_hasta where disponible and activo and aprobado and not borrado
   and push is not null and turno_hasta > now() and turno_hasta <= now()+interval '10 minutes'
   and turno_avisado is distinct from turno_hasta returning email, turno_hasta loop
   perform public.dlv_avisar(r.email,'Tu turno está por terminar','Termina a las ' || to_char(r.turno_hasta at time zone 'America/Caracas','HH24:MI') || '. Revisa tu disponibilidad en Delivery.','turno-recordatorio');
 end loop;
end $$;
revoke all on function public.dlv_recordar_turnos() from public, anon, authenticated;
update public.repartidores set disponible=disponible where disponible;
select cron.schedule('delivery-recordar-turnos','* * * * *','select public.dlv_recordar_turnos()');
commit;
