"use client";

import { useRouter } from "next/navigation";
import { reasonText } from "./labels";

export interface PickerVersion {
  id: string;
  versionNo: number;
  reason: string;
  createdAt: string;
}

export function VersionPicker({ slug, versions, fromId, toId }: { slug: string; versions: PickerVersion[]; fromId: string; toId: string }) {
  const router = useRouter();
  const go = (from: string, to: string) => router.push(`/deals/${slug}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}#compare`, { scroll: false });
  const opt = (v: PickerVersion) => `v${v.versionNo} · ${reasonText(v.reason)} · ${v.createdAt.slice(0, 16).replace("T", " ")} UTC`;
  const cls = "h-8 max-w-[300px] rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink outline-none hover:border-line-strong focus-visible:border-accent";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
      <label className="inline-flex items-center gap-1.5">
        <span>From</span>
        <select aria-label="Compare from version" value={fromId} onChange={(e) => go(e.target.value, toId)} className={cls}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {opt(v)}
            </option>
          ))}
        </select>
      </label>
      <span aria-hidden>→</span>
      <label className="inline-flex items-center gap-1.5">
        <span>To</span>
        <select aria-label="Compare to version" value={toId} onChange={(e) => go(fromId, e.target.value)} className={cls}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {opt(v)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => go(toId, fromId)} className="rounded-md px-2 py-1 hover:bg-surface-2 hover:text-ink" title="Swap">
        Swap
      </button>
    </div>
  );
}
