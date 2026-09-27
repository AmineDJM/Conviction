/**
 * 11. SOURCE RELIABILITY for web sources — deterministic URL / title rules.
 *
 * Tiers: PRIMARY_RECORD (registries, filings, patents, papers, code, .gov/.edu),
 * SECONDARY (press, analysts, other), SELF_AUTHORED_PROFILE (LinkedIn, X,
 * Crunchbase … can be written by the company), COMPANY_DERIVED (press-release
 * wires, the company's own domain), COMMERCIAL_ESTIMATE (market-research
 * resellers: low-precision estimates, not fake), LOW_QUALITY (SEO listicles,
 * affiliate review farms), UNKNOWN (unparseable URL).
 * Flags: STALE (> 18 months before the analysis date), UNKNOWN_DATE,
 * CITATION_UNVERIFIED, PRESS_WIRE, SEO_CONTENT, COMMERCIAL_ESTIMATE,
 * SELF_AUTHORED, DUPLICATE_STORY. Near-duplicate titles / findings across
 * different domains form one story cluster (Jaccard ≥ 0.6).
 */
import type { Claim, Source } from "@/domain/canonical";
import type { IntegrityContext } from "./context";
import type { IntegrityFinding, SourceReliability, SourceTier } from "./types";
import { finding, jaccard, monthsBetween, round, shingles, str, UnionFind, words } from "./util";

export const STALE_SOURCE_MONTHS = 18;
export const STORY_JACCARD = 0.6;

