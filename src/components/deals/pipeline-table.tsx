"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ago, Badge, cx, Empty, IndexBar, Button } from "@/components/ui";
import { DECISION_LABEL, STAGE_LABEL, decisionTone, evidenceTone, levelTone, titleCase, usd } from "@/lib/format";

export interface PipelineRow {
  id: string;
  slug: string;
  name: string;
  oneLiner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  decisionStatus: string | null;
  icDecision: string;
  executionStatus: string;
  exceptionalStrength: string | null;
  oqi: number | null;
  oqiLower: number | null;
  oqiUpper: number | null;
  oqiCoverage: number | null;
  evidence: string | null;
  powerLaw: number | null;
  riskHeadline: string | null;
  riskIndex: number | null;
  roundUsd: number | null;
  postMoneyUsd: number | null;
  baseMoic: number | null;
  peerGroup: string | null;
  analysisDepth: string | null;
  status: string;
  progress: number | null;
  progressLabel: string | null;
  updatedAt: string;
}

const VIEWS: { id: string; label: string; test: (r: PipelineRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "new", label: "New", test: (r) => r.status === "PROCESSING" || !r.decisionStatus },
  { id: "call", label: "Needs call", test: (r) => r.decisionStatus === "NEEDS_FOUNDER_CALL" || r.decisionStatus === "NEEDS_TARGETED_DILIGENCE" },
  { id: "dd", label: "Deep DD", test: (r) => r.decisionStatus === "DEEP_DD" },
  { id: "ic", label: "IC ready", test: (r) => r.decisionStatus === "IC_READY" || r.decisionStatus === "ANALYTICAL_RECOMMEND_INVEST" },
  { id: "watch", label: "Watch", test: (r) => r.decisionStatus === "WATCH" },
  { id: "passed", label: "Passed", test: (r) => r.decisionStatus === "SCREEN_OUT" || r.decisionStatus === "ANALYTICAL_RECOMMEND_PASS" || r.icDecision === "REJECTED" },
  { id: "invested", label: "Invested", test: (r) => r.executionStatus === "FUNDED" || r.executionStatus === "SIGNED" },
];

