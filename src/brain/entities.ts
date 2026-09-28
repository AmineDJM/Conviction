/**
 * ENTITY RESOLUTION for the Fund Brain graph — pure functions, no I/O.
 *
 * Three problems, one rule: link only on strong evidence, keep ambiguity visible.
 *
 * (a) People. A person is keyed by normalized name + the company they appear in
 *     (`person:<name>:<companyId>`). Two companies' "David Chen" become one entity
 *     only on strong evidence: the same public profile URL, or ≥ 2 shared
 *     distinctive prior employers with no conflicting profile. Everything else
 *     stays separate (a homonym is reported, never merged).
 * (b) Renamed companies. A deal company is keyed by its company id
 *     (`company:<companyId>`); former names come from explicit statements
 *     ("formerly X", "previously known as X", "f/k/a X", "X, now Acme"…) about
 *     the company itself. Two deal companies are linked as ALIAS_OF on an explicit
 *     rename statement, the same website domain, or the same founding team (≥ 2
 *     founders, identical sets); a partial founder overlap is POSSIBLY_SAME_AS
 *     (shown, never used to resolve a mention). One shared founder is a serial
 *     founder, not a rename.
 * (c) Employers. Prior employers are normalized through a small versioned alias
 *     table (Google/Alphabet, Meta/Facebook…). A short name that maps to several
 *     organizations (Mercury the bank vs Mercury Systems) is disambiguated only by
 *     explicit context (full legal name, a parenthetical, a sector word next to
 *     the name); otherwise it is AMBIGUOUS — never guessed.
 */
import { normName } from "@/server/ids";
import { websiteDomain } from "@/engine/web-domain";

export const ENTITY_RESOLUTION_VERSION = "entity_resolution_v1";
export const ORG_ALIAS_TABLE_VERSION = "org_aliases_v1";

/* ------------------------------------------------------------------ */
/* Normalization                                                        */
/* ------------------------------------------------------------------ */

const HONORIFICS = /\b(dr|mr|mrs|ms|prof|sir|phd|md|mba|jr|sr|ii|iii)\b\.?/g;

/** "Dr. David J. Chen" → "davidchen": accents, honorifics and middle initials removed. */
export function normPersonName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(HONORIFICS, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.replace(/[^a-z0-9]/g, "").length > 1)
    .join("");
  return base.replace(/[^a-z0-9]/g, "");
}

/**
 * Canonical form of a public profile URL (LinkedIn, GitHub, X/Twitter, Google
 * Scholar, ORCID, Crunchbase person, personal sites). Returns null for URLs that
 * do not identify a person (company pages, search pages).
 */
export function normProfileUrl(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  let u: URL;
  try {
    u = new URL(url.includes("://") ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "").replace(/^[a-z]{2}\.linkedin\.com$/, "linkedin.com");
  const parts = u.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p).toLowerCase());
  if (host === "linkedin.com") return parts[0] === "in" && parts[1] ? `linkedin.com/in/${parts[1]}` : null;
  if (host === "github.com") return parts[0] && !["orgs", "topics", "search", "features"].includes(parts[0]) ? `github.com/${parts[0]}` : null;
  if (host === "twitter.com" || host === "x.com") return parts[0] && !["i", "search", "home", "intent"].includes(parts[0]) ? `x.com/${parts[0].replace(/^@/, "")}` : null;
  if (host === "scholar.google.com") {
    const user = u.searchParams.get("user");
    return user ? `scholar.google.com/${user.toLowerCase()}` : null;
  }
  if (host === "orcid.org") return parts[0] ? `orcid.org/${parts[0]}` : null;
  if (host === "crunchbase.com") return parts[0] === "person" && parts[1] ? `crunchbase.com/person/${parts[1]}` : null;
  if (host === "angel.co" || host === "wellfound.com") return parts[0] === "u" && parts[1] ? `wellfound.com/u/${parts[1]}` : null;
  // Personal site: host + path (a company homepage is not a person's profile, but a founder's own site is).
  return `${host}${parts.length ? `/${parts.join("/")}` : ""}`;
}

const profilePlatform = (p: string) => p.split("/")[0]!;

/** Light organization-name normalization: legal suffixes removed, meaningful words ("systems", "technologies") kept. */
export function normOrgText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(inc|ltd|llc|gmbh|sas|sarl|plc|corp|corporation|co|company|limited|s\.a|ag|bv|nv)\b\.?/g, " ")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Organizations (employers): versioned alias table + ambiguity table   */
/* ------------------------------------------------------------------ */

