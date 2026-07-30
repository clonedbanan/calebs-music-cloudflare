import { DEFAULT_DATA } from "../_shared/default-data.js";
import { ensureSchema } from "../_shared/db.js";
import { verifyRequest } from "../_shared/auth.js";
import { json } from "../_shared/http.js";

const MAX_JSON_BYTES = 4_500_000;

function validateData(data) {
  if (!data || typeof data !== "object") return "Missing site data.";
  if (!Array.isArray(data.songs) || data.songs.length < 1) return "At least one song is required.";
  if (data.songs.length > 200) return "The queue is too large.";
  if (typeof data.firstSwitchDate !== "string") return "The schedule date is invalid.";
  return "";
}

async function requireDatabase(env) {
  if (!env.DB) throw new Error("The D1 binding named DB is missing.");
  await ensureSchema(env.DB);
  return env.DB;
}

export async function onRequestGet({ env }) {
  try {
    const db = await requireDatabase(env);
    let row = await db.prepare("SELECT data, updated_at FROM site_data WHERE id = 1").first();

    if (!row) {
      const updatedAt = new Date().toISOString();
      const serialized = JSON.stringify(DEFAULT_DATA);
      await db.prepare("INSERT INTO site_data (id, data, updated_at) VALUES (1, ?, ?)")
        .bind(serialized, updatedAt)
        .run();
      row = { data: serialized, updated_at: updatedAt };
    }

    return json({
      initialized: true,
      data: JSON.parse(row.data),
      updatedAt: row.updated_at
    }, 200, { "access-control-allow-origin": "*" });
  } catch (error) {
    return json({ error: error?.message || "Unable to load site data." }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await verifyRequest(request, env))) return json({ error: "Unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const validationError = validateData(body?.data);
  if (validationError) return json({ error: validationError }, 400);

  const serialized = JSON.stringify(body.data);
  if (new TextEncoder().encode(serialized).byteLength > MAX_JSON_BYTES) {
    return json({ error: "The song data is too large. Use remote artwork and streaming links rather than embedded media." }, 413);
  }

  try {
    const db = await requireDatabase(env);
    const updatedAt = new Date().toISOString();
    await db.prepare(`
      INSERT INTO site_data (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).bind(serialized, updatedAt).run();
    return json({ ok: true, updatedAt });
  } catch (error) {
    return json({ error: error?.message || "Unable to save site data." }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "authorization, content-type"
    }
  });
}

export function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
