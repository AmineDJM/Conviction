"use client";

/**
 * On a deal: upload a new deck version (v(n+1), analysed on the SAME company) or
 * add documents to the current deck (re-analysed with them). Overrides are
 * carried over and re-anchored; the header then shows the run's progress.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md";
const MODES = [
  { id: "FAST_SCREEN", label: "Fast screen" },
  { id: "STANDARD", label: "Standard" },
  { id: "DEEP_DD", label: "Deep DD" },
] as const;

export function DeckUpload({ companyId, slug, nextDeck, defaultMode, disabled }: { companyId: string; slug: string; nextDeck: number; defaultMode: string; disabled?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<"NEW_DECK_VERSION" | "ADD_DOCUMENTS">("NEW_DECK_VERSION");
  const [mode, setMode] = useState<string>(defaultMode);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!files.length) return setError("Choose at least one file.");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("mode", mode);
    fd.append("companyId", companyId);
    fd.append("intent", intent);
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setOpen(false);
      setFiles([]);
      router.push(json.outcome === "ALREADY_ANALYZED" ? `/deals/${json.slug}?dedup=1` : `/deals/${json.slug}?run=${json.runId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled} title={disabled ? "An analysis is running" : `Upload deck v${nextDeck} or add documents to this company`}>
        New deck version
      </Button>
    );
  // Portalled: the sticky deal header uses backdrop-filter, which would trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-24" role="dialog" aria-modal="true" aria-label="Upload a new deck version" onClick={() => !busy && setOpen(false)}>
      <div className="w-full max-w-[520px] rounded-xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="t-section mb-1">Add to this company</div>
        <p className="mb-4 text-[12.5px] text-ink-3">Analysed on the same company as a new immutable version. Analyst overrides are carried over and re-anchored; any that cannot be re-applied are listed, never dropped.</p>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["NEW_DECK_VERSION", `New deck version (v${nextDeck})`, "The founder sent an updated deck. We compare it with the previous one."],
              ["ADD_DOCUMENTS", "Add documents", "Financials, one-pager, data room extract — read with the current deck."],
            ] as const
          ).map(([id, label, detail]) => (
            <button key={id} type="button" onClick={() => setIntent(id)} className={cx("rounded-lg border px-3 py-2 text-left", intent === id ? "border-ink bg-surface-2" : "border-line hover:border-line-strong")}>
              <div className="text-[13px] font-medium">{label}</div>
              <div className="mt-0.5 text-[12px] text-ink-3">{detail}</div>
            </button>
          ))}
        </div>
        <div
          className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-2 hover:border-ink-3"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 10));
          }}
        >
          {files.length ? files.map((f) => f.name).join(", ") : intent === "NEW_DECK_VERSION" ? "Drop the new deck here (PDF, PPTX or images)" : "Drop the documents here"}
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && setFiles((f) => [...f, ...Array.from(e.target.files!)].slice(0, 10))} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-ink-3">Depth</span>
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)} className={cx("rounded-md border px-2 py-0.5", mode === m.id ? "border-ink text-ink" : "border-line text-ink-3 hover:text-ink")}>
              {m.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-[12.5px] text-risk">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || !files.length}>
            {busy ? "Uploading…" : intent === "NEW_DECK_VERSION" ? `Analyse deck v${nextDeck}` : "Re-analyse with these documents"}
          </Button>
        </div>
        <p className="mt-3 text-[11.5px] text-ink-3">
          Deck lineage and “what changed since the last deck” appear on the overview and in{" "}
          <a className="text-accent-text hover:underline" href={`/deals/${slug}/history#decks`}>
            History
          </a>
          .
        </p>
      </div>
    </div>,
    document.body,
  );
}
