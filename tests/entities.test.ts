/**
 * Entity resolution (src/brain/entities.ts) — pure rules, then the Fund Brain
 * graph written by indexer.writeGraph against a temporary SQLite database and
 * chat mention resolution (retrieval.resolveMentions) on top of it.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-entities-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  return dir;
});

import fs from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { newId } from "@/server/ids";
import { pruneOrphanEntities, writeGraph } from "@/brain/indexer";
import { catalog, companyAliases, resolveMentions } from "@/brain/retrieval";
import {
  detectFormerNames,
  isPlaceholderOrg,
  linkCompanies,
  normPersonName,
  normProfileUrl,
  resolveOrg,
  resolvePerson,
  samePerson,
  websiteDomain,
  type CompanyView,
  type PersonEntityView,
} from "@/brain/entities";
import type { CanonicalDeal, Founder } from "@/domain/canonical";
import { makeDeal } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Pure rules                                                           */
/* ------------------------------------------------------------------ */

describe("normalization", () => {
  it("normalizes person names (accents, honorifics, middle initials)", () => {
    expect(normPersonName("Dr. David J. Chen")).toBe("davidchen");
    expect(normPersonName("Émilie  Durand")).toBe("emiliedurand");
  });
  it("canonicalizes public profile URLs", () => {
    expect(normProfileUrl("https://www.linkedin.com/in/David-Chen-42/?trk=x")).toBe("linkedin.com/in/david-chen-42");
    expect(normProfileUrl("fr.linkedin.com/in/david-chen-42")).toBe("linkedin.com/in/david-chen-42");
    expect(normProfileUrl("https://twitter.com/dchen")).toBe("x.com/dchen");
    expect(normProfileUrl("https://x.com/dchen")).toBe("x.com/dchen");
    expect(normProfileUrl("https://github.com/dchen/repo")).toBe("github.com/dchen");
    expect(normProfileUrl("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normProfileUrl("")).toBeNull();
  });
  it("extracts identity-bearing website domains", () => {
    expect(websiteDomain("https://app.acme.io/login")).toBe("acme.io");
    expect(websiteDomain("acme.co.uk")).toBe("acme.co.uk");
    // Shared hosting: the whole host is the identity, not the platform.
    expect(websiteDomain("https://acme.notion.site")).toBe("acme.notion.site");
    expect(websiteDomain("https://widgetly.notion.site")).not.toBe(websiteDomain("https://acme.notion.site"));
    expect(websiteDomain("https://www.linkedin.com/company/acme")).toBeNull();
    expect(websiteDomain(null)).toBeNull();
  });
});

describe("employer normalization (org_aliases_v1)", () => {
  it.each([
    ["Google", "org:google"],
    ["Alphabet Inc.", "org:google"],
    ["ex-Google", "org:google"],
    ["Facebook", "org:meta"],
    ["Meta Platforms", "org:meta"],
    ["AWS", "org:amazon"],
    ["McKinsey & Company", "org:mckinsey"],
  ])("%s → %s", (raw, key) => {
    const r = resolveOrg(raw);
    expect(r.status).toBe("RESOLVED");
    expect(r.key).toBe(key);
  });

  it("keeps an ambiguous short name AMBIGUOUS without context — never guesses", () => {
    const r = resolveOrg("Mercury");
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.key).toBe("org:ambiguous:mercury");
    expect(r.candidates).toEqual(expect.arrayContaining(["Mercury (banking)", "Mercury Systems"]));
  });

  it("disambiguates only on explicit context", () => {
    expect(resolveOrg("Mercury Systems").key).toBe("org:mercury-systems");
    expect(resolveOrg("Mercury (banking)").key).toBe("org:mercury-banking");
    expect(resolveOrg("Mercury", "Embedded engineer on defense radar programs").key).toBe("org:mercury-systems");
    expect(resolveOrg("Mercury", "Head of risk at the startup bank Mercury").key).toBe("org:mercury-banking");
  });

  it("stays AMBIGUOUS when the context points to several organizations", () => {
    const r = resolveOrg("Mercury", "bank partnerships for defense contractors");
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.evidence).toMatch(/several/);
  });

  it.each(["Unnamed 1,400-person distributor", "Not specified", "Stealth startup", "a Fortune 500 bank", "Undisclosed fintech", "N/A"])("treats %s as a placeholder, never an organization", (raw) => {
    expect(isPlaceholderOrg(raw)).toBe(true);
  });
  it.each(["Google", "Acme Robotics", "The Trade Desk", "Mercury"])("keeps %s as an organization", (raw) => {
    expect(isPlaceholderOrg(raw)).toBe(false);
  });

  it("leaves unknown employers unaliased under their own key", () => {
    const r = resolveOrg("Acme Robotics");
    expect(r.status).toBe("UNALIASED");
    expect(r.key).toBe("org:acme-robotics");
  });
});

