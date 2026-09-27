"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

const MODES = [
  { id: "FAST_SCREEN", label: "Fast screen", cost: "≈ $0.03–0.10", detail: "Deck only, no external research. Quick memo, key metrics, red flags, top questions." },
  { id: "STANDARD", label: "Standard analysis", cost: "target ≤ $0.25 · hard cap $0.50", detail: "Adaptive web research on founders, claims, market and competitors; full memo, returns and questions." },
  { id: "DEEP_DD", label: "Deep DD", cost: "explicit budget up to $3", detail: "For advanced deals only: deeper research budget and reasoning. Re-uses the same evidence object." },
] as const;

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md";

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

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));
  };

  async function submit() {
    if (!files.length) return setError("Add at least one document.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("mode", mode);
    if (url) fd.append("url", url);
    if (name) fd.append("name", name);
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
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="hover:text-risk">
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
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-full rounded-md border border-line bg-surface px-2.5 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Company URL (optional)</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="h-8 w-full rounded-md border border-line bg-surface px-2.5 outline-none focus:border-accent" />
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button variant="primary" onClick={submit} disabled={busy || !files.length}>
            {busy ? "Uploading…" : "Analyze company"}
          </Button>
          {error && <span className="text-[12.5px] text-risk">{error}</span>}
        </div>
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
