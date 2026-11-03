-- Pa'l Antojo · Delivery, paso 2: avisos al teléfono del repartidor aunque tenga la app cerrada o el teléfono bloqueado.
-- Sin este paso todo funciona igual, pero el aviso solo suena con la app abierta.
-- Antes de correrlo:
--   a) Supabase > Edge Functions > Deploy a new function > Via Editor. Nombre: avisar-repartidor.
--      Pegar base-de-datos/funciones/avisar-repartidor/index.ts y Deploy. En los ajustes de la función, APAGAR "Verify JWT".
--   b) Edge Functions > Secrets: agregar VAPID_PUBLICA, VAPID_PRIVADA y SECRETO (los valores están en la guía de Hugo, fuera del repo).
--   c) Cambiar abajo CAMBIA-EL-SECRETO por el mismo SECRETO. Pegar todo en SQL Editor > Run.

-- La base de datos llama a la función con pg_net (viene con Supabase, gratis)
create extension if not exists pg_net;

insert into public.dlv_privado (id, url, secreto)
values (1, 'https://ymzwomnzjfxznmpdouad.supabase.co/functions/v1/avisar-repartidor', 'CAMBIA-EL-SECRETO')
on conflict (id) do update set url = excluded.url, secreto = excluded.secreto;

-- Que la cascada avance sola cada 15 segundos aunque nadie tenga la app abierta (pg_cron, también gratis).
-- Si da error aquí, activa pg_cron en Database > Extensions y vuelve a correr solo estas líneas.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'delivery-revisar';
select cron.schedule('delivery-revisar', '15 seconds', 'select public.dlv_revisar()');