interface OrgAlias {
  key: string;
  canonical: string;
  aliases: string[];
}

/** org_aliases_v1 — same organization under different names. Keep small and uncontroversial. */
export const ORG_ALIASES: readonly OrgAlias[] = [
  { key: "google", canonical: "Google", aliases: ["google", "alphabet", "google llc", "google inc", "alphabet inc", "google brain", "google research", "google cloud", "gcp"] },
  { key: "meta", canonical: "Meta", aliases: ["meta", "facebook", "meta platforms", "facebook inc", "fb", "meta ai", "facebook ai research", "fair"] },
  { key: "amazon", canonical: "Amazon", aliases: ["amazon", "amazon.com", "amazon web services", "aws"] },
  { key: "microsoft", canonical: "Microsoft", aliases: ["microsoft", "msft", "microsoft research", "microsoft corporation"] },
  { key: "apple", canonical: "Apple", aliases: ["apple", "apple inc", "apple computer"] },
  { key: "ibm", canonical: "IBM", aliases: ["ibm", "international business machines", "ibm research"] },
  { key: "x-corp", canonical: "Twitter / X", aliases: ["twitter", "x corp", "twitter inc", "x (twitter)", "twitter (x)"] },
  { key: "block", canonical: "Block (Square)", aliases: ["block", "block inc", "square inc", "square (block)", "cash app"] },
  { key: "mckinsey", canonical: "McKinsey & Company", aliases: ["mckinsey", "mckinsey and company", "mckinsey and"] },
  { key: "bcg", canonical: "Boston Consulting Group", aliases: ["bcg", "boston consulting group", "the boston consulting group"] },
  { key: "bain", canonical: "Bain & Company", aliases: ["bain", "bain and company"] },
  { key: "goldman-sachs", canonical: "Goldman Sachs", aliases: ["goldman sachs", "goldman", "goldman sachs group"] },
  { key: "jpmorgan", canonical: "JPMorgan Chase", aliases: ["jpmorgan", "jp morgan", "j.p. morgan", "j.p morgan", "jpmorgan chase", "jpmorgan chase and", "chase"] },
  { key: "salesforce", canonical: "Salesforce", aliases: ["salesforce", "salesforce.com"] },
  { key: "stripe", canonical: "Stripe", aliases: ["stripe"] },
  { key: "openai", canonical: "OpenAI", aliases: ["openai", "open ai"] },
  { key: "deepmind", canonical: "Google DeepMind", aliases: ["deepmind", "google deepmind"] },
];

interface AmbiguousCandidate {
  key: string;
  canonical: string;
  /** Full names that identify this organization on their own. */
  fullNames: string[];
  /** Context words that, next to the short name, identify this organization. */
  context: RegExp[];
}

/** Short names shared by distinct organizations. Resolved only by explicit context. */
export const AMBIGUOUS_ORGS: Readonly<Record<string, readonly AmbiguousCandidate[]>> = {
  mercury: [
    { key: "mercury-banking", canonical: "Mercury (banking)", fullNames: ["mercury technologies", "mercury.com", "mercury bank"], context: [/\bbank(ing)?\b/i, /\bneobank\b/i, /\bfintech\b/i, /\bmercury\.com\b/i] },
    { key: "mercury-systems", canonical: "Mercury Systems", fullNames: ["mercury systems", "mercury computer systems"], context: [/\bdefen[cs]e\b/i, /\baerospace\b/i, /\bmrcy\b/i, /\bembedded\b/i] },
    { key: "mercury-insurance", canonical: "Mercury Insurance", fullNames: ["mercury insurance", "mercury general"], context: [/\binsurance\b/i, /\binsurer\b/i] },
  ],
  square: [
    { key: "block", canonical: "Block (Square)", fullNames: ["square inc", "block inc", "square (block)"], context: [/\bpayments?\b/i, /\bfintech\b/i, /\bcash app\b/i, /\bpoint[- ]of[- ]sale\b/i, /\bmerchants?\b/i, /\bseller\b/i] },
    { key: "square-enix", canonical: "Square Enix", fullNames: ["square enix"], context: [/\bgam(e|es|ing)\b/i, /\bvideo ?games?\b/i, /\benix\b/i] },
  ],
  delta: [
    { key: "delta-air-lines", canonical: "Delta Air Lines", fullNames: ["delta air lines", "delta airlines"], context: [/\bairlines?\b/i, /\baviation\b/i, /\bflights?\b/i] },
    { key: "delta-dental", canonical: "Delta Dental", fullNames: ["delta dental"], context: [/\bdental\b/i] },
  ],
  apollo: [
    { key: "apollo-global", canonical: "Apollo Global Management", fullNames: ["apollo global management", "apollo global"], context: [/\bprivate equity\b/i, /\basset management\b/i, /\bcredit\b/i, /\binvestment\b/i] },
    { key: "apollo-io", canonical: "Apollo.io", fullNames: ["apollo.io"], context: [/\bsales intelligence\b/i, /\bprospecting\b/i, /\blead gen/i] },
    { key: "apollo-graphql", canonical: "Apollo GraphQL", fullNames: ["apollo graphql"], context: [/\bgraphql\b/i] },
  ],
};

