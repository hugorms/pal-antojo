// @ts-nocheck
// Pa'l Antojo · Aviso al teléfono del repartidor (Web Push), para que le llegue aunque tenga la app cerrada o el teléfono bloqueado.
// Va en Supabase > Edge Functions > nueva función "avisar-repartidor" (pegar este archivo completo).
// Al crearla, APAGAR "Verify JWT" (la llama la base de datos con su propio secreto, x-secreto).
// Secretos (Edge Functions > Secrets): VAPID_PUBLICA, VAPID_PRIVADA, SECRETO. Ver caja/supabase-delivery-avisos.sql.
// No usa librerías de afuera: todo con el cifrado que trae el servidor (WebCrypto), según el estándar Web Push (RFC 8291 y 8292).

const enc = new TextEncoder();
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const unir = (...ps) => { const out = new Uint8Array(ps.reduce((a, p) => a + p.length, 0)); let i = 0; for (const p of ps) { out.set(p, i); i += p.length; } return out; };
async function hmac(clave, datos) {
  const k = await crypto.subtle.importKey("raw", clave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, datos));
}

// Firma VAPID: le dice al servicio de avisos (Google, Apple, Mozilla) que el aviso viene de nosotros
export async function vapid(endpoint, publica, privada, contacto) {
  const pub = deB64u(publica);
  const jwk = { kty: "EC", crv: "P-256", d: privada, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const k = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cab = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const dat = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contacto })));
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, enc.encode(cab + "." + dat));
  return `vapid t=${cab}.${dat}.${b64u(firma)}, k=${publica}`;
}

// Cifra el mensaje para ese teléfono (solo el teléfono lo puede leer)
export async function cifrar(sub, texto) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, par.privateKey, 256));
  const prkKey = await hmac(auth, compartido);
  const ikm = (await hmac(prkKey, unir(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, unir(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, unir(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

export async function enviar(sub, datos, env) {
  const cuerpo = await cifrar(sub, JSON.stringify(datos));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapid(sub.endpoint, env.VAPID_PUBLICA, env.VAPID_PRIVADA, env.CONTACTO || "mailto:avisos@palantojo.app"),
      "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "120", urgency: "high",
    },
    body: cuerpo,
  });
}

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  const env = { VAPID_PUBLICA: Deno.env.get("VAPID_PUBLICA"), VAPID_PRIVADA: Deno.env.get("VAPID_PRIVADA"), CONTACTO: Deno.env.get("CONTACTO") };
  const secreto = Deno.env.get("SECRETO");
  if (req.method !== "POST" || !secreto || req.headers.get("x-secreto") !== secreto) return new Response("no", { status: 401 });
  try {
    const { sub, titulo, cuerpo, tag } = await req.json();
    if (!sub || !sub.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return new Response("sin suscripcion", { status: 400 });
    const r = await enviar(sub, { titulo: String(titulo || "Pa'l Antojo").slice(0, 80), cuerpo: String(cuerpo || "").slice(0, 200), tag: String(tag || "").slice(0, 60) }, env);
    return new Response(JSON.stringify({ estado: r.status }), { status: r.ok ? 200 : 502, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
