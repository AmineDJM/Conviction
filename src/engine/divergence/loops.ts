/**
 * 9. COMPOUNDING LOOP STRENGTH — does each new customer make the company
 * better? Loops (data → better product → better outcomes → more customers →
 * lower CAC → more data; supply → liquidity → demand; integrations;
 * community/content) are broken into links; a loop is only as strong as its
 * weakest link. More important than a static moat.
 */
import type { LINK_STATUSES } from "@/domain/sections";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, hasNumber, hasText, isFact, metricRef, num, pagesOfEvidence, pct1 } from "./util";

export type LinkStatus = (typeof LINK_STATUSES)[number];
export const LINK_RANK: Record<LinkStatus, number> = { ABSENT: 0, ASSERTED: 1, PLAUSIBLE: 2, DEMONSTRATED: 3 };

export interface LoopLink {
  from: string;
  to: string;
  reported: LinkStatus;
  status: LinkStatus;
  adjustment: string | null;
  evidence: string;
  page: number | null;
}

export interface Loop {
  kind: string;
  description: string;
  links: LoopLink[];
  status: LinkStatus;
  weakestLink: LoopLink | null;
  note: string | null;
}

export interface LoopsFactor extends FactorBase {
  id: "COMPOUNDING_LOOPS";
  loops: Loop[];
  strongest: Loop | null;
}

/** Code-enforced link status: DEMONSTRATED needs a measured number; a link without a stated fact is ASSERTED. */
export function normalizeLink(l: { from: string; to: string; status: LinkStatus; evidence: string; page: number | null }): LoopLink {
  let status = l.status;
  let adjustment: string | null = null;
  if (status !== "ABSENT" && !isFact(l.evidence)) {
    status = "ASSERTED";
    adjustment = hasText(l.evidence) ? "evidence states an absence → asserted" : "no stated fact → asserted";
  } else if (status === "DEMONSTRATED" && !hasNumber(l.evidence)) {
    status = "PLAUSIBLE";
    adjustment = "no measured number → plausible";
  }
  return { from: l.from, to: l.to, reported: l.status, status, adjustment, evidence: l.evidence, page: l.page };
}

export function loopStatus(links: LoopLink[]): { status: LinkStatus; weakest: LoopLink | null; note: string | null } {
  if (!links.length) return { status: "ABSENT", weakest: null, note: "no links" };
  let weakest = links[0]!;
  for (const l of links) if (LINK_RANK[l.status] < LINK_RANK[weakest.status]) weakest = l;
  let status = weakest.status;
  let note: string | null = null;
  if (links.length < 2 && LINK_RANK[status] > LINK_RANK.ASSERTED) {
    status = "ASSERTED";
    note = "a single link is not a loop";
  }
  return { status, weakest, note };
}