describe("person resolution", () => {
  const view = (id: string, companyId: string, profileUrls: string[], employers: string[] = []): PersonEntityView => ({ id, key: `person:davidchen:${companyId}`, normName: "davidchen", byCompany: { [companyId]: { profileUrls, employers } } });

  it("keeps homonyms in two companies separate", () => {
    const r = resolvePerson({ name: "David Chen", companyId: "B", profileUrls: ["linkedin.com/in/dchen-b"], employers: [] }, [view("e1", "A", ["linkedin.com/in/dchen-a"])]);
    expect(r.entityId).toBeNull();
    expect(r.key).toBe("person:davidchen:B");
    expect(r.homonyms).toEqual(["e1"]);
  });

  it("keeps same-name people without any distinctive attribute separate", () => {
    expect(resolvePerson({ name: "David Chen", companyId: "B", profileUrls: [], employers: [] }, [view("e1", "A", [])]).entityId).toBeNull();
  });

  it("merges the same person across companies on the same public profile", () => {
    const r = resolvePerson({ name: "David Chen", companyId: "B", profileUrls: ["https://www.linkedin.com/in/dchen-a/"], employers: [] }, [view("e1", "A", ["linkedin.com/in/dchen-a"])]);
    expect(r.entityId).toBe("e1");
    expect(r.reason).toMatch(/same public profile/);
  });

  it("merges on two shared distinctive employers, not on common ones only", () => {
    expect(samePerson({ profileUrls: [], employers: ["org:google", "org:acme-robotics"] }, { profileUrls: [], employers: ["org:google", "org:acme-robotics"] }).same).toBe(true);
    expect(samePerson({ profileUrls: [], employers: ["org:google", "org:meta"] }, { profileUrls: [], employers: ["org:google", "org:meta"] }).same).toBe(false);
  });

  it("never merges when profiles on the same platform differ, whatever the employers", () => {
    const v = samePerson({ profileUrls: ["linkedin.com/in/a"], employers: ["org:x", "org:y"] }, { profileUrls: ["linkedin.com/in/b"], employers: ["org:x", "org:y"] });
    expect(v.same).toBe(false);
  });
});

describe("former names", () => {
  const t = (text: string) => [{ text, where: "p. 1" }];
  it.each([
    ["Acme (formerly Widgetly) automates invoices.", "Widgetly"],
    ["Acme, f/k/a Widgetly, automates invoices.", "Widgetly"],
    ["We were previously known as Widgetly.", "Widgetly"],
    ["Acme was formerly called “Widgetly Labs”.", "Widgetly Labs"],
    ["The company rebranded from Widgetly in 2024.", "Widgetly"],
    ["Widgetly (now Acme) serves 90 customers.", "Widgetly"],
    ["Widgetly rebranded as Acme in March.", "Widgetly"],
  ])("%s", (text, name) => {
    expect(detectFormerNames("Acme", null, t(text)).map((f) => f.name)).toEqual([name]);
  });

  it.each([
    "Our CTO, formerly VP Engineering at Stripe, leads the platform.",
    "Competitor Zeta, formerly known as Quark, raised $20M.",
    "In 2024, now Acme serves 90 customers.",
    "The founder was previously called to the bar.",
  ])("ignores: %s", (text) => {
    expect(detectFormerNames("Acme", null, t(text))).toEqual([]);
  });

  it("records where the statement was found", () => {
    const [f] = detectFormerNames("Acme", null, [{ text: "Acme (formerly Widgetly)", where: "deck.pdf p. 2" }]);
    expect(f!.evidence).toContain("deck.pdf p. 2");
  });
});

