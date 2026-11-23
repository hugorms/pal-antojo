CREATE OR REPLACE FUNCTION public.dlv_tablero(dias integer DEFAULT 35)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.puede_entrar() then raise exception 'sin permiso' using errcode = '42501'; end if;
  perform public.dlv_revisar();
  return jsonb_build_object(
    'ahora', now(),
    'admin', public.es_admin(),
    'saldos', coalesce((select jsonb_object_agg(s.repartidor, to_jsonb(s) - 'repartidor') from (
      select repartidor, sum(envio) as debe, count(*) as cantidad from public.entregas
      where estado = 'entregado' and liquidado is null and repartidor is not null group by repartidor
    ) s), '{}'::jsonb),
    'entregas', coalesce((select jsonb_agg(to_jsonb(e) - 'dlat' - 'dlng' order by e.creado desc) from public.entregas e
                          where e.creado > now() - make_interval(days => least(greatest(dias, 1), 120)) or e.estado in ('buscando', 'asignado', 'en_camino')), '[]'),
    'repartidores', coalesce((select jsonb_agg(jsonb_build_object(
        'email', x.email, 'nombre', x.nombre, 'telefono', x.telefono, 'activo', x.activo, 'aprobado', x.aprobado, 'borrado', x.borrado, 'solicitado', x.solicitado,
        'disponible', x.disponible and (x.turno_hasta is null or x.turno_hasta > now()) and (x.visto > now() - interval '10 minutes' or (x.push is not null and x.turno_hasta > now())),
        'gps', x.lat is not null and x.gps_visto > now() - interval '3 minutes',
        'km', round(public.dlv_km_local(x.lat, x.lng)::numeric, 1),
        'visto', x.visto, 'avisos', x.push is not null,
        'ocupado', exists (select 1 from public.entregas o where o.repartidor = x.email and o.estado in ('asignado', 'en_camino'))
      ) order by x.nombre) from public.repartidores x), '[]'));
end $function$;