/** Employers so common that sharing them says little about identity. */
const MEGA_EMPLOYERS = new Set(["google", "meta", "amazon", "microsoft", "apple", "ibm", "mckinsey", "bcg", "bain", "goldman-sachs", "jpmorgan", "salesforce"]);

export interface OrgResolution {
  status: "RESOLVED" | "AMBIGUOUS" | "UNALIASED";
  /** Stable graph key, e.g. org:google, org:mercury-systems, org:ambiguous:mercury, org:acme-robotics. */
  key: string;
  /** Display name. */
  name: string;
  raw: string;
  /** Candidate organizations when AMBIGUOUS (or the one chosen, with how). */
  candidates: string[];
  evidence: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const PLACEHOLDER_ORG = /\b(unnamed|undisclosed|unspecified|not specified|not disclosed|confidential|stealth|anonymous|unknown|various|several|multiple|n\/a|none|self[- ]employed|freelance)\b/i;
/** A lowercase article opens a description ("a Fortune 500 bank"); a name keeps its capital ("The Trade Desk"). */
const DESCRIPTION = /^(a|an|one of)\s/;

/** "Unnamed 1,400-person distributor", "Not specified", "a Fortune 500 bank": descriptions, not organizations — never an entity. */
export function isPlaceholderOrg(raw: string): boolean {
  const { name } = cleanOrgMention(raw);
  return !name || name.length < 2 || PLACEHOLDER_ORG.test(name) || DESCRIPTION.test(name);
}

/** Strip "ex-", "former", "(acquired by …)" and role prefixes from an employer mention. */
export function cleanOrgMention(raw: string): { name: string; qualifier: string } {
  let s = raw.trim();
  let qualifier = "";
  const paren = /\(([^)]*)\)\s*$/.exec(s);
  if (paren) {
    qualifier = paren[1]!;
    s = s.slice(0, paren.index).trim();
  }
  s = s.replace(/^(ex[-\s]|former(ly)?\s+(at\s+)?|previously\s+(at\s+)?)/i, "").trim();
  s = s.replace(/[,;].*$/, "").trim();
  return { name: s, qualifier };
}

/**
 * Resolve an employer mention. `context` is text about that specific employment
 * (the founder's timeline role, the background sentence that mentions it) — never
 * the deal's own sector, which says nothing about where a founder used to work.
 */
