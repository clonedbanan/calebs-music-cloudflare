import { verifyRequest } from "../_shared/auth.js";
import { json } from "../_shared/http.js";

export async function onRequestGet() {
  return new Response("Media storage is not enabled for this D1-only deployment.", { status: 404 });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifyRequest(request, env))) return json({ error: "Unauthorized" }, 401);
  return json({
    error: "Direct file uploads are disabled because this project does not use R2. Use Spotify artwork and streaming links instead."
  }, 503);
}

export function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
