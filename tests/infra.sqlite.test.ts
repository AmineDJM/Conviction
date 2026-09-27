import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, schema } from "@/db/client";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-sqlite-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("SQLite connection settings", () => {
  it("drizzle transactions BEGIN IMMEDIATE (hold the write lock from the start, so cross-process writers wait instead of failing with SQLITE_BUSY)", () => {
    const file = path.join(tmp, "conviction.db");
    const db = openDb(file);
    const other = new Database(file);
    other.pragma("busy_timeout = 0");
    try {
      expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
      let otherCouldWrite: boolean | null = null;
      db.transaction(() => {
        // No statement has run yet: with BEGIN DEFERRED another connection could still take the write lock.
        try {
          other.prepare("BEGIN IMMEDIATE").run();
          other.prepare("ROLLBACK").run();
          otherCouldWrite = true;
        } catch (e) {
          expect((e as { code?: string }).code).toBe("SQLITE_BUSY");
          otherCouldWrite = false;
        }
      });
      expect(otherCouldWrite).toBe(false);
      // Explicit behaviour still wins, and nested transactions use savepoints.
      db.transaction((tx) => {
        tx.transaction((inner) => inner.insert(schema.workspaces).values({ id: "ws_nested", name: "n", createdAt: "2026-01-01" }).run());
      }, { behavior: "deferred" });
      expect(db.select().from(schema.workspaces).all()).toHaveLength(1);
    } finally {
      other.close();
      db.$client.close();
    }
  });
});