type SortKey = "name" | "stage" | "oqi" | "powerLaw" | "evidence" | "risk" | "round" | "updated" | "moic";
const STAGE_ORDER = ["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "SERIES_C_PLUS", "UNKNOWN"];
const EVIDENCE_ORDER = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"];

const COLUMNS = ["Stage", "Sector", "Current view", "Exceptional strength", "Quality", "Evidence", "Power-law", "Risk", "Round", "Base MOIC", "Updated"] as const;
type Col = (typeof COLUMNS)[number];

function H({ label, k, right, sort, setSort }: { label: string; k?: SortKey; right?: boolean; sort: { key: SortKey; dir: 1 | -1 }; setSort: (f: (s: { key: SortKey; dir: 1 | -1 }) => { key: SortKey; dir: 1 | -1 }) => void }) {
  return (
    <th className={cx("sticky top-0 z-10 bg-bg px-3 py-2 text-[11.5px] font-medium text-ink-3", right ? "text-right" : "text-left")}>
      {k ? (
        <button onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === "name" ? 1 : -1 }))} className="inline-flex items-center gap-1 hover:text-ink">
          {label}
          {sort.key === k && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function PipelineTable({ rows }: { rows: PipelineRow[] }) {
  const router = useRouter();
  const [view, setView] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated", dir: -1 });
  const [hidden, setHidden] = useState<Set<Col>>(new Set());
  const [compact, setCompact] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);

  // Live progress for processing rows.
  useEffect(() => {
    if (!rows.some((r) => r.status === "PROCESSING")) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [rows, router]);

  useEffect(() => {
    try {
      // Per-viewer preferences are restored after hydration so server and client markup match.
      const saved = JSON.parse(localStorage.getItem("cv.pipeline") ?? "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.hidden) setHidden(new Set(saved.hidden));
      if (saved.compact) setCompact(true);
      if (saved.view) setView(saved.view);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("cv.pipeline", JSON.stringify({ hidden: [...hidden], compact, view }));
    } catch {}
  }, [hidden, compact, view]);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, rows.filter(v.test).length])), [rows]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const v = VIEWS.find((x) => x.id === view) ?? VIEWS[0]!;
    const list = rows.filter(v.test).filter((r) => !ql || [r.name, r.oneLiner, r.sector, r.country, r.exceptionalStrength].some((x) => x?.toLowerCase().includes(ql)));
    const val = (r: PipelineRow): number | string => {
      switch (sort.key) {
        case "name":
          return r.name.toLowerCase();
        case "stage":
          return STAGE_ORDER.indexOf(r.stage ?? "UNKNOWN");
        case "oqi":
          return r.oqi ?? -1;
        case "powerLaw":
          return r.powerLaw ?? -1;
        case "evidence":
          return EVIDENCE_ORDER.indexOf(r.evidence ?? "");
        case "risk":
          return r.riskIndex ?? -1;
        case "round":
          return r.roundUsd ?? -1;
        case "moic":
          return r.baseMoic ?? -1;
        default:
          return r.updatedAt;
      }
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [rows, view, q, sort]);

  const show = (c: Col) => !hidden.has(c);
  if (rows.length === 0)
    return (
      <div className="px-8 pb-10">
        <Empty title="No companies yet" action={<Button href="/analyze" variant="primary">Analyze your first deck</Button>}>
          Upload a pitch deck (PDF, PPTX or images). The system reads it, researches the founders and market, models returns and prepares a Quick Memo — typically for under $0.25.
        </Empty>
      </div>
    );

  const py = compact ? "py-1.5" : "py-2.5";
  return (
    <div className="pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-8">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={cx("whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] transition-colors", view === v.id ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
            >
              {v.label}
              <span className="num ml-1.5 text-[11px] text-ink-3">{counts[v.id]}</span>
            </button>
          ))}
        </nav>
        <div className="relative flex items-center gap-2 pb-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-7 w-44 rounded-md border border-line bg-surface px-2.5 text-[12.5px] outline-none focus:border-accent" />
          <Button size="sm" variant="ghost" onClick={() => setCompact(!compact)}>
            {compact ? "Comfortable" : "Compact"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setColsOpen(!colsOpen)}>
            Columns
          </Button>
          {colsOpen && (
            <div className="anim-in absolute right-0 top-9 z-20 w-52 rounded-lg border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
              {COLUMNS.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={!hidden.has(c)}
                    onChange={() => setHidden((h) => {
                      const n = new Set(h);
                      if (n.has(c)) n.delete(c);
                      else n.add(c);
                      return n;
                    })}
                  />
                  {c}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto px-5">
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <H sort={sort} setSort={setSort} label="Company" k="name" />
              {show("Stage") && <H sort={sort} setSort={setSort} label="Stage" k="stage" />}
              {show("Sector") && <H sort={sort} setSort={setSort} label="Sector" />}
              {show("Current view") && <H sort={sort} setSort={setSort} label="Current view" />}
              {show("Exceptional strength") && <H sort={sort} setSort={setSort} label="Exceptional strength" />}
              {show("Quality") && <H sort={sort} setSort={setSort} label="Quality" k="oqi" />}
              {show("Evidence") && <H sort={sort} setSort={setSort} label="Evidence" k="evidence" />}
              {show("Power-law") && <H sort={sort} setSort={setSort} label="Power-law" k="powerLaw" right />}
              {show("Risk") && <H sort={sort} setSort={setSort} label="Risk" k="risk" />}
              {show("Round") && <H sort={sort} setSort={setSort} label="Round" k="round" right />}
              {show("Base MOIC") && <H sort={sort} setSort={setSort} label="Base MOIC" k="moic" right />}
              {show("Updated") && <H sort={sort} setSort={setSort} label="Updated" k="updated" right />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/deals/${r.slug}`)} className="group cursor-pointer">
                <td className={cx("border-t border-line px-3 group-hover:bg-surface-2", py)}>
                  <Link href={`/deals/${r.slug}`} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  {r.status === "PROCESSING" ? (
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-3">
                      <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
                      {r.progressLabel ?? "Queued"} · {Math.round((r.progress ?? 0) * 100)}%
                    </div>
                  ) : (
                    !compact && r.oneLiner && <div className="mt-0.5 line-clamp-1 max-w-[360px] text-[12px] text-ink-3">{r.oneLiner}</div>
                  )}
                </td>
                {show("Stage") && <td className={cx("border-t border-line px-3 text-ink-2 group-hover:bg-surface-2", py)}>{STAGE_LABEL[r.stage ?? ""] ?? "—"}</td>}
                {show("Sector") && <td className={cx("border-t border-line px-3 text-ink-2 group-hover:bg-surface-2", py)}>{titleCase(r.sector)}</td>}
                {show("Current view") && (
                  <td className={cx("border-t border-line px-3 group-hover:bg-surface-2", py)}>
                    {r.decisionStatus ? (
                      <Badge tone={decisionTone(r.decisionStatus)} dot>
                        {DECISION_LABEL[r.decisionStatus]}
                      </Badge>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                    {r.analysisDepth === "PARTIAL" && <div className="mt-1 text-[11px] text-warn">Partial analysis</div>}
                  </td>
                )}
                {show("Exceptional strength") && (
                  <td className={cx("max-w-[260px] border-t border-line px-3 text-[12.5px] text-ink-2 group-hover:bg-surface-2", py)}>
                    <span className="line-clamp-2">{r.exceptionalStrength ?? "—"}</span>
                  </td>
                )}
                {show("Quality") && (
                  <td className={cx("border-t border-line px-3 group-hover:bg-surface-2", py)}>
                    {r.oqi !== null ? (
                      <div className="flex items-center gap-2.5" title={`Operating Quality Index ${r.oqi} (bounds ${r.oqiLower}–${r.oqiUpper}), coverage ${Math.round((r.oqiCoverage ?? 0) * 100)}% · ${r.peerGroup ?? ""}`}>
                        <span className="num w-7 text-right font-medium">{Math.round(r.oqi)}</span>
                        <IndexBar value={r.oqi} lower={r.oqiLower ?? undefined} upper={r.oqiUpper ?? undefined} width={64} />
                        <span className="num text-[11px] text-ink-3">{Math.round((r.oqiCoverage ?? 0) * 100)}%</span>
                      </div>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                )}
                {show("Evidence") && (
                  <td className={cx("border-t border-line px-3 group-hover:bg-surface-2", py)}>{r.evidence ? <Badge tone={evidenceTone(r.evidence)}>{titleCase(r.evidence)}</Badge> : <span className="text-ink-3">—</span>}</td>
                )}
                {show("Power-law") && <td className={cx("num border-t border-line px-3 text-right group-hover:bg-surface-2", py)}>{r.powerLaw !== null ? Math.round(r.powerLaw) : "—"}</td>}
                {show("Risk") && (
                  <td className={cx("border-t border-line px-3 group-hover:bg-surface-2", py)}>{r.riskHeadline ? <Badge tone={levelTone(r.riskHeadline)}>{titleCase(r.riskHeadline)}</Badge> : <span className="text-ink-3">—</span>}</td>
                )}
                {show("Round") && (
                  <td className={cx("num border-t border-line px-3 text-right group-hover:bg-surface-2", py)}>
                    {usd(r.roundUsd)}
                    {r.postMoneyUsd !== null && <div className="text-[11px] text-ink-3">{usd(r.postMoneyUsd)} post</div>}
                  </td>
                )}
                {show("Base MOIC") && <td className={cx("num border-t border-line px-3 text-right group-hover:bg-surface-2", py)}>{r.baseMoic !== null ? `${r.baseMoic.toFixed(1)}×` : "—"}</td>}
                {show("Updated") && <td className={cx("num border-t border-line px-3 text-right text-[12px] text-ink-3 group-hover:bg-surface-2", py)}><Ago at={r.updatedAt} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="px-3 py-8 text-ink-3">No companies in this view.</div>}
      </div>
    </div>
  );
}