export function resolveOrg(raw: string, context = ""): OrgResolution {
  const { name, qualifier } = cleanOrgMention(raw);
  const n = normOrgText(name);
  const full = normOrgText(`${name} ${qualifier}`);
  if (!n) return { status: "UNALIASED", key: `org:${slug(raw) || "unknown"}`, name: raw.trim(), raw, candidates: [], evidence: "unparseable name" };

  // 1. Full names of ambiguous organizations identify them on their own.
  for (const cands of Object.values(AMBIGUOUS_ORGS))
    for (const c of cands) if (c.fullNames.some((f) => n === normOrgText(f) || full === normOrgText(f))) return { status: "RESOLVED", key: `org:${c.key}`, name: c.canonical, raw, candidates: [c.canonical], evidence: `full name "${name}"` };

  // 2. Ambiguous short names: explicit context only.
  const amb = AMBIGUOUS_ORGS[n];
  if (amb) {
    const text = `${qualifier} ${context}`;
    const hits = amb.filter((c) => c.context.some((re) => re.test(text)));
    if (hits.length === 1) {
      const c = hits[0]!;
      const word = c.context.map((re) => re.exec(text)?.[0]).find(Boolean);
      return { status: "RESOLVED", key: `org:${c.key}`, name: c.canonical, raw, candidates: amb.map((x) => x.canonical), evidence: `context "${word}"` };
    }
    return {
      status: "AMBIGUOUS",
      key: `org:ambiguous:${n.replace(/[^a-z0-9]+/g, "-")}`,
      name: `${name} (ambiguous)`,
      raw,
      candidates: amb.map((x) => x.canonical),
      evidence: hits.length ? `context matches several organizations (${hits.map((h) => h.canonical).join(", ")})` : "no disambiguating context",
    };
  }

  // 3. Alias table.
  for (const a of ORG_ALIASES) if (a.aliases.some((x) => normOrgText(x) === n)) return { status: "RESOLVED", key: `org:${a.key}`, name: a.canonical, raw, candidates: [a.canonical], evidence: `alias table ${ORG_ALIAS_TABLE_VERSION}` };

  return { status: "UNALIASED", key: `org:${slug(n)}`, name, raw, candidates: [], evidence: "not in alias table" };
}

/** The sentence(s) of a free-text background that mention an organization (context for `resolveOrg`). */
export function contextFor(org: string, texts: string[]): string {
  const { name } = cleanOrgMention(org);
  if (!name) return "";
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return texts
    .flatMap((t) => t.split(/(?<=[.;!?])\s+|\n+/))
    .filter((s) => re.test(s))
    .join(" ")
    .slice(0, 600);
}

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */

export interface PersonEvidence {
  profileUrls: string[];
  /** Resolved (non-ambiguous) employer keys. */
  employers: string[];
}

export interface PersonCandidate extends PersonEvidence {
  name: string;
  companyId: string;
}

/** A stored person entity; evidence is kept per contributing company so a re-index can withdraw it. */
export interface PersonEntityView {
  id: string;
  key: string;
  normName: string;
  byCompany: Record<string, PersonEvidence>;
}

export interface PersonResolution {
  /** Existing entity to reuse, or null to create one with `key`. */
  entityId: string | null;
  key: string;
  reason: string;
  /** Same-name entities kept separate (homonyms), by id. */
  homonyms: string[];
}

export const personKey = (name: string, companyId: string) => `person:${normPersonName(name)}:${companyId}`;

/** Compare two people with the same normalized name. */
export function samePerson(a: PersonEvidence, b: PersonEvidence): { same: boolean; reason: string } {
  const pa = new Set(a.profileUrls.map(normProfileUrl).filter((x): x is string => !!x));
  const pb = new Set(b.profileUrls.map(normProfileUrl).filter((x): x is string => !!x));
  const shared = [...pa].filter((x) => pb.has(x));
  if (shared.length) return { same: true, reason: `same public profile ${shared[0]}` };
  // Different profiles on the same platform: two different people.
  const platA = new Set([...pa].map(profilePlatform));
  const conflict = [...pb].some((p) => platA.has(profilePlatform(p)));
  if (conflict) return { same: false, reason: "different public profiles on the same platform" };
  const ea = new Set(a.employers);
  const sharedEmployers = [...new Set(b.employers)].filter((x) => ea.has(x));
  const distinctive = sharedEmployers.filter((k) => !MEGA_EMPLOYERS.has(k.replace(/^org:/, "")));
  if (sharedEmployers.length >= 2 && distinctive.length >= 1) return { same: true, reason: `same prior employers (${sharedEmployers.map((k) => k.replace(/^org:/, "")).join(", ")})` };
  return { same: false, reason: sharedEmployers.length ? "only common employers shared — not enough to merge" : "no shared distinctive attribute" };
}

/**
 * Which person entity does this founder resolve to? Strong evidence against
 * another company's contribution merges; otherwise the company-scoped key.
 * Deterministic: ties go to the smallest key.
 */
