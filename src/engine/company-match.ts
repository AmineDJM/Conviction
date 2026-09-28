/**
 * COMPANY DUPLICATE DETECTION (pure, deterministic).
 *
 * "Is this upload a new deck of a company we already analysed?" Signals:
 *   name      normalized company name (legal suffixes, case, accents, spacing ignored),
 *             or — before the model has read the deck — the name found in the file name
 *   domain    identity-bearing domain of the website (app.ledgerline.io ≡ ledgerline.io; hosting platforms
 *             such as *.notion.site keep the full host — engine/web-domain.ts)
 *   founders  normalized founder names (order and accents ignored)
 * Verdicts are suggestions only: the product always ASKS before merging.
 *   SAME_LIKELY       same domain, or same name with a founder in common
 *   POSSIBLE          same name with nothing to tell them apart, same domain but different founders,
 *                     or several founders in common under another name (pivot / rename)
 *   DIFFERENT_LIKELY  homonym: same name but a different domain or disjoint founders
 */

import { websiteDomain } from "./web-domain";

export type MatchVerdict = "SAME_LIKELY" | "POSSIBLE" | "DIFFERENT_LIKELY";
export type Signal = "SAME" | "DIFFERENT" | "UNKNOWN";

export interface CompanyProbe {
  name: string | null;
  /** FILENAME: the name was guessed from a file name (weaker: prefix matches allowed, never conclusive). */
  nameSource: "USER" | "FILENAME" | "IDENTITY";
  website: string | null;
  founders: string[];
}

export interface CompanyCandidate {
  id: string;
  name: string;
  website?: string | null;
  /** Pre-computed registrable domain (companies.website_domain); used when `website` is absent. */
  domain?: string | null;
  founders: string[];
}

export interface CompanyMatch {
  companyId: string;
  name: string;
  verdict: MatchVerdict;
  signals: { name: Signal | "PREFIX"; domain: Signal; founders: Signal; foundersInCommon: string[] };
  reasons: string[];
}

const LEGAL = /\b(inc|incorporated|ltd|llc|llp|gmbh|sas|sasu|sarl|sa|ag|bv|nv|oy|ab|as|srl|spa|plc|corp|corporation|co|company|limited|technologies|technology|labs|ai|hq|holding|holdings|group)\b\.?/g;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

/** Compact comparison key of a company name ("Ledgerline, Inc." → "ledgerline"). */
export function companyNameKey(name: string | null | undefined): string {
  return fold(name ?? "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, "");
}

function nameTokens(name: string): string[] {
  return fold(name)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const FILE_NOISE = new Set([
  "deck", "pitch", "pitchdeck", "presentation", "slides", "final", "draft", "clean", "version", "update", "updated", "investor", "investors", "fundraising",
  "round", "seed", "preseed", "pre", "series", "confidential", "teaser", "onepager", "one", "pager", "memo", "copy", "compressed", "web", "public", "nda",
  "en", "fr", "de", "es", "english", "french", "vf", "new", "latest", "the", "of", "for", "raise", "fundraise", "summary", "overview", "company", "startup",
]);

/** The company name a file name most likely carries ("ledgerline-series-a-v2.pdf" → "ledgerline"); null when nothing is left. */
export function nameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, "");
  const toks = fold(base.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (FILE_NOISE.has(t)) {
      if (t === "series" && /^[a-f]$/.test(toks[i + 1] ?? "")) i++;
      continue;
    }
    if (/^v\d+$|^\d{1,4}$|^q[1-4]$|^h[12]$|^\d{4}q[1-4]$|^(19|20)\d{2}\d{0,4}$/.test(t)) continue;
    out.push(t);
  }
  const name = out.join(" ").trim();
  return name.length >= 2 ? name : null;
}

/**
 * Identity-bearing website domain ("https://app.Ledgerline.io/x" → "ledgerline.io"). Shared with entity
 * resolution (engine/web-domain.ts): hosting platforms keep the full host, so two companies on
 * *.notion.site never "share a website"; profiles and link hubs (LinkedIn, Linktree…) are not websites.
 */
export const registrableDomain = websiteDomain;

