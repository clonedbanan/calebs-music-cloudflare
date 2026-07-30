import { ensureSchema } from "../_shared/db.js";
import { json } from "../_shared/http.js";

export async function onRequestGet({ env }) {
  const status = {
    ok: false,
    functions: true,
    databaseBinding: Boolean(env.DB),
    databaseReady: false,
    adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
    tokenSecretConfigured: Boolean(env.ADMIN_TOKEN_SECRET),
    checkedAt: new Date().toISOString()
  };

  if (env.DB) {
    try {
      await ensureSchema(env.DB);
      status.databaseReady = true;
    } catch (error) {
      status.databaseError = error?.message || "D1 could not be reached.";
    }
  }

  status.ok =
    status.databaseBinding &&
    status.databaseReady &&
    status.adminPasswordConfigured &&
    status.tokenSecretConfigured;

  return json(status, status.ok ? 200 : 503, {
    "access-control-allow-origin": "*"
  });
}

export function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
