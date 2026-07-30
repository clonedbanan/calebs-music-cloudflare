export async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS site_data (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}
