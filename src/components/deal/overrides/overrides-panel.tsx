"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, cx } from "@/components/ui";
import { FINANCING_STAGES, GTM_MOTIONS, INDUSTRIES, OPERATIONAL_MATURITY, PRODUCT_TYPES, REVENUE_MODELS, TECHNOLOGIES, VERIFICATION_STATUSES } from "@/domain/enums";
import { titleCase } from "@/lib/format";

export interface OverrideRow {
  id: string;
  target: "METRIC" | "CLASSIFICATION" | "ENTITY" | "CLAIM";
  ref: string;
  field: string;
  from: unknown;
  to: unknown;
  rawValue: unknown;
  reason: string;
  by: string | null;
  at: string;
  propagatedTo: string[];
  /** Why the override is not applied in this version (target not found after a re-analysis, …); null when applied. */
  stale: string | null;
  /** Stable description of the target ("ARR · period 2025-12 · basis CURRENT"). */
  target_label: string | null;
  /** Carried over from an earlier analysis: where it landed, or why it could not be re-applied. */
  carry: { status: "REANCHORED" | "UNANCHORED"; match: string | null; fromRef: string; note: string } | null;
  /** Id of the legacy USER_CORRECTED instance this override was upgraded from. */
  legacyCorrection: string | null;
}

export interface OverridesPanelProps {
  companyId: string;
  versionId: string;
  canWrite: boolean;
  rows: OverrideRow[];
  claims: { id: string; statement: string; verification: string; material: boolean }[];
  classification: Record<string, unknown>;
  identity: Record<string, unknown>;
}

const enumText = (x: string) => titleCase(x).replace(/ ([a-z])$/, (m) => m.toUpperCase()); // SERIES_A → "Series A"
export const showValue = (v: unknown): string => (v === null || v === undefined ? "none" : Array.isArray(v) ? v.map((x) => enumText(String(x))).join(", ") || "none" : typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "string" && /^[A-Z_]+$/.test(v) ? enumText(v) : String(v));

