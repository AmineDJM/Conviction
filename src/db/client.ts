/**
 * Database client. One connection per process (SQLite WAL). The path is
 * configurable; production deployments should place it on encrypted storage.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const globalForDb = globalThis as unknown as { __convictionDb?: DB };

export function databasePath() {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "conviction.db");
}

export function openDb(file = databasePath()): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema }) as DB;
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__convictionDb) globalForDb.__convictionDb = openDb();
  return globalForDb.__convictionDb;
}

export { schema };