const PRIMARY_DOMAINS = [
  "sec.gov",
  "companieshouse.gov.uk",
  "find-and-update.company-information.service.gov.uk",
  "uspto.gov",
  "patents.google.com",
  "arxiv.org",
  "github.com",
  "gitlab.com",
  "doi.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "clinicaltrials.gov",
  "fda.gov",
  "epo.org",
  "worldwide.espacenet.com",
  "wipo.int",
  "europa.eu",
  "infogreffe.fr",
  "bodacc.fr",
  "annuaire-entreprises.data.gouv.fr",
  "handelsregister.de",
  "opencorporates.com",
  "nature.com",
  "science.org",
  "ieee.org",
  "acm.org",
  "biorxiv.org",
  "medrxiv.org",
  "pypi.org",
  "npmjs.com",
];
const WIRE_DOMAINS = ["prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "einpresswire.com", "prweb.com", "newswire.ca", "newswire.com", "openpr.com", "prlog.org", "presswire.com", "24-7pressrelease.com", "issuewire.com"];
const COMMERCIAL_ESTIMATE_DOMAINS = [
  "marketsandmarkets.com",
  "grandviewresearch.com",
  "mordorintelligence.com",
  "fortunebusinessinsights.com",
  "alliedmarketresearch.com",
  "precedenceresearch.com",
  "researchandmarkets.com",
  "imarcgroup.com",
  "expertmarketresearch.com",
  "verifiedmarketresearch.com",
  "technavio.com",
  "polarismarketresearch.com",
  "databridgemarketresearch.com",
  "futuremarketinsights.com",
  "marketresearchfuture.com",
  "straitsresearch.com",
  "gminsights.com",
  "globalmarketinsights.com",
  "reportlinker.com",
  "transparencymarketresearch.com",
  "coherentmarketinsights.com",
  "skyquestt.com",
  "zionmarketresearch.com",
  "marketresearch.com",
  "businessresearchinsights.com",
  "thebusinessresearchcompany.com",
  "sphericalinsights.com",
  "custommarketinsights.com",
];
const SOCIAL_DOMAINS = ["linkedin.com", "x.com", "twitter.com", "crunchbase.com", "facebook.com", "instagram.com", "medium.com", "substack.com", "youtube.com", "tiktok.com", "wellfound.com", "angel.co", "producthunt.com", "f6s.com", "reddit.com", "quora.com"];
const REVIEW_AGGREGATOR_DOMAINS = ["g2.com", "capterra.com", "getapp.com", "softwareadvice.com", "trustradius.com", "financesonline.com", "saasworthy.com", "sourceforge.net", "slashdot.org", "crozdesk.com"];
const SEO_DOMAIN_TOKEN_RE = /^(best|top\d*|reviews?|compare|comparisons?|alternatives?|versus|ranked|rankings?)$/;
const SEO_TITLE_RE = /\b(top|best)\s+\d{1,3}\b|\b\d{1,3}\s+best\b|\bbest\s+[\w\s-]{0,40}\b(tools?|software|apps?|platforms?|alternatives|solutions)\b|\balternatives\s+to\b|\b(review|reviews)\b.*\b20\d\d\b|\bultimate guide\b/i;

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h || null;
  } catch {
    const m = /^(?:[a-z]+:\/\/)?(?:www\.)?([^/\s?#:]+)/i.exec(url.trim());
    return m ? m[1]!.toLowerCase() : null;
  }
}

const matchesDomain = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

export function classifySource(s: Pick<Source, "url" | "title" | "origin" | "independenceGroup">, companyDomain: string | null): { tier: SourceTier; flags: string[] } {
  const flags: string[] = [];
  const host = domainOf(s.url);
  if (!host) return { tier: "UNKNOWN", flags: [s.url ? "UNPARSEABLE_URL" : "NO_URL"] };
  if (companyDomain && (host === companyDomain || host.endsWith(`.${companyDomain}`))) return { tier: "COMPANY_DERIVED", flags: ["COMPANY_DOMAIN"] };
  if (matchesDomain(host, WIRE_DOMAINS)) return { tier: "COMPANY_DERIVED", flags: ["PRESS_WIRE"] };
  if (matchesDomain(host, COMMERCIAL_ESTIMATE_DOMAINS)) return { tier: "COMMERCIAL_ESTIMATE", flags: ["COMMERCIAL_ESTIMATE"] };
  if (matchesDomain(host, SOCIAL_DOMAINS)) return { tier: "SELF_AUTHORED_PROFILE", flags: ["SELF_AUTHORED"] };
  if (matchesDomain(host, PRIMARY_DOMAINS) || /\.(gov|mil|edu)$/.test(host) || /\.(gov|ac|edu)\.[a-z]{2}$/.test(host) || /\.gouv\.fr$/.test(host)) return { tier: "PRIMARY_RECORD", flags };
  if (matchesDomain(host, REVIEW_AGGREGATOR_DOMAINS)) return { tier: "LOW_QUALITY", flags: ["REVIEW_AGGREGATOR"] };
  const labelTokens = host.split(".").slice(0, -1).join(".").split(/[.-]/);
  if (SEO_TITLE_RE.test(str(s.title)) || labelTokens.some((t) => SEO_DOMAIN_TOKEN_RE.test(t))) return { tier: "LOW_QUALITY", flags: ["SEO_CONTENT"] };
  if (s.independenceGroup === "COMPANY") return { tier: "COMPANY_DERIVED", flags: ["COMPANY_ORIGIN_GROUP"] };
  return { tier: "SECONDARY", flags };
}

const WEAK_TIERS = new Set<SourceTier>(["COMPANY_DERIVED", "SELF_AUTHORED_PROFILE", "LOW_QUALITY", "UNKNOWN"]);

export function sourceReliability(ctx: IntegrityContext): { sources: SourceReliability[]; findings: IntegrityFinding[] } {
  const companyDomain = domainOf(ctx.deal.identity?.website ?? null);
  const web = ctx.sources.filter((s) => s.kind === "WEB");
  const out: SourceReliability[] = web.map((s) => {
    const { tier, flags } = classifySource(s, companyDomain);
    let ageMonths: number | null = null;
    const pub = s.publishedDate ? new Date(s.publishedDate) : null;
    if (!pub || Number.isNaN(pub.getTime())) flags.push("UNKNOWN_DATE");
    else if (ctx.asOf) {
      ageMonths = round(monthsBetween(pub, ctx.asOf), 1);
      if (ageMonths > STALE_SOURCE_MONTHS) flags.push("STALE");
    }
    if (!s.citationVerified) flags.push("CITATION_UNVERIFIED");
    return { sourceId: s.id, url: s.url, domain: domainOf(s.url), tier, flags, cluster: null, ageMonths };
  });

  // Story clusters: near-duplicate titles or findings across different domains.
  const excerptsBySource = new Map<string, string[]>();
  for (const c of ctx.claims) for (const e of c.evidence) excerptsBySource.set(e.sourceId, [...(excerptsBySource.get(e.sourceId) ?? []), e.excerpt]);
  const sig = web.map((s) => ({ title: shingles(str(s.title)), text: shingles((excerptsBySource.get(s.id) ?? []).join(" ")), titleWords: words(str(s.title)).length }));
  const uf = new UnionFind(web.length);
  for (let i = 0; i < web.length; i++)
    for (let j = i + 1; j < web.length; j++) {
      if (out[i]!.domain && out[i]!.domain === out[j]!.domain) continue;
      const t = sig[i]!.titleWords >= 3 && sig[j]!.titleWords >= 3 ? jaccard(sig[i]!.title, sig[j]!.title) : 0;
      const x = sig[i]!.text.size >= 3 && sig[j]!.text.size >= 3 ? jaccard(sig[i]!.text, sig[j]!.text) : 0;
      if (t >= STORY_JACCARD || x >= STORY_JACCARD) uf.union(i, j);
    }
  const members = new Map<number, number[]>();
  for (let i = 0; i < web.length; i++) members.set(uf.find(i), [...(members.get(uf.find(i)) ?? []), i]);
  let n = 0;
  for (const [, idx] of [...members.entries()].sort((a, b) => a[0] - b[0])) {
    if (idx.length < 2) continue;
    n++;
    for (const i of idx) {
      out[i]!.cluster = `STORY-${n}`;
      out[i]!.flags.push("DUPLICATE_STORY");
    }
  }

  const byId = new Map(out.map((r) => [r.sourceId, r] as const));
  const findings: IntegrityFinding[] = [];
  const confirming = (c: Claim) => c.evidence.filter((e) => e.effect === "CONFIRMS" || e.effect === "PARTIALLY_CONFIRMS").map((e) => byId.get(e.sourceId)).filter((r): r is SourceReliability => !!r);

  for (const c of ctx.claims.filter((x) => x.material)) {
    const conf = confirming(c);
    if (!conf.length) continue;
    const weak = (r: SourceReliability) => WEAK_TIERS.has(r.tier) || r.flags.includes("STALE") || r.flags.includes("CITATION_UNVERIFIED");
    if ((c.verification === "VERIFIED" || c.verification === "PARTIALLY_VERIFIED") && conf.every(weak)) {
      const reasons = [...new Set(conf.flatMap((r) => [WEAK_TIERS.has(r.tier) ? r.tier.toLowerCase().replace(/_/g, " ") : null, r.flags.includes("STALE") ? "stale" : null, r.flags.includes("CITATION_UNVERIFIED") ? "unverified citation" : null].filter(Boolean)))];
      findings.push(
        finding({
          kind: "VERIFICATION_RESTS_ON_WEAK_SOURCE",
          module: "SOURCES",
          severity: c.verification === "VERIFIED" ? "HIGH" : "MODERATE",
          title: `${c.verification === "VERIFIED" ? "Verified" : "Partially verified"} claim rests only on weak sources`,
          detail: `"${c.statement.slice(0, 140)}" is supported only by ${reasons.join(", ")} source(s): ${conf.map((r) => r.domain ?? r.sourceId).join(", ")}.`,
          claimIds: [c.id],
          sourceIds: conf.map((r) => r.sourceId),
          pages: ctx.claimPages(c),
        }),
      );
    }
    const clustered = conf.filter((r) => r.cluster);
    const byCluster = new Map<string, SourceReliability[]>();
    for (const r of clustered) byCluster.set(r.cluster!, [...(byCluster.get(r.cluster!) ?? []), r]);
    for (const [cl, rs] of byCluster) {
      const groups = new Set(rs.map((r) => ctx.sourceById.get(r.sourceId)?.independenceGroup));
      if (rs.length >= 2 && groups.size >= 2)
        findings.push(
          finding({
            kind: "DUPLICATED_PRESS",
            module: "SOURCES",
            severity: "MODERATE",
            title: `${rs.length} confirming sources repeat one story`,
            detail: `${rs.map((r) => r.domain).join(", ")} carry near-identical text (${cl}); they count as one confirmation, not ${rs.length}.`,
            claimIds: [c.id],
            sourceIds: rs.map((r) => r.sourceId),
            key: cl,
          }),
        );
    }
    if (c.category === "MARKET" && conf.every((r) => r.tier === "COMMERCIAL_ESTIMATE"))
      findings.push(
        finding({
          kind: "COMMERCIAL_MARKET_ESTIMATE",
          module: "SOURCES",
          severity: "LOW",
          title: "Market size rests on commercial research estimates",
          detail: `Supported only by ${conf.map((r) => r.domain).join(", ")}: commercial estimates of low precision (not fake), typically top-down and not specific to the company's segment.`,
          claimIds: [c.id],
          sourceIds: conf.map((r) => r.sourceId),
        }),
      );
  }
  return { sources: out, findings };
}

/** Number of distinct story clusters (or independence groups) among strong confirming sources. */
export function effectiveIndependentConfirmations(c: Claim, rel: SourceReliability[], ctx: IntegrityContext): number {
  const byId = new Map(rel.map((r) => [r.sourceId, r] as const));
  const keys = new Set<string>();
  for (const e of c.evidence) {
    if (e.effect !== "CONFIRMS" && e.effect !== "PARTIALLY_CONFIRMS") continue;
    const s = ctx.sourceById.get(e.sourceId);
    const r = byId.get(e.sourceId);
    if (!s || !r || s.origin === "COMPANY" || !s.citationVerified || WEAK_TIERS.has(r.tier) || r.flags.includes("STALE")) continue;
    keys.add(r.cluster ?? s.independenceGroup);
  }
  return keys.size;
}
