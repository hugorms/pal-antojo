# Pa'l Antojo · Pedidos

Página de pedidos de Pa'l Antojo (Campo de Carabobo, Las Manzanas). El cliente ve el menú según la hora, arma su pedido y lo envía al WhatsApp del local.

Es un solo archivo, `index.html`, sin compilación. Vercel lo publica tal cual.

Para cambiar precios o productos, edita la lista `MENU` dentro de `index.html`. Para cambiar el número de WhatsApp, edita `WHATSAPP`.

## Caja de la tienda

La carpeta `caja/` es la caja (app instalable en Android y PC). Recibe los pedidos ya pagados que se comparten desde WhatsApp o se pegan desde WhatsApp Web, imprime el ticket y lleva el cierre e inventario del día. Queda en `/caja/`. Para que los equipos se vean entre ellos usa Supabase: corre `caja/supabase.sql` y pon los datos en Ajustes.

## Fotos del menú

Las fotos van en la carpeta `fotos/`, en `.jpg` y cuadradas o 4:3. Mientras una foto no exista, sale el dibujito de la categoría.

- Una foto por categoría (todos los sabores se ven iguales): `empanadas.jpg`, `papas-rellenas.jpg`, `pastelitos.jpg`, `jugos.jpg`, `bebidas.jpg`, `cafe.jpg`, `cafe-frio.jpg`, `postres.jpg`, `papas-fritas.jpg`, `tequenos.jpg`, `ensaladas.jpg`.
- Hamburguesas, una por cada una: `h-clasica.jpg`, `h-antojo.jpg`, `h-doble.jpg`, `h-pollo.jpg`, y `hamburguesas.jpg` para la tarjeta de la categoría.