/** POST / DELETE /api/deals/:id/overrides. Returns an error message or null. */
export async function sendOverride(companyId: string, method: "POST" | "DELETE", body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/deals/${encodeURIComponent(companyId)}/overrides`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : (json.error ?? `Request failed (${res.status})`);
  } catch (e) {
    return (e as Error).message;
  }
}

const CLASS_FIELDS: Record<string, { label: string; options: readonly string[]; multi: boolean }> = {
  financingStage: { label: "Financing stage", options: FINANCING_STAGES, multi: false },
  operationalMaturity: { label: "Operational maturity", options: OPERATIONAL_MATURITY, multi: false },
  industry: { label: "Industry", options: INDUSTRIES, multi: true },
  productType: { label: "Product type", options: PRODUCT_TYPES, multi: true },
  technology: { label: "Technology", options: TECHNOLOGIES, multi: true },
  revenueModel: { label: "Revenue model", options: REVENUE_MODELS, multi: true },
  gtm: { label: "Go-to-market", options: GTM_MOTIONS, multi: true },
};
const ENTITY_FIELDS: Record<string, string> = { name: "Company name", legalName: "Legal name", website: "Website", hqCountry: "HQ country", foundedYear: "Founded year" };

export function OverridesPanel(p: OverridesPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = p.rows.filter((r) => !r.stale);
  const stale = p.rows.filter((r) => r.stale);

  const revert = async (id: string) => {
    if (!window.confirm(`Revert ${id}? A new version is saved; the override stays in the version history.`)) return;
    setBusy(id);
    setError(null);
    const err = await sendOverride(p.companyId, "DELETE", { overrideId: id, versionId: p.versionId });
    setBusy(null);
    if (err) setError(err);
    else router.refresh();
  };

  return (
    <div className="space-y-5">
      {stale.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft/40 px-3 py-2 text-[12.5px]">
          <div className="font-medium text-warn">
            {stale.length} override{stale.length === 1 ? "" : "s"} not applied in this version
          </div>
          <ul className="mt-1 space-y-0.5 text-ink-2">
            {stale.map((r) => (
              <li key={r.id}>
                <span className="font-mono text-[11px]">{r.id}</span> {r.target_label ?? `${r.ref}.${r.field}`} → {showValue(r.to)}: {r.stale!.replace(/^not re-applied: /, "")}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-ink-3">Kept for review, never applied to another target. Re-create it on the right value, or remove it.</div>
        </div>
      )}
      {active.length === 0 && stale.length === 0 ? (
        <p className="text-[13px] text-ink-3">No analyst overrides. Every value shown is the company&apos;s or the engine&apos;s.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {[...active, ...stale].map((r) => (
            <li key={r.id} className="grid gap-x-4 gap-y-1 py-2 text-[12.5px] sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] text-ink-3">{r.id}</span>
                  <Badge tone="accent">Analyst override</Badge>
                  <span className="font-medium text-ink">
                    {r.target === "METRIC" || r.target === "CLAIM" ? r.ref : titleCase(r.target)} · {r.target === "CLASSIFICATION" ? (CLASS_FIELDS[r.field]?.label ?? r.field) : r.target === "ENTITY" ? (ENTITY_FIELDS[r.field] ?? r.field) : r.field}
                  </span>
                  {r.stale && <Badge tone="warn">Not applied</Badge>}
                  {r.carry?.status === "REANCHORED" && r.carry.fromRef !== r.ref && (
                    <Badge tone="neutral" title={r.carry.note}>
                      Carried over: {r.carry.fromRef} → {r.ref}
                    </Badge>
                  )}
                  {r.legacyCorrection && <Badge tone="neutral" title={`Upgraded from the legacy corrected instance ${r.legacyCorrection}`}>From “Correct this metric”</Badge>}
                </div>
                {r.target_label && <div className="text-[11.5px] text-ink-3">{r.target_label}</div>}
                <div className="mt-0.5 text-ink-2">
                  {r.target === "METRIC" || r.target === "CLAIM" ? "Company / engine value" : "Extracted"} <b className="font-medium">{showValue(r.rawValue ?? r.from)}</b> · analyst override <b className="font-medium text-accent-text">{showValue(r.to)}</b>
                  {JSON.stringify(r.from) !== JSON.stringify(r.rawValue) && r.rawValue !== undefined && <span className="text-ink-3"> (replaced {showValue(r.from)})</span>}
                </div>
                <div className="text-ink-3">
                  “{r.reason}” — {r.by ?? "unknown"} · {r.at.slice(0, 10)}
                  {r.propagatedTo.length > 0 && <span> · recomputed {r.propagatedTo.join(", ")}</span>}
                </div>
                {r.carry && <div className={cx("text-[11.5px]", r.carry.status === "UNANCHORED" ? "text-warn" : "text-ink-3")}>{r.carry.note}</div>}
              </div>
              {p.canWrite && (
                <div>
                  <Button size="sm" variant="ghost" onClick={() => revert(r.id)} disabled={busy !== null}>
                    {busy === r.id ? "Reverting…" : r.stale ? "Remove" : "Revert"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[12.5px] text-risk">{error}</p>}
      {p.canWrite ? <AddOverride {...p} /> : <p className="text-[12px] text-ink-3">Read-only role: overrides can be added by analysts and partners.</p>}
      <p className="text-[11.5px] text-ink-3">Metric values are overridden from the metric drawer (click any number). Raw extraction is never overwritten: each override saves a new version, is applied before scoring, and is marked wherever the value appears.</p>
    </div>
  );
}

function AddOverride(p: OverridesPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"CLASSIFICATION" | "ENTITY" | "CLAIM">("CLASSIFICATION");
  const [field, setField] = useState("financingStage");
  const [ref, setRef] = useState(p.claims[0]?.id ?? "");
  const [value, setValue] = useState<unknown>(p.classification.financingStage ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(
    () =>
      target === "CLASSIFICATION"
        ? Object.entries(CLASS_FIELDS).map(([k, v]) => ({ k, label: v.label }))
        : target === "ENTITY"
          ? Object.entries(ENTITY_FIELDS).map(([k, label]) => ({ k, label }))
          : [
              { k: "verification", label: "Verification" },
              { k: "material", label: "Material" },
            ],
    [target],
  );

  const current = (t: string, f: string, r: string): unknown => {
    if (t === "CLASSIFICATION") return p.classification[f];
    if (t === "ENTITY") return p.identity[f];
    const c = p.claims.find((x) => x.id === r);
    return c ? (f === "verification" ? c.verification : c.material) : null;
  };
  const pickTarget = (t: typeof target) => {
    const f = t === "CLASSIFICATION" ? "financingStage" : t === "ENTITY" ? "hqCountry" : "verification";
    setTarget(t);
    setField(f);
    setValue(current(t, f, ref) ?? "");
  };
  const pickField = (f: string) => {
    setField(f);
    setValue(current(target, f, ref) ?? (CLASS_FIELDS[f]?.multi ? [] : ""));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const to = target === "ENTITY" && field === "foundedYear" ? (value === "" ? null : Number(value)) : target === "ENTITY" && value === "" ? null : value;
    const err = await sendOverride(p.companyId, "POST", {
      target,
      ref: target === "CLASSIFICATION" ? "classification" : target === "ENTITY" ? "identity" : ref,
      field,
      to,
      reason,
      versionId: p.versionId,
    });
    setBusy(false);
    if (err) setError(err);
    else {
      setOpen(false);
      setReason("");
      router.refresh();
    }
  };

  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Add an override…
      </Button>
    );
  const cls = CLASS_FIELDS[field];
  const input = "h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-ink-3">
          Target
          <select className={input} value={target} onChange={(e) => pickTarget(e.target.value as typeof target)}>
            <option value="CLASSIFICATION">Classification</option>
            <option value="ENTITY">Entity (identity)</option>
            <option value="CLAIM">Claim</option>
          </select>
        </label>
        {target === "CLAIM" && (
          <label className="text-[12px] text-ink-3 sm:col-span-2">
            Claim
            <select
              className={input}
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
                setValue(current(target, field, e.target.value) ?? "");
              }}
            >
              {p.claims.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.statement.slice(0, 90)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-[12px] text-ink-3">
          Field
          <select className={input} value={field} onChange={(e) => pickField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.k} value={f.k}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 text-[12px] text-ink-3">
        Current value: <span className="text-ink">{showValue(current(target, field, ref))}</span>
      </div>
      <div className="mt-1.5">
        {target === "CLASSIFICATION" && cls && !cls.multi && (
          <select className={input} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} aria-label="New value">
            {cls.options.map((o) => (
              <option key={o} value={o}>
                {enumText(o)}
              </option>
            ))}
          </select>
        )}
        {target === "CLASSIFICATION" && cls?.multi && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" role="group" aria-label="New values">
            {cls.options.map((o) => {
              const list = Array.isArray(value) ? (value as string[]) : [];
              return (
                <label key={o} className="flex items-center gap-1.5 text-ink-2">
                  <input type="checkbox" checked={list.includes(o)} onChange={(e) => setValue(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
                  {titleCase(o)}
                </label>
              );
            })}
          </div>
        )}
        {target === "ENTITY" && <input className={input} aria-label="New value" type={field === "foundedYear" ? "number" : "text"} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} />}
        {target === "CLAIM" && field === "verification" && (
          <select className={input} value={String(value ?? "")} onChange={(e) => setValue(e.target.value)} aria-label="New value">
            {VERIFICATION_STATUSES.map((o) => (
              <option key={o} value={o}>
                {titleCase(o)}
              </option>
            ))}
          </select>
        )}
        {target === "CLAIM" && field === "material" && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={value === true} onChange={(e) => setValue(e.target.checked)} /> Material (would change the investment view if false)
          </label>
        )}
      </div>
      <label className="mt-3 block text-[12px] text-ink-3">
        Reason (source or rationale — kept in the audit trail)
        <textarea className="mt-0.5 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="mt-2 text-[12.5px] text-risk">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={submit} disabled={busy || reason.trim().length < 3}>
          {busy ? "Saving…" : "Save override as new version"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
