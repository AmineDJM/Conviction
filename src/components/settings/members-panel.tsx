"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ago, Badge, Button, Callout, Section } from "@/components/ui";
import { date } from "@/lib/format";

type Role = "OWNER" | "PARTNER" | "ANALYST" | "VIEWER";
const ROLES: Role[] = ["OWNER", "PARTNER", "ANALYST", "VIEWER"];
const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();
const input = "h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent";

interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastSessionAt: string | null;
}

async function api(method: string, body?: unknown, query = "") {
  const res = await fetch(`/api/admin/members${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function MembersPanel({ members, me, isOwner, roleDescriptions }: { members: Member[]; me: string; isOwner: boolean; roleDescriptions: Record<Role, string> }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ name: "", email: "", role: "ANALYST" as Role });
  const [secret, setSecret] = useState<{ email: string; password: string; kind: "invite" | "reset" } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const owners = members.filter((m) => m.role === "OWNER").length;

  async function run(key: string, fn: () => Promise<void>) {
    setErr(null);
    setBusy(key);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const invite = () =>
    run("invite", async () => {
      const r = await api("POST", draft);
      setSecret({ email: r.email, password: r.temporaryPassword, kind: "invite" });
      setDraft({ name: "", email: "", role: "ANALYST" });
    });

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
      <div className="space-y-8">
        {secret && (
          <Callout tone="warn" title={secret.kind === "invite" ? "Account created — temporary password (shown once)" : "Password reset — temporary password (shown once)"}>
            <div className="space-y-2">
              <div>
                Send these to <span className="font-medium text-ink">{secret.email}</span> through a separate channel. The password is not stored in clear and cannot be shown again; they should change it under Settings → Your account after signing in.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded border border-line bg-surface px-2 py-1 font-mono text-[13px] text-ink select-all">{secret.password}</code>
                <Button size="sm" onClick={() => navigator.clipboard?.writeText(secret.password)}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                  Done
                </Button>
              </div>
            </div>
          </Callout>
        )}
        <Section eyebrow="Workspace" title={`${members.length} member${members.length === 1 ? "" : "s"}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Last sign-in</th>
                  {isOwner && <th className="py-2 text-right font-medium" />}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const lastOwner = m.role === "OWNER" && owners <= 1;
                  return (
                    <tr key={m.userId} className="border-t border-line align-middle">
                      <td className="py-2 pr-4">
                        {m.name}
                        {m.userId === me && <span className="ml-2 text-[11.5px] text-ink-3">you</span>}
                      </td>
                      <td className="py-2 pr-4 text-ink-2">{m.email}</td>
                      <td className="py-2 pr-4">
                        {isOwner ? (
                          <select
                            aria-label={`Role of ${m.name}`}
                            className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] outline-none focus:border-accent disabled:opacity-60"
                            value={m.role}
                            disabled={busy !== null || lastOwner}
                            title={lastOwner ? "The workspace must keep at least one owner" : undefined}
                            onChange={(e) => run(`role:${m.userId}`, () => api("PATCH", { userId: m.userId, role: e.target.value }))}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{roleLabel(m.role)}</Badge>
                        )}
                      </td>
                      <td className="num py-2 pr-4 text-ink-3" title={m.lastSessionAt ?? undefined}>
                        {m.lastSessionAt ? <Ago at={m.lastSessionAt} /> : <span>Never · invited {date(m.createdAt)}</span>}
                      </td>
                      {isOwner && (
                        <td className="py-2 text-right whitespace-nowrap">
                          <button
                            className="text-[12px] text-ink-3 hover:text-ink disabled:opacity-40"
                            disabled={busy !== null}
                            onClick={() =>
                              confirm(`Issue a new temporary password for ${m.email}? They will be signed out everywhere.`) &&
                              run(`reset:${m.userId}`, async () => {
                                const r = await api("POST", { action: "reset", userId: m.userId });
                                setSecret({ email: m.email, password: r.temporaryPassword, kind: "reset" });
                              })
                            }
                          >
                            Reset password
                          </button>
                          <button
                            className="ml-3 text-[12px] text-ink-3 hover:text-risk disabled:opacity-40"
                            disabled={busy !== null || lastOwner}
                            title={lastOwner ? "The last owner cannot be removed" : undefined}
                            onClick={() =>
                              confirm(`Remove ${m.name} (${m.email}) from the workspace? Their sessions end immediately.`) &&
                              run(`remove:${m.userId}`, async () => {
                                const r = await api("DELETE", undefined, `?userId=${encodeURIComponent(m.userId)}`);
                                if (r.self) router.push("/login");
                              })
                            }
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err && <div className="mt-3 text-[12.5px] text-risk">{err}</div>}
        </Section>
        <Section eyebrow="Roles">
          <dl className="divide-y divide-line border-y border-line text-[13px]">
            {ROLES.map((r) => (
              <div key={r} className="grid grid-cols-[120px_1fr] gap-3 py-2">
                <dt className="font-medium">{roleLabel(r)}</dt>
                <dd className="text-ink-2">{roleDescriptions[r]}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
      {isOwner ? (
        <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="t-eyebrow">Invite a member</div>
          <input className={input} placeholder="Full name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className={input} type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <select className={input} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <p className="text-[11.5px] text-ink-3">Creates the account with a one-time temporary password, shown once here. No email is sent.</p>
          <Button variant="primary" onClick={invite} disabled={!draft.name.trim() || !draft.email.includes("@") || busy !== null}>
            {busy === "invite" ? "Creating…" : "Create account"}
          </Button>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-3">Only owners can invite members or change roles.</p>
      )}
    </div>
  );
}
