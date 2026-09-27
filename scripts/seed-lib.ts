import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { createWorkspaceWithOwner } from "../src/server/auth";

export const DEV_EMAIL = process.env.SEED_EMAIL ?? "partner@vuvp.example";
export const DEV_PASSWORD = process.env.SEED_PASSWORD ?? "conviction";

export function ensureDevWorkspace() {
  const db = getDb();
  const user = db.select().from(schema.users).where(eq(schema.users.email, DEV_EMAIL)).get();
  if (user) {
    const m = db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).get()!;
    return { userId: user.id, workspaceId: m.workspaceId };
  }
  return createWorkspaceWithOwner({ email: DEV_EMAIL, name: "Partner", password: DEV_PASSWORD, workspaceName: "VUVP" });
}