describe("company links", () => {
  const co = (id: string, name: string, extra: Partial<CompanyView> = {}): CompanyView => ({ companyId: id, name, legalName: null, domain: null, formerNames: [], founders: [], ...extra });

  it("links an explicit rename, a shared domain and an identical founding team as ALIAS_OF", () => {
    expect(linkCompanies(co("B", "Acme", { formerNames: [{ name: "Widgetly", evidence: "x" }] }), [co("A", "Widgetly")])[0]).toMatchObject({ otherId: "A", type: "ALIAS_OF" });
    expect(linkCompanies(co("B", "Acme", { domain: "acme.io" }), [co("A", "Old", { domain: "acme.io" })])[0]!.reasons[0]).toMatch(/same website domain/);
    const team = [
      { key: "person:a:X", norm: "a" },
      { key: "person:b:X", norm: "b" },
    ];
    expect(linkCompanies(co("B", "Acme", { founders: team }), [co("A", "Old", { founders: team })])[0]!.type).toBe("ALIAS_OF");
  });

  it("marks same founder names without resolved identities only as POSSIBLY_SAME_AS", () => {
    const l = linkCompanies(co("B", "Acme", { founders: [{ key: "person:a:B", norm: "a" }, { key: "person:b:B", norm: "b" }] }), [co("A", "Old", { founders: [{ key: "person:a:A", norm: "a" }, { key: "person:b:A", norm: "b" }] })]);
    expect(l).toHaveLength(1);
    expect(l[0]!.type).toBe("POSSIBLY_SAME_AS");
  });

  it("does not link a serial founder's two companies", () => {
    const f = [{ key: "person:a:X", norm: "a" }];
    expect(linkCompanies(co("B", "Acme", { founders: f }), [co("A", "Old", { founders: f })])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Graph + mention resolution (temporary database)                      */
/* ------------------------------------------------------------------ */

function founder(name: string, extra: Partial<Founder> = {}): Founder {
  return {
    id: `FDR-${name}`,
    name,
    role: "CEO",
    summary: "",
    timeline: [],
    publicWork: [],
    capabilities: [],
    founderMarketFit: "",
    notObservableWithoutInterview: [],
    backgroundFromDeck: "",
    priorOrganizations: [],
    publicProfileUrls: [],
    researchFindingSourceIds: [],
    ...extra,
  };
}

function deal(name: string, extra: { website?: string | null; oneLiner?: string; founders?: Founder[] } = {}): CanonicalDeal {
  const d = makeDeal();
  d.identity = { ...d.identity, name, website: extra.website ?? null, oneLiner: extra.oneLiner ?? `${name} software` };
  d.founders = extra.founders ?? [];
  return d;
}

const db = () => getDb();
let tick = 0;
function company(ws: string, c: CanonicalDeal) {
  const row = repo.createCompany(ws, c.identity.name);
  // Deterministic recency order for alias collapsing (catalog is ordered by updatedAt desc).
  db().update(schema.companies).set({ updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString() }).where(eq(schema.companies.id, row.id)).run();
  writeGraph(ws, row.id, c);
  return row;
}
const workspace = () => createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" }).workspaceId;
const persons = (ws: string, name: string) => db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.type, "PERSON"), eq(schema.entities.normName, name))).all();
const founded = (ws: string, entityId: string) =>
  db()
    .select({ companyId: schema.relations.companyId })
    .from(schema.relations)
    .where(and(eq(schema.relations.workspaceId, ws), eq(schema.relations.fromEntity, entityId), eq(schema.relations.type, "FOUNDED")))
    .all()
    .map((r) => r.companyId);

describe("graph: people", () => {
  it("keeps two different David Chens (two companies, different profiles) as two entities", () => {
    const ws = workspace();
    const a = company(ws, deal("Alpha Robotics", { founders: [founder("David Chen", { publicProfileUrls: ["https://linkedin.com/in/dchen-robotics"] })] }));
    const b = company(ws, deal("Beta Health", { founders: [founder("David Chen", { publicProfileUrls: ["https://linkedin.com/in/david-chen-md"] })] }));
    const ps = persons(ws, "davidchen");
    expect(ps).toHaveLength(2);
    expect(ps.map((p) => founded(ws, p.id)).sort()).toEqual([[a.id], [b.id]].sort());
    // Chat: both are surfaced, each with its own company — never merged.
    const m = resolveMentions(ws, "What do we know about David Chen?", catalog(ws));
    expect(m.companyIds.sort()).toEqual([a.id, b.id].sort());
    expect(m.people).toHaveLength(2);
    expect(m.people.join(" ")).toMatch(/Alpha Robotics/);
    expect(m.people.join(" ")).toMatch(/different person/);
  });

  it("merges the same person across two companies when the public profile is the same", () => {
    const ws = workspace();
    const url = "https://www.linkedin.com/in/dchen-serial/";
    const a = company(ws, deal("Gamma", { founders: [founder("David Chen", { publicProfileUrls: [url] })] }));
    const b = company(ws, deal("Delta Labs", { founders: [founder("David J. Chen", { publicProfileUrls: ["linkedin.com/in/dchen-serial"] })] }));
    const ps = persons(ws, "davidchen").concat(persons(ws, "davidjchen"));
    expect(ps).toHaveLength(1);
    expect(founded(ws, ps[0]!.id).sort()).toEqual([a.id, b.id].sort());
    // A serial founder is not a rename.
    expect(companyAliases(ws, b.id).linked).toEqual([]);
  });

  it("is idempotent and withdraws a company's evidence on re-index", () => {
    const ws = workspace();
    const url = "https://linkedin.com/in/same-one";
    const d1 = deal("Epsilon", { founders: [founder("Maya Patel", { publicProfileUrls: [url] })] });
    const a = company(ws, d1);
    const b = company(ws, deal("Zeta", { founders: [founder("Maya Patel", { publicProfileUrls: [url] })] }));
    expect(persons(ws, "mayapatel")).toHaveLength(1);
    writeGraph(ws, a.id, d1);
    writeGraph(ws, a.id, d1);
    expect(persons(ws, "mayapatel")).toHaveLength(1);
    // Epsilon's founder loses the shared profile: the two people separate, nothing orphaned remains.
    writeGraph(ws, a.id, deal("Epsilon", { founders: [founder("Maya Patel", { publicProfileUrls: ["https://linkedin.com/in/another-maya"] })] }));
    writeGraph(ws, b.id, deal("Zeta", { founders: [founder("Maya Patel", { publicProfileUrls: [url] })] }));
    const ps = persons(ws, "mayapatel");
    expect(ps).toHaveLength(2);
    expect(ps.map((p) => founded(ws, p.id).length)).toEqual([1, 1]);
  });

  it("adopts legacy (pre-resolution) rows instead of duplicating them, and prunes orphans", () => {
    const ws = workspace();
    const legacyId = newId("ent");
    db().insert(schema.entities).values({ id: legacyId, workspaceId: ws, type: "COMPETITOR", name: "Bill.com", normName: "billcom", companyId: null, aliases: [] }).run();
    const orphan = newId("ent");
    db().insert(schema.entities).values({ id: orphan, workspaceId: ws, type: "PERSON", name: "Old Merge", normName: "oldmerge", companyId: null, aliases: [] }).run();
    const d = deal("Eta");
    d.competition = { competitors: [{ name: "Bill.com", type: "DIRECT", description: "AP automation", scale: null, url: null }], adversarialTests: [] } as unknown as CanonicalDeal["competition"];
    company(ws, d);
    const comps = db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.type, "COMPETITOR"))).all();
    expect(comps).toHaveLength(1);
    expect(comps[0]!.id).toBe(legacyId);
    expect(comps[0]!.resolutionKey).toBe("competitor:billcom");
    expect(db().select().from(schema.entities).where(eq(schema.entities.id, orphan)).get()).toBeUndefined();
    expect(pruneOrphanEntities(db(), ws)).toBe(0);
  });
});

