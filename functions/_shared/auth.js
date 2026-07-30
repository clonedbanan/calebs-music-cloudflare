const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function secret(env) {
  return env.ADMIN_TOKEN_SECRET || env.ADMIN_PASSWORD || "";
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a[i % a.length] || 0) ^ (b[i % b.length] || 0);
  return mismatch === 0;
}

async function sign(payload, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export function passwordIsConfigured(env) {
  return Boolean(env.ADMIN_PASSWORD && secret(env));
}

export function verifyPassword(value, env) {
  return passwordIsConfigured(env) && constantTimeEqual(value, env.ADMIN_PASSWORD);
}

export async function createToken(env) {
  const payloadObject = {
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    scope: "calebs-music-admin"
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(payloadObject)));
  return `${payload}.${await sign(payload, env)}`;
}

export async function verifyRequest(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secret(env)) return false;
  if (!constantTimeEqual(signature, await sign(payload, env))) return false;

  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return decoded.scope === "calebs-music-admin" && Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