export function resolvePerson(c: PersonCandidate, existing: PersonEntityView[]): PersonResolution {
  const norm = normPersonName(c.name);
  const own = personKey(c.name, c.companyId);
  const sameName = existing.filter((e) => e.normName === norm).sort((a, b) => a.key.localeCompare(b.key));
  const matches: { e: PersonEntityView; reason: string }[] = [];
  const homonyms: string[] = [];
  for (const e of sameName) {
    const others = Object.entries(e.byCompany).filter(([cid]) => cid !== c.companyId);
    if (!others.length) continue;
    const verdicts = others.map(([, ev]) => samePerson(c, ev));
    // Every other company's person must be compatible; one strong link is required.
    const strong = verdicts.find((v) => v.same);
    const conflict = verdicts.some((v) => !v.same && v.reason.startsWith("different public profiles"));
    if (strong && !conflict) matches.push({ e, reason: strong.reason });
    else homonyms.push(e.id);
  }
  if (matches.length) return { entityId: matches[0]!.e.id, key: matches[0]!.e.key, reason: matches[0]!.reason, homonyms };
  const mine = sameName.find((e) => e.key === own);
  return { entityId: mine?.id ?? null, key: own, reason: homonyms.length ? "homonym kept separate (no shared profile or distinctive employers)" : "company-scoped", homonyms };
}

/* ------------------------------------------------------------------ */
/* Companies: former names, domains, links                               */
/* ------------------------------------------------------------------ */

