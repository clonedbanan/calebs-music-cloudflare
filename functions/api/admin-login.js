import { createToken, passwordIsConfigured, verifyPassword } from "../_shared/auth.js";
import { json } from "../_shared/http.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!passwordIsConfigured(env)) {
    return json({ error: "ADMIN_PASSWORD and ADMIN_TOKEN_SECRET are not configured in Cloudflare." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  if (!verifyPassword(body?.password || "", env)) {
    return json({ error: "Incorrect password." }, 401);
  }

  return json({ token: await createToken(env), expiresIn: 43200 });
}

export function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
