# Base de datos (Supabase)

Todo lo de Supabase está en esta carpeta, en el orden en que se corre.
Cada archivo se pega en **Supabase › SQL Editor › Run**. Se puede volver a correr sin dañar nada.

| # | Archivo | Para qué | Estado |
|---|---------|----------|--------|
| 1 | `1-panel-menu.sql` | Panel del menú (`/admin/`), quién es administrador y quién es personal | Ya corrido |
| 2 | `2-caja.sql` | Tabla de la caja (pedidos, cierres, inventario) y fotos de facturas | Ya corrido |
| 3 | `3-seguridad.sql` | Blindaje: solo entra el equipo con su usuario, nadie borra | Ya corrido (3 nov) |
| 4 | `4-delivery.sql` | Delivery: repartidores, entregas, la regla del más cerca y el registro de repartidores | Corrido el 3 nov. **Volver a correrlo** (trae el registro) |
| 5 | `5-delivery-avisos.sql` | Avisos al repartidor con la app cerrada (opcional) | Falta. Antes, crear la función de abajo |

`funciones/avisar-repartidor/index.ts` es la Edge Function de los avisos (Supabase › Edge Functions).

**Lo privado no va aquí.** Este repo se publica en Vercel. Las llaves (VAPID_PRIVADA, SECRETO) y los SQL ya llenos con ellas están en la PC, en `codigo\base-de-datos\` (fuera del repo).

## Registro de repartidores (desde la app)
Para que los repartidores se creen la cuenta solos, en Supabase › Authentication › Sign In / Providers › Email:
- **Allow new users to sign up**: ENCENDIDO
- **Confirm email**: APAGADO (el correo de confirmación de Supabase gratis no le llega a gente de afuera)

Es seguro: una cuenta nueva no ve nada hasta que el dueño la aprueba en Delivery, y nadie puede registrarse con un correo del dueño o del personal.
Por eso, al dar de alta personal: **primero** crea su usuario en Add user y **después** ponlo en la lista.