export function compoundingLoops(inp: DivergenceInputs): LoopsFactor {
  const draft = inp.draft;
  const loops: Loop[] = (draft?.loops ?? []).map((lp) => {
    const links = lp.links.map(normalizeLink);
    const s = loopStatus(links);
    return { kind: lp.kind, description: lp.description, links, status: s.status, weakestLink: s.weakest, note: s.note };
  });
  const strongest =
    [...loops].sort((a, b) => LINK_RANK[b.status] - LINK_RANK[a.status] || b.links.filter((l) => l.status === "DEMONSTRATED").length - a.links.filter((l) => l.status === "DEMONSTRATED").length || b.links.length - a.links.length)[0] ?? null;

  const evidence: DivergenceEvidence[] = [];
  for (const lp of loops) {
    evidence.push(ev("COMPUTED", `${lp.kind.toLowerCase().replace(/_/g, " ")} loop — ${lp.status.toLowerCase()}${lp.weakestLink ? `; weakest link ${lp.weakestLink.from} → ${lp.weakestLink.to} (${lp.weakestLink.status.toLowerCase()})` : ""}${lp.note ? ` (${lp.note})` : ""}`));
    for (const l of lp.links) evidence.push(ev("MODEL_OBSERVED", `${l.from} → ${l.to}: ${l.status.toLowerCase()}${l.adjustment ? ` [${l.adjustment}]` : ""}${hasText(l.evidence) ? ` — ${l.evidence}` : ""}`, [l.page]));
  }
  // Metrics that bear on common links (context only; they do not change link statuses).
  const organic = metricRef(inp.deal, "organic_acquisition_share");
  const nrr = metricRef(inp.deal, "nrr");
  if (organic) evidence.push(ev("COMPUTED", `Organic acquisition share ${pct1(organic.value)} (context for referral / brand links)`, [organic.page], [organic.ref]));
  if (nrr && loops.length) evidence.push(ev("COMPUTED", `NRR ${pct1(nrr.value)} (context for "better outcomes → customers buy more")`, [nrr.page], [nrr.ref]));

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "UNREAD";
  if (draft) {
    const s = strongest?.status ?? "ABSENT";
    level = s === "DEMONSTRATED" ? "STRONG" : s === "PLAUSIBLE" ? "ADEQUATE" : "WEAK";
    reading = strongest ? s : "NO_LOOP";
  }
  const why =
    !draft
      ? "The materials were not read for compounding loops."
      : !strongest
        ? "No loop in which each new customer makes the company better is shown — growth is linear."
        : `Strongest loop (${strongest.kind.toLowerCase().replace(/_/g, " ")}) is ${strongest.status.toLowerCase()}${strongest.weakestLink && LINK_RANK[strongest.weakestLink.status] < LINK_RANK.DEMONSTRATED ? `; weakest link: ${strongest.weakestLink.from} → ${strongest.weakestLink.to} (${strongest.weakestLink.status.toLowerCase()})` : ""}.`;

  const implications: string[] = [];
  if (strongest && strongest.weakestLink && LINK_RANK[strongest.weakestLink.status] < LINK_RANK.DEMONSTRATED)
    implications.push(`The next proof is the weakest link: show "${strongest.weakestLink.from} → ${strongest.weakestLink.to}" with a measured number; until then the loop is a hypothesis.`);
  if (level === "STRONG") implications.push("Each customer makes the product better or cheaper to sell — the gap to lookalikes widens with scale.");
  if (draft && !strongest) implications.push("Without a loop, advantage must come from execution speed or a static moat; lookalikes can catch up with capital.");

  return {
    id: "COMPOUNDING_LOOPS",
    n: 9,
    name: "Compounding loop strength",
    question: "Does each new customer make the company better?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: "Each loop is broken into links; a link is DEMONSTRATED only when its evidence carries a measured number (else PLAUSIBLE), and a link without a stated fact is ASSERTED. A loop's status is its weakest link; a single link is at most ASSERTED. Strongest loop DEMONSTRATED → STRONG, PLAUSIBLE → ADEQUATE, ASSERTED/ABSENT or no loop → WEAK.",
    evidence,
    coverage: coverage([!!draft && "loops read (divergence pass)", loops.length > 0 && `${loops.length} loop(s)`, !!organic && "organic acquisition share", !!nrr && "NRR"], [!draft && "loops read (divergence pass)", !organic && "organic acquisition share", !nrr && "NRR"]),
    computed: [
      num("loops", "Loops identified", loops.length, "COUNT"),
      num("strongest", "Strongest loop status", strongest?.status ?? null, "TEXT"),
      num("weakestLink", "Weakest link", strongest?.weakestLink ? `${strongest.weakestLink.from} → ${strongest.weakestLink.to}` : null, "TEXT"),
      num("demonstratedLinks", "Demonstrated links (all loops)", loops.reduce((s, l) => s + l.links.filter((x) => x.status === "DEMONSTRATED").length, 0), "COUNT"),
    ],
    implications,
    loops,
    strongest,
  };
}
