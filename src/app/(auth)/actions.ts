"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, createWorkspaceWithOwner, destroySession, hasAnyUser, login, SESSION_COOKIE } from "@/server/auth";
import { audit } from "@/server/repo";

async function setCookie(value: string, expires: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(expires) });
}

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const s = login(email, password);
  if (!s) return { error: "Email or password is incorrect." };
  await setCookie(s.cookie, s.expires);
  redirect("/");
}

export async function setupAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  if (hasAnyUser()) return { error: "This instance is already set up. Sign in instead." };
  const email = String(form.get("email") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const workspaceName = String(form.get("workspace") ?? "").trim() || "Fund";
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 10) return { error: "Use at least 10 characters for the password." };
  const { userId, workspaceId } = createWorkspaceWithOwner({ email, name: name || email.split("@")[0]!, password, workspaceName });
  audit(workspaceId, userId, "WORKSPACE_CREATED");
  const s = createSession(userId, workspaceId);
  await setCookie(s.cookie, s.expires);
  redirect("/fund?welcome=1");
}

export async function logoutAction() {
  const jar = await cookies();
  destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
