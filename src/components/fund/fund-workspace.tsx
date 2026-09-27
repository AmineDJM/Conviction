"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FundProfile } from "@/domain/fund";
import { FINANCING_STAGES, INDUSTRIES } from "@/domain/enums";
import { Badge, Button, Callout, cx, Empty, Section } from "@/components/ui";
import { date, titleCase, usd } from "@/lib/format";

type Memory = {
  knowledge: { id: string; kind: string; title: string; body: string; provenance: string; sourceRef: string | null; updatedAt: string }[];
  members: { id: string; name: string; role: string; bio: string | null; focus: string[]; documentedPreferences: string | null }[];
  observations: { id: string; memberId: string; kind: string; statement: string; quote: string | null; topic: string | null; provenance: string; observedAt: string; companyId: string | null; meetingId: string | null }[];
  meetings: { id: string; kind: string; title: string; heldAt: string; companyId: string | null; hasTranscript: boolean }[];
};

const provTone = (p: string) => (p === "DOCUMENTED" ? "accent" : p === "OBSERVED" ? "ok" : "warn") as "accent" | "ok" | "warn";
const input = "h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent";
const area = "w-full rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent";

async function api(method: string, body?: unknown, query = "") {
  const res = await fetch(`/api/fund${query}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function FundWorkspace({ profile, memory, companies, welcome, canWrite }: { profile: FundProfile; memory: Memory; companies: { id: string; name: string }[]; welcome: boolean; canWrite: boolean }) {
  const [tab, setTab] = useState<"profile" | "knowledge" | "ic" | "meetings">(welcome ? "profile" : "knowledge");
  const tabs = [
    { id: "profile", label: "Fund profile" },
    { id: "knowledge", label: "Strategy & criteria", n: memory.knowledge.length },
    { id: "ic", label: "IC members", n: memory.members.length },
    { id: "meetings", label: "Meetings", n: memory.meetings.length },
  ] as const;
  return (
    <div>
      {welcome && (
        <div className="px-8 pb-6">
          <Callout tone="accent" title="Workspace ready">
            Set the fund profile first (mandate gates and return targets depend on it), then document the strategy, criteria, verticals and IC preferences. The Fund Brain uses only what is recorded here — it never invents an IC member&apos;s view.
          </Callout>
        </div>
      )}
      <nav className="-mb-px flex gap-1 border-b border-line px-8">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cx("border-b-2 px-2.5 py-2 text-[13px]", tab === t.id ? "border-ink font-medium" : "border-transparent text-ink-3 hover:text-ink")}>
            {t.label}
            {"n" in t && <span className="num ml-1.5 text-[11px] text-ink-3">{t.n}</span>}
          </button>
        ))}
      </nav>
      <div className="max-w-[1080px] px-8 pt-8">
        {tab === "profile" && <ProfileForm profile={profile} canWrite={canWrite} />}
        {tab === "knowledge" && <Knowledge items={memory.knowledge} canWrite={canWrite} />}
        {tab === "ic" && <IcMembers members={memory.members} observations={memory.observations} companies={companies} canWrite={canWrite} />}
        {tab === "meetings" && <Meetings meetings={memory.meetings} companies={companies} hasMembers={memory.members.length > 0} canWrite={canWrite} />}
      </div>
    </div>
  );
}

/* ------------------------------ Profile ------------------------------ */

function ProfileForm({ profile, canWrite }: { profile: FundProfile; canWrite: boolean }) {
  const router = useRouter();
  const [p, setP] = useState(profile);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FundProfile>(k: K, v: FundProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const num = (k: keyof FundProfile, label: string, hint?: string, scale = 1) => (
    <label className="block">
      <span className="mb-1 block text-[12.5px] text-ink-2">{label}</span>
      <input type="number" className={input} value={(p[k] as number) / scale} onChange={(e) => set(k, (Number(e.target.value) * scale) as never)} disabled={!canWrite} />
      {hint && <span className="mt-0.5 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", { profile: p });
      setMsg("Saved. New analyses use this profile; use Benchmarks → Recalculate portfolio to re-score existing deals.");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-10">
      <Section eyebrow="Identity" title="Fund">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[12.5px] text-ink-2">Name</span>
            <input className={input} value={p.name} onChange={(e) => set("name", e.target.value)} disabled={!canWrite} />
          </label>
          {num("vintage", "Vintage")}
          <label className="block sm:col-span-3">
            <span className="mb-1 block text-[12.5px] text-ink-2">Strategy (one paragraph)</span>
            <textarea rows={3} className={area} value={p.strategy} onChange={(e) => set("strategy", e.target.value)} disabled={!canWrite} />
          </label>
        </div>
      </Section>
      <Section eyebrow="Economics" title="Size, checks and targets">
        <div className="grid gap-4 sm:grid-cols-4">
          {num("fundSizeUsd", "Fund size ($M)", usd(p.fundSizeUsd), 1e6)}
          {num("checkMinUsd", "Min check ($M)", undefined, 1e6)}
          {num("checkMaxUsd", "Max check ($M)", undefined, 1e6)}
          {num("initialCheckDefaultUsd", "Default initial check ($M)", undefined, 1e6)}
          {num("ownershipTargetPct", "Ownership target (%)")}
          {num("reserveRatio", "Reserve ratio", "Follow-on $ per $1 initial")}
          {num("maxConcentrationPct", "Max concentration (%)")}
          {num("targetFundMultiple", "Target fund multiple (×)")}
          {num("targetDealReturnUsd", "Target contribution of a winner ($M)", "Used by backwards return analysis", 1e6)}
        </div>
      </Section>
      <Section eyebrow="Mandate gates (binary)" title="Stages, sectors and geography">
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 text-[12.5px] text-ink-2">Stages in mandate</div>
            <div className="flex flex-wrap gap-1.5">
              {FINANCING_STAGES.filter((x) => x !== "UNKNOWN").map((st) => (
                <Chip key={st} on={p.stages.includes(st)} onClick={() => canWrite && set("stages", toggle(p.stages, st))}>
                  {titleCase(st)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] text-ink-2">Focus sectors (none = generalist) · expertise · excluded</div>
            <div className="flex flex-wrap gap-1.5">
              {INDUSTRIES.map((ind) => {
                const state = p.excludedIndustries.includes(ind) ? "excluded" : p.sectorExpertise.includes(ind) ? "expertise" : p.sectors.includes(ind) ? "focus" : "off";
                const next = () => {
                  if (!canWrite) return;
                  const without = { sectors: p.sectors.filter((x) => x !== ind), sectorExpertise: p.sectorExpertise.filter((x) => x !== ind), excludedIndustries: p.excludedIndustries.filter((x) => x !== ind) };
                  if (state === "off") setP({ ...p, ...without, sectors: [...without.sectors, ind] });
                  else if (state === "focus") setP({ ...p, ...without, sectors: [...without.sectors, ind], sectorExpertise: [...without.sectorExpertise, ind] });
                  else if (state === "expertise") setP({ ...p, ...without, excludedIndustries: [...without.excludedIndustries, ind] });
                  else setP({ ...p, ...without });
                };
                return (
                  <button
                    key={ind}
                    onClick={next}
                    title="Click to cycle: off → focus → focus + expertise → excluded"
                    className={cx(
                      "rounded-md border px-2 py-1 text-[12px]",
                      state === "off" && "border-line text-ink-3",
                      state === "focus" && "border-ink/40 text-ink",
                      state === "expertise" && "border-accent/40 bg-accent-soft text-accent-text",
                      state === "excluded" && "border-risk/30 bg-risk-soft text-risk line-through",
                    )}
                  >
                    {titleCase(ind)}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11.5px] text-ink-3">Click cycles: off → focus → focus + expertise → excluded.</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-ink-2">Allowed geographies (comma-separated; empty = global)</span>
              <input className={input} value={p.geographies.join(", ")} onChange={(e) => set("geographies", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} disabled={!canWrite} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12.5px] text-ink-2">Geographic expertise</span>
              <input className={input} value={p.geographicExpertise.join(", ")} onChange={(e) => set("geographicExpertise", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} disabled={!canWrite} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[12.5px] text-ink-2">Excluded categories (keywords, comma-separated)</span>
              <input className={input} value={p.excludedCategories.join(", ")} onChange={(e) => set("excludedCategories", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} disabled={!canWrite} />
            </label>
          </div>
        </div>
      </Section>
      <Section eyebrow="Portfolio" title="Existing portfolio companies" action={canWrite && <Button size="sm" onClick={() => set("portfolio", [...p.portfolio, { name: "", industry: [], description: "" }])}>Add company</Button>}>
        {p.portfolio.length === 0 ? (
          <p className="text-ink-3">Used for conflict and concentration checks.</p>
        ) : (
          <div className="space-y-2">
            {p.portfolio.map((pc, i) => (
              <div key={i} className="grid grid-cols-[200px_220px_1fr_auto] items-center gap-2">
                <input className={input} placeholder="Name" value={pc.name} onChange={(e) => set("portfolio", p.portfolio.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <select className={input} value={pc.industry[0] ?? ""} onChange={(e) => set("portfolio", p.portfolio.map((x, j) => (j === i ? { ...x, industry: e.target.value ? [e.target.value as never] : [] } : x)))}>
                  <option value="">Industry…</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>
                      {titleCase(ind)}
                    </option>
                  ))}
                </select>
                <input className={input} placeholder="What it does" value={pc.description} onChange={(e) => set("portfolio", p.portfolio.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" onClick={() => set("portfolio", p.portfolio.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
      {canWrite && (
        <div className="flex items-center gap-3 border-t border-line pt-5">
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save fund profile"}
          </Button>
          {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx("rounded-md border px-2 py-1 text-[12px]", on ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong")}>
      {children}
    </button>
  );
}

/* ------------------------------ Knowledge ------------------------------ */

const KINDS = ["STRATEGY", "CRITERIA", "VERTICAL", "IC_PREFERENCE", "POLICY", "LESSON", "NOTE"] as const;

function Knowledge({ items, canWrite }: { items: Memory["knowledge"]; canWrite: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ kind: "STRATEGY" as (typeof KINDS)[number], title: "", body: "", provenance: "DOCUMENTED", sourceRef: "" });
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setErr(null);
    try {
      await api("POST", { type: "knowledge", data: { ...draft, sourceRef: draft.sourceRef || null } });
      setDraft({ ...draft, title: "", body: "", sourceRef: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const grouped = KINDS.map((k) => ({ k, list: items.filter((i) => i.kind === k) })).filter((g) => g.list.length);
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        {grouped.length === 0 && (
          <Empty title="Nothing documented yet">
            Record the fund&apos;s investment strategy, criteria, verticals, IC preferences and lessons. The Fund Brain cites these as DOCUMENTED.
          </Empty>
        )}
        {grouped.map((g) => (
          <Section key={g.k} eyebrow={titleCase(g.k)}>
            <div className="divide-y divide-line border-y border-line">
              {g.list.map((k) => (
                <div key={k.id} id={k.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{k.title}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={provTone(k.provenance)}>{titleCase(k.provenance)}</Badge>
                      {canWrite && (
                        <button onClick={() => api("DELETE", undefined, `?type=knowledge&id=${k.id}`).then(() => router.refresh())} className="text-[12px] text-ink-3 hover:text-risk">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-ink-2">{k.body}</p>
                  <div className="mt-1 text-[11.5px] text-ink-3">
                    {k.sourceRef ? `Source: ${k.sourceRef} · ` : ""}Updated {date(k.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>
      {canWrite && (
        <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="t-eyebrow">Add knowledge</div>
          <select className={input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as never })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </select>
          <input className={input} placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea rows={7} className={area} placeholder="Body — e.g. 'We invest in B2B software where the product replaces labor…'" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <select className={input} value={draft.provenance} onChange={(e) => setDraft({ ...draft, provenance: e.target.value })}>
            <option value="DOCUMENTED">Documented (written policy)</option>
            <option value="OBSERVED">Observed (seen in decisions)</option>
            <option value="INFERRED">Inferred (pattern, to confirm)</option>
          </select>
          <input className={input} placeholder="Source (e.g. LPA §3, IC charter 2026)" value={draft.sourceRef} onChange={(e) => setDraft({ ...draft, sourceRef: e.target.value })} />
          <Button variant="primary" onClick={add} disabled={!draft.title || !draft.body}>
            Add
          </Button>
          {err && <div className="text-[12.5px] text-risk">{err}</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ IC members ------------------------------ */

function IcMembers({ members, observations, companies, canWrite }: { members: Memory["members"]; observations: Memory["observations"]; companies: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", role: "", bio: "", focus: "", documentedPreferences: "" });
  const [obs, setObs] = useState({ memberId: "", kind: "QUESTION", statement: "", quote: "", topic: "", companyId: "" });
  const [err, setErr] = useState<string | null>(null);
  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name;

  async function saveMember() {
    setErr(null);
    const data = { name: draft.name, role: draft.role, bio: draft.bio || null, focus: draft.focus.split(",").map((x) => x.trim()).filter(Boolean), documentedPreferences: draft.documentedPreferences || null };
    try {
      if (editing === "new") await api("POST", { type: "member", data });
      else await api("PATCH", { id: editing, data });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function addObs() {
    setErr(null);
    try {
      await api("POST", { type: "observation", data: { ...obs, quote: obs.quote || null, topic: obs.topic || null, companyId: obs.companyId || null, provenance: "OBSERVED" } });
      setObs({ ...obs, statement: "", quote: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-10">
      <Callout tone="neutral" title="How IC memory is used">
        DOCUMENTED = preferences the member wrote or approved. OBSERVED = what they actually said in a recorded meeting (with quote). INFERRED = a pattern the Brain derives from observations and labels as such. The Fund Brain never fabricates an opinion — without records it answers “we don&apos;t know yet”.
      </Callout>
      {members.length === 0 && editing !== "new" && <Empty title="No IC members recorded" action={canWrite && <Button onClick={() => (setDraft({ name: "", role: "", bio: "", focus: "", documentedPreferences: "" }), setEditing("new"))}>Add IC member</Button>} />}
      {members.map((m) => {
        const mo = observations.filter((o) => o.memberId === m.id);
        return (
          <section key={m.id} id={m.id} className="scroll-mt-6 border-t border-line pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="t-section">{m.name}</div>
                <div className="text-ink-3">
                  {m.role}
                  {m.focus.length > 0 && ` · ${m.focus.join(", ")}`}
                </div>
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => (setDraft({ name: m.name, role: m.role, bio: m.bio ?? "", focus: m.focus.join(", "), documentedPreferences: m.documentedPreferences ?? "" }), setEditing(m.id))}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${m.name} and their observations?`) && api("DELETE", undefined, `?type=member&id=${m.id}`).then(() => router.refresh())}>
                    Delete
                  </Button>
                </div>
              )}
            </div>
            {m.bio && <p className="mt-2 text-ink-2">{m.bio}</p>}
            <div className="mt-4 grid gap-8 md:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="t-eyebrow">Documented preferences</span>
                  <Badge tone="accent">Documented</Badge>
                </div>
                <p className="whitespace-pre-wrap text-ink-2">{m.documentedPreferences ?? <span className="text-ink-3">None documented.</span>}</p>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="t-eyebrow">Observed in meetings</span>
                  <span className="num text-[11.5px] text-ink-3">{mo.length}</span>
                </div>
                {mo.length === 0 ? (
                  <p className="text-ink-3">No recorded observations.</p>
                ) : (
                  <ul className="space-y-2">
                    {mo.slice(0, 12).map((o) => (
                      <li key={o.id} className="text-[13px]">
                        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                          <span className="num">{date(o.observedAt)}</span>
                          <Badge tone={provTone(o.provenance)}>{titleCase(o.provenance)}</Badge>
                          <span>{titleCase(o.kind)}</span>
                          {o.topic && <span>· {o.topic}</span>}
                          {o.companyId && <span>· {companyName(o.companyId)}</span>}
                        </div>
                        <div className="text-ink">{o.statement}</div>
                        {o.quote && <div className="text-[12.5px] italic text-ink-3">“{o.quote}”</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })}

      {canWrite && members.length > 0 && editing === null && (
        <div className="flex gap-2">
          <Button onClick={() => (setDraft({ name: "", role: "", bio: "", focus: "", documentedPreferences: "" }), setEditing("new"))}>Add IC member</Button>
        </div>
      )}

      {editing && (
        <div className="max-w-[640px] space-y-3 border-t border-line pt-5">
          <div className="t-section">{editing === "new" ? "New IC member" : "Edit IC member"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className={input} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className={input} placeholder="Role (e.g. Managing Partner)" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          </div>
          <input className={input} placeholder="Focus areas, comma-separated" value={draft.focus} onChange={(e) => setDraft({ ...draft, focus: e.target.value })} />
          <textarea rows={2} className={area} placeholder="Short bio" value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
          <textarea rows={5} className={area} placeholder="Documented preferences — only what the member wrote or approved" value={draft.documentedPreferences} onChange={(e) => setDraft({ ...draft, documentedPreferences: e.target.value })} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={saveMember} disabled={!draft.name || !draft.role}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canWrite && members.length > 0 && (
        <div className="max-w-[720px] space-y-3 border-t border-line pt-5">
          <div className="t-section">Record an observation</div>
          <p className="text-[12.5px] text-ink-3">For something a member actually said or did. Prefer uploading the meeting transcript under Meetings — observations are then extracted with verbatim quotes.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <select className={input} value={obs.memberId} onChange={(e) => setObs({ ...obs, memberId: e.target.value })}>
              <option value="">Member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select className={input} value={obs.kind} onChange={(e) => setObs({ ...obs, kind: e.target.value })}>
              {["QUESTION", "CONCERN", "SUPPORT", "VOTE"].map((k) => (
                <option key={k} value={k}>
                  {titleCase(k)}
                </option>
              ))}
            </select>
            <select className={input} value={obs.companyId} onChange={(e) => setObs({ ...obs, companyId: e.target.value })}>
              <option value="">Company (optional)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <input className={input} placeholder="Topic (e.g. retention, valuation)" value={obs.topic} onChange={(e) => setObs({ ...obs, topic: e.target.value })} />
          <textarea rows={2} className={area} placeholder="What they said (neutral paraphrase)" value={obs.statement} onChange={(e) => setObs({ ...obs, statement: e.target.value })} />
          <textarea rows={2} className={area} placeholder="Verbatim quote (optional)" value={obs.quote} onChange={(e) => setObs({ ...obs, quote: e.target.value })} />
          <Button onClick={addObs} disabled={!obs.memberId || !obs.statement}>
            Record observation
          </Button>
        </div>
      )}
      {err && <div className="text-[12.5px] text-risk">{err}</div>}
    </div>
  );
}

/* ------------------------------ Meetings ------------------------------ */

function Meetings({ meetings, companies, hasMembers, canWrite }: { meetings: Memory["meetings"]; companies: { id: string; name: string }[]; hasMembers: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [d, setD] = useState({ kind: "IC", title: "", heldAt: new Date().toISOString().slice(0, 10), companyId: "", transcript: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("POST", { type: "meeting", data: { ...d, companyId: d.companyId || null, transcript: d.transcript || null, notes: d.notes || null, extractObservations: true } });
      setMsg(`Saved. ${r.extracted} observation(s) extracted with verbatim quotes.`);
      setD({ ...d, title: "", transcript: "", notes: "" });
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <div>
        {meetings.length === 0 ? (
          <Empty title="No meetings recorded">Partner meetings and ICs you record become searchable institutional memory for the Fund Brain.</Empty>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Meeting</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 font-medium">Company</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} id={m.id} className="border-t border-line">
                  <td className="num py-2 pr-3 text-ink-3">{date(m.heldAt)}</td>
                  <td className="py-2 pr-3">
                    {m.title}
                    {m.hasTranscript && <span className="ml-2 text-[11.5px] text-ink-3">transcript</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{titleCase(m.kind)}</td>
                  <td className="py-2 text-ink-2">{companies.find((c) => c.id === m.companyId)?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canWrite && (
        <div className="space-y-3">
          <div className="t-eyebrow">Record a meeting</div>
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
              <option value="IC">IC</option>
              <option value="PARTNER_MEETING">Partner meeting</option>
            </select>
            <input type="date" className={input} value={d.heldAt} onChange={(e) => setD({ ...d, heldAt: e.target.value })} />
          </div>
          <input className={input} placeholder="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          <select className={input} value={d.companyId} onChange={(e) => setD({ ...d, companyId: e.target.value })}>
            <option value="">Company discussed (optional)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <textarea rows={8} className={area} placeholder="Transcript (speaker-attributed if possible)" value={d.transcript} onChange={(e) => setD({ ...d, transcript: e.target.value })} />
          <label className="block text-[12px] text-ink-3">
            or load a .txt file{" "}
            <input type="file" accept=".txt,.md,.vtt,.srt" className="text-[12px]" onChange={async (e) => e.target.files?.[0] && setD({ ...d, transcript: await e.target.files[0].text() })} />
          </label>
          <textarea rows={3} className={area} placeholder="Notes / decision" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          <Button variant="primary" onClick={add} disabled={busy || !d.title}>
            {busy ? "Saving and extracting…" : "Save meeting"}
          </Button>
          {!hasMembers && <p className="text-[12px] text-ink-3">Add IC members first to extract their observations.</p>}
          {msg && <p className="text-[12.5px] text-ink-2">{msg}</p>}
        </div>
      )}
    </div>
  );
}
