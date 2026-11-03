# Pa'l Antojo · Pedidos

Página de pedidos de Pa'l Antojo (Campo de Carabobo, Las Manzanas). El cliente ve el menú según la hora, arma su pedido y lo envía al WhatsApp del local.

Es un solo archivo, `index.html`, sin compilación. Vercel lo publica tal cual.

Para cambiar precios, productos, sabores o fotos usa el panel `/admin/` (ver abajo). `menu.js` es el menú base, el que sale si el panel todavía no ha publicado nada. Para cambiar el número de WhatsApp, edita `WHATSAPP`.

## Caja de la tienda

La carpeta `caja/` es la app de la tienda (instalable en Android y PC), también en `/app/`. Tiene un menú lateral con los módulos: Caja (Vender, Recibir, Pedidos, Banco, Cierre) y Administración (Menú del enlace, que abre `/admin/` adentro, y Ajustes). Para sumar un módulo se agrega a `TABS` en `caja/index.html`. **Vender** es la venta de mostrador: tocar productos (del mismo menú del panel), Cobrar (efectivo con vuelto, Bs, pago móvil o mixto) y listo. Recibe los pedidos ya pagados que se comparten desde WhatsApp o se pegan desde WhatsApp Web, imprime el ticket y lleva el cierre e inventario del día. Queda en `/caja/`. Para que los equipos se vean entre ellos usa Supabase: corre `caja/supabase.sql` y después `caja/supabase-seguridad.sql`. Cada equipo se conecta solo al entrar con un usuario de la tienda.

## Delivery (repartidores)

- **En la caja**, el módulo Delivery muestra los pedidos por despachar, los que van en camino, los repartidores (disponible, ocupado, a cuántos km del local) y las cuentas de envíos de cada uno (con "Pagué sus envíos").
- **Los repartidores** usan `/delivery/`, una app aparte (instalable) donde solo ven sus pedidos. Al abrirla por primera vez piden permiso de ubicación y de notificaciones.
- **La regla:** el pedido le llega primero al repartidor disponible más cerca del local. Tiene 45 segundos (se cambia en la caja) para aceptar. Si no acepta, pasa al siguiente más cerca, y así sucesivamente. Los que ya llevan un pedido van de últimos y los que no tienen GPS van después de los que sí. Si nadie acepta, en la caja sale "Sin repartidor".
- **Base de datos:** `caja/supabase-delivery.sql` (obligatorio). `caja/supabase-delivery-avisos.sql` y `supabase/functions/avisar-repartidor` sirven para que el aviso llegue aunque la app esté cerrada (Web Push, gratis). Las llaves privadas no van en el repo.

## Seguridad

- Solo los usuarios de `public.administradores` o `public.personal` (correo confirmado) leen o guardan datos de la caja. Nadie puede borrar desde afuera.
- Guardar compara la versión (`rev`): si dos equipos cambian lo mismo, la app une los dos cambios campo por campo (pagos y gastos no se pierden).
- `vercel.json` pone las cabeceras de seguridad (CSP, sin iframes de otros sitios). Si se agrega un servicio externo nuevo (otra API, otra fuente), hay que sumarlo ahí.
- Lo que llega de afuera (mensaje del pedido, menú, datos de otros equipos) se limpia antes de mostrarlo.

## Fotos del menú

Las fotos van en la carpeta `fotos/`, en `.jpg` y cuadradas o 4:3. Mientras una foto no exista, sale el dibujito de la categoría.

- Una foto por categoría (todos los sabores se ven iguales): `empanadas.jpg`, `papas-rellenas.jpg`, `pastelitos.jpg`, `jugos.jpg`, `bebidas.jpg`, `cafe.jpg`, `cafe-frio.jpg`, `postres.jpg`, `papas-fritas.jpg`, `tequenos.jpg`, `ensaladas.jpg`.
- Hamburguesas, una por cada una: `h-clasica.jpg`, `h-antojo.jpg`, `h-doble.jpg`, `h-pollo.jpg`, y `hamburguesas.jpg` para la tarjeta de la categoría.

## Panel del menú (`/admin/`)

Vive dentro de la app (Administración › Menú del enlace); abrir `/admin/` suelto lleva ahí. Con correo y contraseña, el dueño cambia categorías, productos, sabores, tamaños, extras, precios, agotados, qué sale de día o de noche, y sube las fotos (una por categoría, o una por producto si se marca "Cada producto con su foto"). Al tocar **Publicar** se guarda `menu.json` en Supabase Storage y el enlace lo lee de ahí; si no carga, el enlace usa `menu.js`.

Una sola vez: correr `admin/supabase-panel.sql` (con tu correo) y crear el usuario en Supabase > Authentication > Users > Add user.