/** Order- and accent-insensitive key of a person's name ("Dr. Jane  Doe" ≡ "doe jane"). */
export function personKey(name: string): string {
  return fold(name)
    .replace(/\b(dr|mr|mrs|ms|mme|m|prof|phd|mba|jr|sr)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(" ");
}

function founderOverlap(a: string[], b: string[]): { signal: Signal; common: string[] } {
  const ka = new Map(a.map((n) => [personKey(n), n] as const).filter(([k]) => k));
  const kb = new Set(b.map(personKey).filter(Boolean));
  if (!ka.size || !kb.size) return { signal: "UNKNOWN", common: [] };
  const common = [...ka.entries()].filter(([k]) => kb.has(k)).map(([, n]) => n);
  return { signal: common.length ? "SAME" : "DIFFERENT", common };
}

function nameSignal(probe: CompanyProbe, cand: CompanyCandidate): Signal | "PREFIX" {
  if (!probe.name) return "UNKNOWN";
  const pk = companyNameKey(probe.name);
  const ck = companyNameKey(cand.name);
  if (!pk || !ck) return "UNKNOWN";
  if (pk === ck) return "SAME";
  if (probe.nameSource === "FILENAME" && ck.length >= 4) {
    // The file name starts with the company's name ("acme robotics q3" vs "Acme Robotics"), token-aligned.
    const pt = nameTokens(probe.name);
    const ct = nameTokens(cand.name);
    if (ct.length && ct.length <= pt.length && ct.every((t, i) => pt[i] === t)) return "PREFIX";
  }
  return "DIFFERENT";
}

/** Pure matcher. Returns only candidates with at least one positive signal, strongest first. */
export function matchCompanies(probe: CompanyProbe, candidates: CompanyCandidate[]): CompanyMatch[] {
  const pDomain = registrableDomain(probe.website);
  const out: (CompanyMatch & { rank: number })[] = [];
  for (const c of candidates) {
    const cDomain = registrableDomain(c.website ?? null) ?? c.domain ?? null;
    const name = nameSignal(probe, c);
    const domain: Signal = pDomain && cDomain ? (pDomain === cDomain ? "SAME" : "DIFFERENT") : "UNKNOWN";
    const f = founderOverlap(probe.founders, c.founders);
    const nameHit = name === "SAME" || name === "PREFIX";
    const reasons: string[] = [];
    if (name === "SAME") reasons.push(`same name (${c.name})`);
    if (name === "PREFIX") reasons.push(`file name starts with “${c.name}”`);
    if (domain === "SAME") reasons.push(`same website (${cDomain})`);
    if (domain === "DIFFERENT" && (nameHit || f.signal === "SAME")) reasons.push(`different website (${pDomain} vs ${cDomain})`);
    if (f.signal === "SAME") reasons.push(`founder${f.common.length > 1 ? "s" : ""} in common: ${f.common.join(", ")}`);
    if (f.signal === "DIFFERENT" && (nameHit || domain === "SAME")) reasons.push("no founder in common");

    let verdict: MatchVerdict | null = null;
    if (domain === "SAME") verdict = f.signal === "DIFFERENT" ? "POSSIBLE" : "SAME_LIKELY";
    else if (nameHit) {
      if (f.signal === "SAME") verdict = name === "SAME" ? "SAME_LIKELY" : "POSSIBLE";
      else if (f.signal === "DIFFERENT" || domain === "DIFFERENT") verdict = "DIFFERENT_LIKELY";
      else verdict = "POSSIBLE";
    } else if (f.common.length >= 2) verdict = "POSSIBLE";
    if (!verdict) continue;
    if (verdict === "DIFFERENT_LIKELY") reasons.push("likely a homonym — a different company");
    const rank = (verdict === "SAME_LIKELY" ? 30 : verdict === "POSSIBLE" ? 20 : 10) + (domain === "SAME" ? 3 : 0) + f.common.length + (name === "SAME" ? 1 : 0);
    out.push({ companyId: c.id, name: c.name, verdict, signals: { name, domain, founders: f.signal, foundersInCommon: f.common }, reasons, rank });
  }
  return out.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name) || a.companyId.localeCompare(b.companyId)).map(({ rank: _rank, ...m }) => m);
}
