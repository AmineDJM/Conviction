"use client";

import { useMemo, useState } from "react";
import type { Source } from "@/domain/canonical";
import { CLAIM_CATEGORIES } from "@/domain/enums";
import { Badge, cx } from "@/components/ui";
import { EVIDENCE_LABEL_TEXT, evidenceLabelTone, titleCase } from "@/lib/format";
import { FilterSelect, SearchInput, SortTh, TableFrame, Toggle, useSort } from "./table-kit";
import { FRESHNESS_TEXT, INDEPENDENCE_TEXT, ORIGIN_TEXT, VERIFICATION_TEXT, freshnessTone, independenceTone, type EvidenceClaim, type Selection } from "./labels";

type Key = "id" | "category" | "label" | "independence" | "freshness" | "origin" | "source";
const LABEL_ORDER = ["CONTRADICTED", "VERIFIED", "COMPANY_REPORTED", "INFERRED", "ESTIMATED", "UNKNOWN"];
const FRESH_ORDER = ["CURRENT", "AGING", "STALE"];

export function ClaimLedger({ claims, sources, selectedId, onOpen }: { claims: EvidenceClaim[]; sources: Source[]; selectedId: string | null; onOpen: (s: Selection) => void }) {
  const [category, setCategory] = useState("ALL");
  const [verification, setVerification] = useState("ALL");
  const [materialOnly, setMaterialOnly] = useState(false);
  const [q, setQ] = useState("");
  const srcById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);

  const categories = useMemo(() => CLAIM_CATEGORIES.filter((c) => claims.some((x) => x.category === c)), [claims]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return claims.filter((c) => {
      if (category !== "ALL" && c.category !== category) return false;
      if (verification !== "ALL" && c.verification !== verification) return false;
      if (materialOnly && !c.material) return false;
      if (!needle) return true;
      const hay = [c.id, c.statement, c.valueText ?? "", c.entity, c.period ?? "", ...c.evidence.map((e) => `${e.sourceId} ${e.excerpt} ${srcById.get(e.sourceId)?.title ?? ""}`)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [claims, category, verification, materialOnly, q, srcById]);

  const { sorted, sort, toggle } = useSort<EvidenceClaim, Key>(filtered, { key: "id", dir: "asc" }, {
    id: (c) => c.id,
    category: (c) => c.category,
    label: (c) => LABEL_ORDER.indexOf(c.label),
    independence: (c) => c.independence,
    freshness: (c) => FRESH_ORDER.indexOf(c.freshness),
    origin: (c) => c.origin,
    source: (c) => c.evidence[0]?.sourceId ?? null,
  });

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of claims) out[c.verification] = (out[c.verification] ?? 0) + 1;
    return out;
  }, [claims]);
  const filtersOn = category !== "ALL" || verification !== "ALL" || materialOnly || q.trim() !== "";

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search claims, excerpts, sources" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: "ALL", label: "All" }, ...categories.map((c) => ({ value: c, label: titleCase(c) }))]} />
        <FilterSelect
          label="Verification"
          value={verification}
          onChange={setVerification}
          options={[{ value: "ALL", label: "All" }, ...(["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "CONTRADICTED"] as const).map((v) => ({ value: v, label: `${VERIFICATION_TEXT[v]} (${counts[v] ?? 0})` }))]}
        />
        <Toggle checked={materialOnly} onChange={setMaterialOnly} label="Material only" />
        <div className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
          {filtersOn && (
            <button
              type="button"
              className="hover:text-ink"
              onClick={() => {
                setCategory("ALL");
                setVerification("ALL");
                setMaterialOnly(false);
                setQ("");
              }}
            >
              Clear filters
            </button>
          )}
          <span className="num">
            {sorted.length} of {claims.length} claims
          </span>
        </div>
      </div>
      <TableFrame>
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <SortTh k="id" sort={sort} onSort={toggle} className="w-[40%]">
                Claim
              </SortTh>
              <SortTh k="category" sort={sort} onSort={toggle}>
                Category
              </SortTh>
              <th className="sticky top-0 z-10 bg-surface px-3 py-2 text-left text-[11.5px] font-medium text-ink-3 shadow-[inset_0_-1px_0_var(--line)]">Value</th>
              <SortTh k="source" sort={sort} onSort={toggle}>
                Source
              </SortTh>
              <SortTh k="label" sort={sort} onSort={toggle}>
                Verification
              </SortTh>
              <SortTh k="independence" sort={sort} onSort={toggle}>
                Independence
              </SortTh>
              <SortTh k="freshness" sort={sort} onSort={toggle}>
                Freshness
              </SortTh>
              <SortTh k="origin" sort={sort} onSort={toggle}>
                Origin
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const first = c.evidence[0];
              const src = first ? srcById.get(first.sourceId) : undefined;
              const active = selectedId === c.id;
              return (
                <tr
                  key={c.id}
                  id={`row-${c.id}`}
                  tabIndex={0}
                  aria-selected={active}
                  onClick={() => onOpen({ kind: "claim", id: c.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen({ kind: "claim", id: c.id });
                    }
                  }}
                  className={cx("group cursor-pointer outline-none transition-colors focus-visible:bg-accent-soft/50", active ? "bg-accent-soft/60" : "hover:bg-surface-2")}
                >
                  <td className={cx("border-t border-line px-3 py-2 align-top", active && "shadow-[inset_2px_0_0_var(--accent)]")}>
                    <div className="flex gap-2.5">
                      <span className="num mt-[2px] shrink-0 font-mono text-[11px] text-ink-3">{c.id}</span>
                      <span className="line-clamp-2 text-ink" title={c.statement}>
                        {c.statement}
                      </span>
                    </div>
                    {(c.material || c.contradictions.length > 0) && (
                      <div className="mt-1 flex gap-2 pl-[54px] text-[11px] text-ink-3">
                        {c.material && <span>Material</span>}
                        {c.contradictions.length > 0 && <span className="text-risk">{c.contradictions.length} contradiction{c.contradictions.length > 1 ? "s" : ""}</span>}
                      </div>
                    )}
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top text-ink-2">{titleCase(c.category)}</td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <span className="num line-clamp-2 max-w-[160px] text-ink-2" title={c.valueText ?? undefined}>
                      {c.valueText ?? <span className="text-ink-3">—</span>}
                    </span>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    {first ? (
                      <span className="whitespace-nowrap text-[12px] text-ink-2" title={src ? `${src.title}${src.publisher ? ` — ${src.publisher}` : ""}` : undefined}>
                        <span className="font-mono text-[11px]">{first.sourceId}</span>
                        {first.location && !/^https?:/.test(first.location) && <span className="text-ink-3"> · {first.location}</span>}
                        {c.evidence.length > 1 && <span className="text-ink-3"> +{c.evidence.length - 1}</span>}
                      </span>
                    ) : (
                      <span className="text-ink-3">None</span>
                    )}
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <Badge tone={evidenceLabelTone(c.label)} title={`Verification: ${VERIFICATION_TEXT[c.verification]} — ${c.verificationMethod}`}>
                      {EVIDENCE_LABEL_TEXT[c.label]}
                    </Badge>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <Badge tone={independenceTone(c.independence)}>{INDEPENDENCE_TEXT[c.independence]}</Badge>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <Badge tone={freshnessTone(c.freshness)}>{FRESHNESS_TEXT[c.freshness]}</Badge>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top text-[12.5px] text-ink-2">{ORIGIN_TEXT[c.origin]}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="border-t border-line px-3 py-8 text-center text-ink-3">
                  No claims match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