describe("graph: employers", () => {
  it("normalizes Google/Alphabet to one employer entity across founders", () => {
    const ws = workspace();
    company(ws, deal("Theta", { founders: [founder("Ana Ruiz", { priorOrganizations: ["Alphabet"] })] }));
    company(ws, deal("Iota", { founders: [founder("Ben Okafor", { priorOrganizations: ["ex-Google"] })] }));
    const orgs = db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.resolutionKey, "org:google"))).all();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.name).toBe("Google");
    const worked = db().select().from(schema.relations).where(and(eq(schema.relations.toEntity, orgs[0]!.id), eq(schema.relations.type, "WORKED_AT"))).all();
    expect(worked).toHaveLength(2);
    expect(worked.map((r) => r.note).join(" ")).toMatch(/“Alphabet” → Google/);
  });

  it("never links people or deals through placeholder employers", () => {
    const ws = workspace();
    company(ws, deal("Nu", { founders: [founder("Sam Reyes", { priorOrganizations: ["Unnamed distributor", "Not specified"] })] }));
    company(ws, deal("Xi", { founders: [founder("Sam Reyes", { priorOrganizations: ["Unnamed distributor", "Not specified"] })] }));
    expect(persons(ws, "samreyes")).toHaveLength(2);
    expect(db().select().from(schema.relations).where(and(eq(schema.relations.workspaceId, ws), eq(schema.relations.type, "WORKED_AT"))).all()).toEqual([]);
  });

  it("marks an ambiguous employer AMBIGUOUS and keeps it apart from a resolved one", () => {
    const ws = workspace();
    company(ws, deal("Kappa", { founders: [founder("Chris Lee", { priorOrganizations: ["Mercury"] })] }));
    company(ws, deal("Lambda", { founders: [founder("Dana Kim", { priorOrganizations: ["Mercury Systems"] })] }));
    const amb = db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.resolutionKey, "org:ambiguous:mercury"))).get()!;
    expect(amb).toBeDefined();
    expect((amb.attributes as { status: string }).status).toBe("AMBIGUOUS");
    const rel = db().select().from(schema.relations).where(eq(schema.relations.toEntity, amb.id)).get()!;
    expect(rel.note).toMatch(/^AMBIGUOUS: “Mercury” could be .*Mercury \(banking\).*Mercury Systems/);
    expect(db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.resolutionKey, "org:mercury-systems"))).get()).toBeDefined();
  });

  it("resolves the ambiguous name from the founder's own background, not from the deal's sector", () => {
    const ws = workspace();
    const d = deal("Mu Fintech", { founders: [founder("Eli Stone", { priorOrganizations: ["Mercury"], backgroundFromDeck: "Previously led embedded software at Mercury on defense radar programs." })] });
    company(ws, d);
    expect(db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.resolutionKey, "org:mercury-systems"))).get()).toBeDefined();
    expect(db().select().from(schema.entities).where(and(eq(schema.entities.workspaceId, ws), eq(schema.entities.resolutionKey, "org:ambiguous:mercury"))).get()).toBeUndefined();
  });
});

