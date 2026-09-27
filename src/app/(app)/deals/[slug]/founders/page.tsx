import type { Claim, Founder } from "@/domain/canonical";
import { loadDeal } from "@/server/deal";
import { Badge, Bullets, Section, Td, Th, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { ClaimList, DimensionDetail, Prose, Quiet, TabMain, TableFrame, ratingLabel, ratingTone } from "@/components/deal/tabs/shared";

const OBSERVABILITY: Record<string, { text: string; tone: Tone }> = {
  OBSERVABLE: { text: "Observable", tone: "ok" },
  INFERRED: { text: "Inferred", tone: "warn" },
  NOT_OBSERVABLE: { text: "Not observable", tone: "unknown" },
};

const CAPABILITY_LABEL: Record<string, string> = {
  COMMUNICATION_INTELLECTUAL_HONESTY: "Communication & intellectual honesty",
  COFOUNDER_DYNAMICS: "Co-founder dynamics",
};

const WORK_KIND: Record<string, string> = { CODE: "Code", PAPER: "Paper", PATENT: "Patent", TALK: "Talk", PRODUCT: "Product", WRITING: "Writing", OTHER: "Other" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** A TEAM claim belongs to a founder when the claim's entity (or, failing that, its statement) names them. */
function claimsFor(f: Founder, teamClaims: Claim[]): Claim[] {
  const full = norm(f.name);
  const last = full.split(" ").slice(-1)[0] ?? full;
  return teamClaims.filter((c) => {
    const entity = norm(c.entity);
    if (entity.includes(full) || (last.length > 2 && entity.split(" ").includes(last))) return true;
    return norm(c.statement).includes(full);
  });
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function FoundersTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const team = c.claims.filter((x) => x.category === "TEAM");
  const assigned = new Set<string>();
  const perFounder = c.founders.map((f) => {
    const cl = claimsFor(f, team);
    cl.forEach((x) => assigned.add(x.id));
    return cl;
  });
  const teamLevel = team.filter((x) => !assigned.has(x.id));
  const deckOnly = c.foundersFromDeck.filter((fd) => !c.founders.some((f) => norm(f.name) === norm(fd.name)));

  return (
    <TabMain>
      <Section
        eyebrow="Founders"
        title={c.founders.length ? `${c.founders.length} founder${c.founders.length === 1 ? "" : "s"} assessed on observable evidence` : "Founders not yet analyzed"}
      >
        <p className="max-w-[820px] text-[13px] leading-relaxed text-ink-3">
          Pedigree is not scored. Ratings reflect observable evidence of capability — what the founder has built, decided and sold — not the institutions or titles on
          a CV. Capabilities that cannot be observed from documents or public research are marked as such and left for interviews and references.
        </p>
      </Section>

      {c.founders.map((f, fi) => {
        const caps = [...f.capabilities].sort((a, b) => Number(b.relevant) - Number(a.relevant));
        const hidden = caps.filter((x) => !x.relevant).length;
        const claims = perFounder[fi] ?? [];
        return (
          <section key={f.id} id={f.id} className="scroll-mt-28 space-y-6 border-t border-line pt-8">
            <div className="grid gap-10 md:grid-cols-[1.35fr_1fr]">
              <div>
                <div className="flex items-baseline gap-3">
                  <h2 className="t-display">{f.name}</h2>
                  <span className="text-ink-3">{f.role}</span>
                </div>
                <p className="mt-2 max-w-[680px] leading-relaxed text-ink-2">
                  <Prose text={f.summary} slug={slug} />
                </p>
                {f.backgroundFromDeck && (
                  <p className="mt-3 max-w-[680px] text-[12.5px] text-ink-3">
                    <span className="font-medium text-ink-2">As stated in the deck:</span> {f.backgroundFromDeck}
                  </p>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="t-eyebrow mb-1">Founder–market fit · interpretation</div>
                  <p className="leading-relaxed text-ink-2">
                    <Prose text={f.founderMarketFit} slug={slug} />
                  </p>
                </div>
                <div>
                  <div className="t-eyebrow mb-1.5">Not observable without interview / reference</div>
                  {f.notObservableWithoutInterview.length ? (
                    <Bullets items={f.notObservableWithoutInterview} tone="unknown" />
                  ) : (
                    <Quiet>None listed.</Quiet>
                  )}
                </div>
              </div>
            </div>

            {/* Career timeline */}
            <div>
              <div className="t-eyebrow mb-1.5">Career timeline</div>
              {f.timeline.length ? (
                <TableFrame>
                  <thead>
                    <tr>
                      <Th className="w-[170px]">Period</Th>
                      <Th className="w-[210px]">Organization</Th>
                      <Th className="w-[230px]">Role</Th>
                      <Th>Relevance to this company</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.timeline.map((t, i) => (
                      <tr key={i}>
                        <Td className="text-[12.5px] text-ink-3">{t.period}</Td>
                        <Td className="text-ink">{t.organization}</Td>
                        <Td className="text-[12.5px] text-ink-2">{t.role}</Td>
                        <Td className="text-[12.5px] text-ink-2">
                          <Prose text={t.relevance} slug={slug} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableFrame>
              ) : (
                <Quiet>No career history could be established.</Quiet>
              )}
            </div>

            {/* Public work */}
            <div>
              <div className="t-eyebrow mb-1.5">Public work — code, papers, patents</div>
              {f.publicWork.length ? (
                <ul className="divide-y divide-line border-y border-line">
                  {f.publicWork.map((w, i) => (
                    <li key={i} className="grid grid-cols-[90px_1fr_220px] items-baseline gap-3 py-2">
                      <span>
                        <Badge>{WORK_KIND[w.kind] ?? titleCase(w.kind)}</Badge>
                      </span>
                      <span className="text-ink-2">{w.description}</span>
                      <span className="truncate text-right text-[12px]">
                        {w.url ? (
                          <a href={w.url} target="_blank" rel="noreferrer noopener" className="text-ink-3 hover:text-accent-text">
                            {host(w.url)} ↗
                          </a>
                        ) : (
                          <span className="text-ink-3">No link</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Quiet>No public work (code, papers, patents, talks) could be tied to this founder.</Quiet>
              )}
            </div>

            {/* Capability analysis */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-4">
                <div className="t-eyebrow">Capability analysis</div>
                {hidden > 0 && (
                  <span className="text-[11.5px] text-ink-3">
                    {hidden} capabilit{hidden === 1 ? "y" : "ies"} judged not relevant to this role — shown last, not rated
                  </span>
                )}
              </div>
              {caps.length ? (
                <TableFrame minWidth={860}>
                  <thead>
                    <tr>
                      <Th className="w-[220px]">Capability</Th>
                      <Th className="w-[150px]">Rating</Th>
                      <Th className="w-[130px]">Observability</Th>
                      <Th>Evidence</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {caps.map((cap) => {
                      const ob = OBSERVABILITY[cap.observability] ?? { text: titleCase(cap.observability), tone: "unknown" as Tone };
                      return (
                        <tr key={cap.dimension} className={cx(!cap.relevant && "text-ink-3")}>
                          <Td className={cap.relevant ? "text-ink" : "text-ink-3"}>{CAPABILITY_LABEL[cap.dimension] ?? titleCase(cap.dimension)}</Td>
                          <Td>
                            {cap.relevant ? (
                              <Badge tone={ratingTone(cap.rating)}>{ratingLabel(cap.rating)}</Badge>
                            ) : (
                              <span className="text-[12px] text-ink-3">Not relevant to role</span>
                            )}
                          </Td>
                          <Td>{cap.relevant ? <Badge tone={ob.tone}>{ob.text}</Badge> : <span className="text-[12px] text-ink-3">—</span>}</Td>
                          <Td className={cx("text-[12.5px]", cap.relevant ? "text-ink-2" : "text-ink-3")}>
                            <Prose text={cap.evidence} slug={slug} />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableFrame>
              ) : (
                <Quiet>No capability assessment was produced.</Quiet>
              )}
            </div>

            {/* Research-backed claims */}
            <div>
              <div className="t-eyebrow mb-1.5">Claims about {f.name.split(" ")[0]} — deck and research</div>
              {claims.length ? <ClaimList claims={claims} slug={slug} /> : <Quiet>No team claims reference this founder.</Quiet>}
            </div>
          </section>
        );
      })}

      {deckOnly.length > 0 && (
        <Section eyebrow="Named in the deck" title="Not yet analyzed">
          <TableFrame>
            <thead>
              <tr>
                <Th className="w-[200px]">Name</Th>
                <Th className="w-[140px]">Role</Th>
                <Th>Background as stated</Th>
              </tr>
            </thead>
            <tbody>
              {deckOnly.map((fd) => (
                <tr key={fd.name}>
                  <Td className="text-ink">{fd.name}</Td>
                  <Td className="text-ink-2">{fd.role}</Td>
                  <Td className="text-[12.5px] text-ink-2">{fd.backgroundFromDeck || <span className="text-ink-3">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </Section>
      )}

      {teamLevel.length > 0 && (
        <Section eyebrow="Team-level claims" title="Claims about the team as a whole">
          <ClaimList claims={teamLevel} slug={slug} />
        </Section>
      )}

      <Section eyebrow="Operating quality" title="Team dimension">
        <DimensionDetail d={d} id="TEAM" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
