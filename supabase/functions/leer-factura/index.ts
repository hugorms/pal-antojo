// Lee fotos de facturas de proveedores y devuelve cada producto ya pasado a los ingredientes del inventario.
// La clave de Anthropic vive solo aquí, como secreto ANTHROPIC_API_KEY de Supabase; nunca va a la caja ni al repositorio.
// Solo la usa quien entró con un usuario de la tienda (se revisa con puede_entrar).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "content-type": "application/json" } });

const UNIDADES = ["g", "kg", "ml", "L", "unidad"];
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FOTOS = 6;

const esquema = {
  type: "object",
  additionalProperties: false,
  required: ["facturas", "lineas"],
  properties: {
    facturas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proveedor", "fecha", "total"],
        properties: { proveedor: { type: "string" }, fecha: { type: "string" }, total: { type: "string" } },
      },
    },
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factura", "texto", "insumo_id", "nombre", "cantidad", "unidad", "seguro", "duda"],
        properties: {
          factura: { type: "integer" },
          texto: { type: "string" },
          insumo_id: { type: "string" },
          nombre: { type: "string" },
          cantidad: { type: "number" },
          unidad: { type: "string", enum: UNIDADES },
          seguro: { type: "boolean" },
          duda: { type: "string" },
        },
      },
    },
  },
};

const SISTEMA = `Lees facturas y notas de entrega de proveedores de un local de comida rápida venezolano (empanadas, tequeños, arepas, hamburguesas, perros, jugos, café). Tu trabajo es pasar cada producto comprado al inventario del local.

Recibes las fotos y la lista de ingredientes que el local ya lleva (id, nombre, unidad). Para cada producto de las facturas:
- Si es el mismo ingrediente que uno de la lista (aunque se escriba distinto, con marca o abreviado), pon su id en insumo_id y su nombre tal cual en nombre.
- Pasa la cantidad a la unidad de ese ingrediente. Ejemplos: 1 bulto de harina de 20 kg en un ingrediente en g son 20000; 2 cajas de 24 refrescos en un ingrediente en unidad son 48; 1 galón de aceite en ml son 3785.
- Si no está en la lista, deja insumo_id vacío, pon un nombre corto y claro en español (como "Salsa de ajo") y elige la unidad: g para sólidos, ml para líquidos, unidad para lo que se cuenta por pieza. Convierte la cantidad a esa unidad.
- factura es el número de la factura a la que pertenece la línea, empezando en 1, en el mismo orden de la lista facturas. Una foto puede ser una página de una factura o una factura completa; varias fotos pueden ser de facturas distintas.
- texto es la línea como aparece en la factura, corta.
- seguro es false cuando la foto no se lee bien, la cantidad o el empaque no son claros, o no estás seguro de a qué ingrediente corresponde; explica la duda en una frase corta en duda. Si estás seguro, duda queda vacía.
No incluyas impuestos, totales, fletes, descuentos ni nada que no sea mercancía. Si un mismo producto aparece en dos facturas, deja una línea por factura. En facturas pon proveedor, fecha y total como aparecen (vacío si no se ven).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Usa POST." }, 405);

  // Solo usuarios de la tienda
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!auth.startsWith("Bearer ")) return responder({ error: "Entra con tu usuario." }, 401);
  const permiso = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/puede_entrar`, {
    method: "POST",
    headers: { apikey, authorization: auth, "content-type": "application/json" },
    body: "{}",
  });
  if (!permiso.ok || (await permiso.json()) !== true) return responder({ error: "La sesión venció o no tienes permiso. Vuelve a entrar." }, 401);

  if (!Deno.env.get("ANTHROPIC_API_KEY")) return responder({ error: "Falta configurar la clave de Anthropic en Supabase." }, 500);

  let datos: { fotos?: { tipo: string; datos: string }[]; insumos?: { id: string; n: string; u: string }[] };
  try { datos = await req.json(); } catch { return responder({ error: "No llegaron las fotos." }, 400); }
  const fotos = (datos.fotos ?? []).filter((f) => TIPOS.includes(f.tipo) && typeof f.datos === "string" && f.datos.length > 100);
  if (!fotos.length) return responder({ error: "No llegaron las fotos." }, 400);
  if (fotos.length > MAX_FOTOS) return responder({ error: `Máximo ${MAX_FOTOS} fotos a la vez.` }, 400);
  const insumos = (datos.insumos ?? []).map((x) => ({ id: String(x.id), n: String(x.n), u: String(x.u) }));

  const client = new Anthropic();
  try {
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SISTEMA,
      output_config: { format: { type: "json_schema", schema: esquema } },
      messages: [{
        role: "user",
        content: [
          ...fotos.map((f) => ({ type: "image" as const, source: { type: "base64" as const, media_type: f.tipo as "image/jpeg", data: f.datos } })),
          { type: "text" as const, text: `Ingredientes que ya lleva el local:\n${JSON.stringify(insumos)}\n\nPasa estas ${fotos.length} foto(s) al inventario.` },
        ],
      }],
    });
    if (r.stop_reason === "refusal") return responder({ error: "No se pudo leer esa foto. Prueba con otra." }, 422);
    if (r.stop_reason === "max_tokens") return responder({ error: "La factura es muy larga. Manda menos fotos a la vez." }, 422);
    const texto = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const salida = JSON.parse(texto);
    // Solo ids que existen; lo demás pasa como ingrediente nuevo
    const ids = new Set(insumos.map((x) => x.id));
    salida.lineas = (salida.lineas ?? []).map((l: { insumo_id: string }) => ({ ...l, insumo_id: ids.has(l.insumo_id) ? l.insumo_id : "" }));
    return responder(salida);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "Muchas lecturas seguidas. Espera un minuto." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return responder({ error: "La clave de Anthropic no sirve. Revísala en Supabase." }, 500);
    if (e instanceof Anthropic.APIError) return responder({ error: "No se pudo leer la factura ahora (" + e.status + "). Prueba de nuevo." }, 502);
    if (e instanceof SyntaxError) return responder({ error: "La lectura salió incompleta. Prueba de nuevo." }, 502);
    console.error(e);
    return responder({ error: "No se pudo leer la factura." }, 500);
  }
});
