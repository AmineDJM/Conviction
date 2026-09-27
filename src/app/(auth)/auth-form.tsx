"use client";

import { useActionState } from "react";

type Field = { name: string; label: string; type?: string; autoComplete?: string; placeholder?: string };

export function AuthForm({ action, fields, submit }: { action: (s: unknown, f: FormData) => Promise<{ error?: string }>; fields: Field[]; submit: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3.5">
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-[12.5px] text-ink-2">{f.label}</span>
          <input
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            required={f.name !== "name" && f.name !== "workspace"}
            className="h-9 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
        </label>
      ))}
      {state?.error && <div className="text-[12.5px] text-risk">{state.error}</div>}
      <button disabled={pending} className="h-9 w-full rounded-md bg-ink text-[13.5px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