/** A proper name: up to four capitalized tokens on one line. */
const TOKEN = String.raw`[A-Z0-9](?:[\w&'’+-]|\.(?=\w))*`; // a dot only inside a token ("Apollo.io"), never a sentence end
const NAME = String.raw`["“'‘]?(${TOKEN}(?:[ \t]+(?:${TOKEN}|&|and|of|de)){0,3})["”'’]?`;
const GENERIC = new Set(["the", "we", "it", "company", "startup", "stealth", "stealth mode", "a", "an", "our", "us", "they", "this", "that"]);
/** Sentence openers that the "X, now Acme" pattern would otherwise take for a name. */
const STOP_FIRST = new Set(["in", "on", "at", "by", "for", "with", "and", "but", "as", "since", "today", "now", "then", "also", "later", "our", "we", "it", "this", "that", "from", "after", "before", "until", "when", "which", "who", "is", "was"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Case-insensitive literal without the `i` flag (so `[A-Z]` in NAME keeps meaning "capitalized"). */
const ci = (s: string) =>
  [...s]
    .map((ch) => {
      const lo = ch.toLowerCase();
      const up = ch.toUpperCase();
      return lo !== up ? `[${lo}${up}]` : ch === " " ? "\\s+" : esc(ch);
    })
    .join("");

export interface FormerName {
  name: string;
  evidence: string;
}

function cleanCaptured(s: string): string {
  const t = s
    .replace(/["“”'‘’]/g, "")
    .replace(/\s+(and|of|de|&)$/i, "")
    .replace(/[.,;:]+$/, "")
    .replace(/^the\s+/i, "")
    .trim();
  const first = t.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (STOP_FIRST.has(first) || /^\d+$/.test(t.replace(/\s+/g, ""))) return "";
  return t;
}

/**
 * Former names stated about the company itself. `texts` are the company's own
 * identity fields, claims about the company and document pages. A "formerly X"
 * must sit next to the company's current (or legal) name or a company pronoun,
 * so "our CTO, formerly VP at Stripe" or "Competitor Z, formerly Q" never count.
 */
export function detectFormerNames(currentName: string, legalName: string | null, texts: { text: string; where: string }[]): FormerName[] {
  const names = [currentName, legalName].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim());
  const cur = names.map((n) => ci(n.replace(/\s+(inc|ltd|llc|corp|sas|gmbh)\.?$/i, ""))).join("|");
  if (!cur) return [];
  // Keywords are matched case-insensitively letter by letter so the captured NAME still has to start with a capital.
  const k = (...ws: string[]) => `(?:${ws.map(ci).join("|")})`;
  const subject = `(?:${cur}|${k("we", "the company", "our company")})`;
  const known = String.raw`(?:\s+${k("known as", "called", "named")})`;
  const patterns: RegExp[] = [
    // Acme (formerly Widgetly) · Acme, f/k/a Widgetly · Acme — previously known as Widgetly
    new RegExp(String.raw`(?:${cur})(?:\s+${k("inc", "ltd", "llc", "corp", "sas", "gmbh")}\.?)?\s*[(,–—-]?\s*${k("formerly", "previously", "f/k/a", "fka", "née", "nee")}${known}?\s+${NAME}`, "g"),
    // Acme was formerly known as Widgetly · We were previously called Widgetly
    new RegExp(String.raw`${subject}\s+(?:${k("was", "were", "is", "has been")}\s+)?${k("formerly", "previously", "originally")}${known}\s+${NAME}`, "g"),
    // The company rebranded from Widgetly · Acme was renamed from Widgetly
    new RegExp(String.raw`${subject}\s+(?:${k("was", "were", "has")}\s+)?${k("rebranded", "renamed")}\s+(?:${k("itself")}\s+)?${k("from")}\s+${NAME}`, "g"),
    // Widgetly (now Acme) · Widgetly, now known as Acme · Widgetly rebranded as Acme · Widgetly was renamed to Acme
    new RegExp(String.raw`${NAME}\s*[(,]?\s*(?:${k("now")}${known}?|(?:${k("which")}\s+)?(?:${k("was")}\s+)?${k("rebranded", "renamed")}\s+(?:${k("itself")}\s+)?${k("as", "to")})\s+(?:${cur})\b`, "g"),
  ];
  const curNorm = new Set(names.map((n) => normName(n)));
  const out = new Map<string, FormerName>();
  for (const { text, where } of texts) {
    if (!text) continue;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const name = cleanCaptured(m[1] ?? "");
        const n = normName(name);
        if (!name || n.length < 2 || curNorm.has(n) || GENERIC.has(name.toLowerCase())) continue;
        if (!out.has(n)) {
          const start = Math.max(0, m.index - 30);
          out.set(n, { name, evidence: `“${text.slice(start, m.index + m[0].length + 10).replace(/\s+/g, " ").trim()}” (${where})` });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Identity-bearing website domain: shared with company duplicate detection (engine/company-match.ts).
export { websiteDomain } from "@/engine/web-domain";

export interface CompanyView {
  companyId: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  formerNames: FormerName[];
  /** Founders: resolved person entity key + normalized name. */
  founders: { key: string; norm: string }[];
}

export interface CompanyLink {
  otherId: string;
  type: "ALIAS_OF" | "POSSIBLY_SAME_AS";
  reasons: string[];
}

function teamOverlap(a: string[], b: string[]): { shared: number; identical: boolean } {
  const A = new Set(a);
  const B = new Set(b);
  const shared = [...B].filter((k) => A.has(k)).length;
  return { shared, identical: shared >= 2 && shared === A.size && shared === B.size };
}

/** Links between two deal companies of the same workspace (symmetric evidence, stated from `self`). */
export function linkCompanies(self: CompanyView, others: CompanyView[]): CompanyLink[] {
  const out: CompanyLink[] = [];
  const namesOf = (c: CompanyView) => new Set([c.name, c.legalName].filter((x): x is string => !!x).map((x) => normName(x)).filter((x) => x.length >= 2));
  const selfNames = namesOf(self);
  for (const o of [...others].sort((a, b) => a.companyId.localeCompare(b.companyId))) {
    if (o.companyId === self.companyId) continue;
    const strong: string[] = [];
    const weak: string[] = [];
    const oNames = namesOf(o);
    const selfFormer = self.formerNames.find((f) => oNames.has(normName(f.name)));
    if (selfFormer) strong.push(`${self.name} was formerly “${selfFormer.name}”: ${selfFormer.evidence}`);
    const otherFormer = o.formerNames.find((f) => selfNames.has(normName(f.name)));
    if (otherFormer) strong.push(`${o.name} was formerly “${otherFormer.name}”: ${otherFormer.evidence}`);
    if (self.domain && o.domain && self.domain === o.domain) strong.push(`same website domain ${self.domain}`);
    const team = teamOverlap(self.founders.map((f) => f.key), o.founders.map((f) => f.key));
    const names = teamOverlap(self.founders.map((f) => f.norm), o.founders.map((f) => f.norm));
    if (team.identical) strong.push(`same founding team (${team.shared} founders, same resolved identities)`);
    else if (team.shared >= 2) weak.push(`${team.shared} founders in common, teams not identical`);
    else if (names.shared >= 2) weak.push(`${names.shared} founders with the same names${names.identical ? " (identical teams)" : ""} — identities not confirmed (no shared profile)`);
    if (strong.length) out.push({ otherId: o.companyId, type: "ALIAS_OF", reasons: [...strong, ...weak] });
    else if (weak.length) out.push({ otherId: o.companyId, type: "POSSIBLY_SAME_AS", reasons: weak });
  }
  return out;
}
