# Pa'l Antojo · Pedidos

Página de pedidos de Pa'l Antojo (Campo de Carabobo, Las Manzanas). El cliente ve el menú según la hora, arma su pedido y lo envía al WhatsApp del local.

Es un solo archivo, `index.html`, sin compilación. Vercel lo publica tal cual.

Para cambiar precios o productos, edita la lista `MENU` dentro de `index.html`. Para cambiar el número de WhatsApp, edita `WHATSAPP`.

## Caja de la tienda

La carpeta `caja/` es la caja (app instalable en Android y PC). Recibe los pedidos ya pagados que se comparten desde WhatsApp o se pegan desde WhatsApp Web, imprime el ticket y lleva el cierre e inventario del día. Queda en `/caja/`. Para que los equipos se vean entre ellos usa Supabase: corre `caja/supabase.sql` y pon los datos en Ajustes.
