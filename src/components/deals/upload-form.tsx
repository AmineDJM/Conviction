"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

const MODES = [
  { id: "FAST_SCREEN", label: "Fast screen", cost: "≈ $0.03–0.08", detail: "Deck only, no external research. Quick memo, key metrics, red flags, top questions." },
  { id: "STANDARD", label: "Standard analysis", cost: "target ≤ $0.25 · hard cap $0.50", detail: "Adaptive web research on founders, claims, market and competitors; full memo, returns and questions." },
  { id: "DEEP_DD", label: "Deep DD", cost: "explicit budget up to $3", detail: "For advanced deals only: deeper research budget and reasoning. Re-uses the same evidence object." },
] as const;

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md";

interface UploadMatch {
  companyId: string;
  name: string;
  slug: string;
  verdict: "SAME_LIKELY" | "POSSIBLE" | "DIFFERENT_LIKELY";
  reasons: string[];
}
const VERDICT_TEXT: Record<UploadMatch["verdict"], string> = { SAME_LIKELY: "likely the same company", POSSIBLE: "possibly the same company", DIFFERENT_LIKELY: "same name, likely a different company" };

export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<string>("STANDARD");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Duplicate check before starting: never merge silently — the user answers.
  const [matches, setMatches] = useState<UploadMatch[] | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));
    setMatches(null);
  };

  async function check() {
    if (!files.length) return setError("Add at least one document.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name || null, url: url || null, filenames: files.map((f) => f.name) }) });
      const json = (await res.json().catch(() => ({}))) as { matches?: UploadMatch[] };
      if (res.ok && json.matches?.length) {
        setMatches(json.matches);
        setBusy(false);
        return;
      }
    } catch {
      // The check is advisory: if it fails, the upload proceeds as a new company (the deal page asks again after triage).
    }
    await submit({});
  }

  async function submit(target: { companyId?: string; distinctFrom?: string[] }) {
    if (!files.length) return setError("Add at least one document.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("mode", mode);
    if (url) fd.append("url", url);
    if (name) fd.append("name", name);
    if (target.companyId) {
      fd.append("companyId", target.companyId);
      fd.append("intent", "NEW_DECK_VERSION");
    }
    for (const id of target.distinctFrom ?? []) fd.append("distinctFrom", id);
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      router.push(json.outcome === "ALREADY_ANALYZED" ? `/deals/${json.slug}?dedup=1` : `/deals/${json.slug}?run=${json.runId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-[980px] gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition-colors",
            drag ? "border-accent bg-accent-soft/50" : "border-line-strong bg-surface hover:border-ink-3",
          )}
        >
          <div className="text-[14px] font-medium">Drop the pitch deck here</div>
          <div className="mt-1 text-ink-3">PDF, PPTX or images — several documents allowed (deck, one-pager, financials)</div>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2">
                <span className="truncate">{f.name}</span>
                <span className="flex items-center gap-3 text-[12px] text-ink-3">
                  <span className="num">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button onClick={() => {
                      setFiles(files.filter((_, j) => j !== i));
                      setMatches(null);
                    }} className="hover:text-risk">
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Company name (optional)</span>
            <input value={name} onChange={(e) => (setName(e.target.value), setMatches(null))} className="h-8 w-full rounded-md border border-line bg-surface px-2.5 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Company URL (optional)</span>
            <input value={url} onChange={(e) => (setUrl(e.target.value), setMatches(null))} placeholder="https://" className="h-8 w-full rounded-md border border-line bg-surface px-2.5 outline-none focus:border-accent" />
          </label>
        </div>

        {matches ? (
          <div className="mt-6 rounded-lg border border-warn/30 bg-warn-soft/40 px-4 py-3" role="group" aria-label="Possible existing company">
            <div className="font-medium text-ink">Is this a company you already analysed?</div>
            <ul className="mt-2 space-y-2 text-[12.5px]">
              {matches.map((m) => (
                <li key={m.companyId} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <a href={`/deals/${m.slug}`} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">
                      {m.name}
                    </a>{" "}
                    <span className="text-ink-3">— {VERDICT_TEXT[m.verdict]}</span>
                    <div className="text-ink-3">{m.reasons.join(" · ")}</div>
                  </div>
                  <Button size="sm" variant={m.verdict === "DIFFERENT_LIKELY" ? "ghost" : "primary"} disabled={busy} onClick={() => submit({ companyId: m.companyId })}>
                    New deck version of {m.name}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => submit({ distinctFrom: matches.map((m) => m.companyId) })}>
                {busy ? "Uploading…" : "No — analyse as a different company"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMatches(null)}>
                Back
              </Button>
              {error && <span className="text-[12.5px] text-risk">{error}</span>}
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-3">
            <Button variant="primary" onClick={check} disabled={busy || !files.length}>
              {busy ? "Uploading…" : "Analyze company"}
            </Button>
            {error && <span className="text-[12.5px] text-risk">{error}</span>}
          </div>
        )}
      </div>

      <div>
        <div className="t-eyebrow mb-2">Analysis depth</div>
        <div className="space-y-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cx("w-full rounded-lg border px-3.5 py-3 text-left transition-colors", mode === m.id ? "border-ink bg-surface" : "border-line hover:border-line-strong")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="num text-[11.5px] text-ink-3">{m.cost}</span>
              </div>
              <div className="mt-1 text-[12.5px] text-ink-3">{m.detail}</div>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
          Documents are treated as untrusted data: instructions inside a deck are ignored and flagged. Budgets are enforced in code; if a limit is reached the analysis is labelled Partial with the research not completed.
        </p>
      </div>
    </div>
  );
}
