"use client";

import { useMemo, useState } from "react";
import type { Source } from "@/domain/canonical";
import { Badge, cx } from "@/components/ui";
import { FilterSelect, PlainTh, SortTh, TableFrame, useSort } from "./table-kit";
import { ORIGIN_TEXT, SOURCE_KIND_TEXT, hostOf, isUrl, type EvidenceClaim, type Selection } from "./labels";

type Key = "id" | "title" | "kind" | "origin" | "group" | "claims";

export function SourcesTable({ sources, claims, selectedId, onOpen }: { sources: Source[]; claims: EvidenceClaim[]; selectedId: string | null; onOpen: (s: Selection) => void }) {
  const [kind, setKind] = useState("ALL");
  const cites = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) for (const id of new Set(c.evidence.map((e) => e.sourceId))) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [claims]);
  const filtered = useMemo(() => sources.filter((s) => kind === "ALL" || s.kind === kind), [sources, kind]);
  const { sorted, sort, toggle } = useSort<Source, Key>(filtered, { key: "id", dir: "asc" }, {
    id: (s) => s.id,
    title: (s) => s.title.toLowerCase(),
    kind: (s) => s.kind,
    origin: (s) => s.origin,
    group: (s) => s.independenceGroup,
    claims: (s) => cites.get(s.id) ?? 0,
  });
  const kinds = [...new Set(sources.map((s) => s.kind))];
  const groups = new Set(sources.filter((s) => s.independenceGroup !== "COMPANY").map((s) => s.independenceGroup)).size;
  const unverified = sources.filter((s) => !s.citationVerified).length;

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterSelect label="Kind" value={kind} onChange={setKind} options={[{ value: "ALL", label: "All" }, ...kinds.map((k) => ({ value: k, label: SOURCE_KIND_TEXT[k] }))]} />
        <span className="num ml-auto text-[12px] text-ink-3">
          {sources.length} sources · {groups} independent origin group{groups === 1 ? "" : "s"}
          {unverified > 0 && ` · ${unverified} unverified citation${unverified === 1 ? "" : "s"}`}
        </span>
      </div>
      <TableFrame maxH="max-h-[56vh]">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <SortTh k="id" sort={sort} onSort={toggle}>
                ID
              </SortTh>
              <SortTh k="title" sort={sort} onSort={toggle} className="w-[38%]">
                Source
              </SortTh>
              <SortTh k="kind" sort={sort} onSort={toggle}>
                Kind
              </SortTh>
              <SortTh k="origin" sort={sort} onSort={toggle}>
                Origin
              </SortTh>
              <SortTh k="group" sort={sort} onSort={toggle}>
                Independence group
              </SortTh>
              <PlainTh>Citation</PlainTh>
              <SortTh k="claims" sort={sort} onSort={toggle} align="right">
                Claims
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const active = selectedId === s.id;
              return (
                <tr
                  key={s.id}
                  id={`row-${s.id}`}
                  tabIndex={0}
                  aria-selected={active}
                  onClick={() => onOpen({ kind: "source", id: s.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen({ kind: "source", id: s.id });
                    }
                  }}
                  className={cx("cursor-pointer outline-none transition-colors focus-visible:bg-accent-soft/50", active ? "bg-accent-soft/60" : "hover:bg-surface-2")}
                >
                  <td className={cx("num border-t border-line px-3 py-2 align-top font-mono text-[11px] text-ink-3", active && "shadow-[inset_2px_0_0_var(--accent)]")}>{s.id}</td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <div className="line-clamp-1 text-ink" title={s.title}>
                      {s.title}
                    </div>
                    <div className="truncate text-[11.5px] text-ink-3">
                      {isUrl(s.url) ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="hover:text-accent-text hover:underline">
                          {hostOf(s.url)} ↗
                        </a>
                      ) : s.kind === "DOCUMENT" || s.kind === "TRANSCRIPT" ? (
                        "Uploaded document"
                      ) : (
                        "—"
                      )}
                      {s.publisher && <span> · {s.publisher}</span>}
                      {s.publishedDate && <span className="num"> · {s.publishedDate}</span>}
                    </div>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top text-ink-2">{SOURCE_KIND_TEXT[s.kind]}</td>
                  <td className="border-t border-line px-3 py-2 align-top text-ink-2">{ORIGIN_TEXT[s.origin]}</td>
                  <td className="border-t border-line px-3 py-2 align-top font-mono text-[11.5px] text-ink-2">{s.independenceGroup}</td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    {s.citationVerified ? (
                      <Badge tone="neutral" title={s.kind === "WEB" ? "URL was returned by the search tool" : "Uploaded by the analyst"}>
                        Retrieved
                      </Badge>
                    ) : (
                      <Badge tone="warn" title="URL was not among retrieved search results. Treated as unverified.">
                        Unverified citation
                      </Badge>
                    )}
                  </td>
                  <td className="num border-t border-line px-3 py-2 text-right align-top text-ink-2">{cites.get(s.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}

export function DocumentPages({ documents, selected, onOpen }: { documents: { id: string; filename: string; kind: string; pages: { pageNo: number; text: string }[] }[]; selected: { id: string; page: number } | null; onOpen: (s: Selection) => void }) {
  if (!documents.length) return <p className="text-ink-3">No documents stored for this company.</p>;
  return (
    <div className="space-y-6">
      {documents.map((d) => (
        <div key={d.id}>
          <div className="mb-2 flex items-baseline gap-3">
            <span className="font-medium text-ink">{d.filename}</span>
            <span className="num text-[12px] text-ink-3">
              {d.kind.toLowerCase()} · {d.pages.length} page{d.pages.length === 1 ? "" : "s"} · {d.pages.reduce((a, p) => a + p.text.length, 0).toLocaleString("en-US")} characters extracted
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {d.pages.map((p, i) => {
              const active = selected?.id === d.id && selected.page === p.pageNo;
              const preview = p.text.replace(/\s+/g, " ").trim();
              return (
                <button
                  key={p.pageNo}
                  id={`row-${d.id}-${p.pageNo}`}
                  type="button"
                  onClick={() => onOpen({ kind: "doc", id: d.id, page: p.pageNo })}
                  className={cx("grid w-full grid-cols-[64px_1fr_auto] items-baseline gap-3 px-3 py-2 text-left text-[13px] transition-colors", i > 0 && "border-t border-line", active ? "bg-accent-soft/60" : "hover:bg-surface-2")}
                >
                  <span className="num font-mono text-[11px] text-ink-3">p. {p.pageNo}</span>
                  <span className={cx("truncate", preview ? "text-ink-2" : "italic text-ink-3")}>{preview || "No extractable text on this page (image-only)"}</span>
                  <span className="num text-[11px] text-ink-3">{p.text.length.toLocaleString("en-US")} ch</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