describe("graph: renamed companies", () => {
  it("links a renamed company to its old dossier and resolves the old name in chat", () => {
    const ws = workspace();
    const old = company(ws, deal("Widgetly", { website: "https://widgetly.com" }));
    const renamed = company(ws, deal("Acme Ledger", { website: "https://acmeledger.com", oneLiner: "Acme Ledger (formerly Widgetly) automates accounts payable." }));
    const al = companyAliases(ws, renamed.id);
    expect(al.formerNames.map((f) => f.name)).toEqual(["Widgetly"]);
    expect(al.linked).toEqual([expect.objectContaining({ companyId: old.id, type: "ALIAS_OF" })]);
    // The old dossier sees the link too (relation read in both directions).
    expect(companyAliases(ws, old.id).linked[0]).toMatchObject({ companyId: renamed.id, type: "ALIAS_OF" });

    const m = resolveMentions(ws, "What was Widgetly's ARR?", catalog(ws));
    expect(m.companyIds).toEqual([renamed.id]);
    expect(m.aliases[0]).toMatchObject({ companyId: renamed.id, name: "Acme Ledger" });
  });

  it("finds a renamed company by a former name that has no dossier of its own", () => {
    const ws = workspace();
    const c = company(ws, deal("Nimbus Grid", { oneLiner: "We were previously known as Cloudlet. Nimbus Grid balances microgrids." }));
    const m = resolveMentions(ws, "Tell me about Cloudlet", catalog(ws));
    expect(m.companyIds).toEqual([c.id]);
    expect(m.aliases).toEqual([expect.objectContaining({ mention: "Cloudlet", relation: "FORMER_NAME" })]);
  });

  it("links two dossiers on the same website domain", () => {
    const ws = workspace();
    const a = company(ws, deal("Orbital", { website: "https://orbital.ai" }));
    const b = company(ws, deal("Orbital Space Systems", { website: "https://app.orbital.ai" }));
    expect(companyAliases(ws, b.id).linked).toEqual([expect.objectContaining({ companyId: a.id, type: "ALIAS_OF", reasons: expect.stringMatching(/same website domain orbital\.ai/) })]);
  });

  it("shows a founder-name overlap as unconfirmed and never uses it to resolve a mention", () => {
    const ws = workspace();
    const team = () => [founder("Rui Costa"), founder("Lena Vogel")];
    const a = company(ws, deal("Pivotly", { founders: team() }));
    const b = company(ws, deal("Sigma Freight", { founders: team() }));
    expect(companyAliases(ws, b.id).linked).toEqual([expect.objectContaining({ companyId: a.id, type: "POSSIBLY_SAME_AS" })]);
    expect(resolveMentions(ws, "How is Pivotly doing?", catalog(ws)).companyIds).toEqual([a.id]);
  });

  it("does not treat an unrelated homonym deal as an alias", () => {
    const ws = workspace();
    company(ws, deal("Atlas", { website: "https://atlas-robotics.com" }));
    const b = company(ws, deal("Atlas", { website: "https://atlasbio.com" }));
    expect(companyAliases(ws, b.id).linked).toEqual([]);
  });
});
