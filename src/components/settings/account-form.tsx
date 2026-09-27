"use client";

import { useState } from "react";
import { Button, Section } from "@/components/ui";

const input = "h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent";

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "risk"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = v.confirm.length > 0 && v.next !== v.confirm;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: v.current, next: v.next }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setV({ current: "", next: "", confirm: "" });
      setMsg({ tone: "ok", text: "Password changed. Your other sessions were signed out." });
    } catch (e) {
      setMsg({ tone: "risk", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[440px] space-y-10">
      <Section eyebrow="Account" title={name}>
        <div className="text-ink-2">{email}</div>
      </Section>
      <Section eyebrow="Security" title="Change password">
        <p className="mb-4 text-[12.5px] text-ink-3">Replace a temporary password as soon as you sign in. At least 10 characters.</p>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Current password</span>
            <input type="password" autoComplete="current-password" className={input} value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">New password</span>
            <input type="password" autoComplete="new-password" className={input} value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Confirm new password</span>
            <input type="password" autoComplete="new-password" className={input} value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
            {mismatch && <span className="mt-0.5 block text-[11.5px] text-risk">Passwords do not match.</span>}
          </label>
          <div className="flex items-center gap-3 pt-1">
            <Button variant="primary" onClick={save} disabled={busy || !v.current || v.next.length < 10 || v.next !== v.confirm}>
              {busy ? "Saving…" : "Change password"}
            </Button>
          </div>
          {msg && <div className={msg.tone === "ok" ? "text-[12.5px] text-ok" : "text-[12.5px] text-risk"}>{msg.text}</div>}
        </div>
      </Section>
    </div>
  );
}
