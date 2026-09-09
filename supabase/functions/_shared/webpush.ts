// Minimal Web Push for Deno: VAPID (RFC 8292) + aes128gcm message
// encryption (RFC 8291/8188) using only WebCrypto — no dependencies.
//
// VAPID_PUBLIC_KEY: base64url, uncompressed P-256 point (65 bytes).
// VAPID_PRIVATE_KEY: base64url, raw 32-byte scalar.

export interface PushSubscription {
  endpoint: string;
  p256dh: string; // base64url
  auth: string; // base64url
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlEncode(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Sign a VAPID JWT (ES256) for the push service origin. */
async function vapidJwt(
  audience: string,
  subject: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
): Promise<string> {
  const x = b64urlEncode(publicKey.slice(1, 33));
  const y = b64urlEncode(publicKey.slice(33, 65));
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x,
    y,
    d: b64urlEncode(privateKey),
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = new TextEncoder();
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64urlEncode(new Uint8Array(signature))}`;
}

/** RFC 8291 aes128gcm encryption of a push payload. */
async function encryptPayload(
  subscription: PushSubscription,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(subscription.p256dh); // 65 bytes
  const authSecret = b64urlDecode(subscription.auth); // 16 bytes

  const asKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", asKeys.publicKey),
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  const enc = new TextEncoder();
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(enc.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: final record
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, padded as BufferSource),
  );

  // aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface PushResult {
  ok: boolean;
  status: number;
  gone: boolean; // 404/410: the subscription is dead, delete it
}

/** Encrypt and deliver one push message. */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: unknown,
  options: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<PushResult> {
  const publicKey = b64urlDecode(Deno.env.get("VAPID_PUBLIC_KEY")!);
  const privateKey = b64urlDecode(Deno.env.get("VAPID_PRIVATE_KEY")!);
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@docket.app";

  const audience = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(audience, subject, publicKey, privateKey);
  const body = await encryptPayload(
    subscription,
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${b64urlEncode(publicKey)}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttl ?? 3600),
      Urgency: options.urgency ?? "normal",
    },
    body: body as BodyInit,
  });
  // Drain the body so the connection can be reused.
  await res.arrayBuffer().catch(() => {});
  return {
    ok: res.ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  };
}
