import { loadDeal } from "@/server/deal";
import { Section } from "@/components/ui";
import { InPageNav, NotComputed, Rule } from "@/components/deal/v2/kit";
import { LatentModules, RevealedBeyondPitch } from "@/components/deal/signals/latent-modules";

export const metadata = { title: "Signals" };

const LATENT_NAV = [
  { href: "#maturity", label: "Operating maturity" },
  { href: "#thinking", label: "Quality of thinking" },
  { href: "#metric-selection", label: "Metric selection" },
  { href: "#inflation", label: "Narrative inflation" },
  { href: "#missing", label: "Missing information" },
  { href: "#precision", label: "Precision" },
  { href: "#causal", label: "Causal understanding" },
  { href: "#ambition", label: "Ambition" },
  { href: "#efficiency", label: "Resource efficiency" },
  { href: "#disclosure", label: "Disclosure quality" },
];

export default async function SignalsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { version } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version.canonical;
  const lt = version.derived.latent ?? null;
  const docId = c.documents[0]?.id ?? null;

  return (
    <main className="mx-auto max-w-[1180px] space-y-12 px-4 py-8 sm:px-8">
      <InPageNav
        items={[
          { href: "#beyond", label: "Beyond the pitch" },
          // The module anchors exist only when the latent report was computed.
          ...(lt ? LATENT_NAV : []),
        ]}
      />

      <Section id="beyond" eyebrow="What the deck reveals beyond the pitch" title="What the presentation choices, omissions and definitions unintentionally show">
        <RevealedBeyondPitch c={c} lt={lt} slug={slug} docId={docId} />
      </Section>

      <Section eyebrow="Latent signal modules · secondary signals, never part of Operating Quality" title="Observable signals only — no psychology, no personality inference">
        {lt ? (
          <div className="space-y-4">
            <Rule>
              {lt.coverage.modulesAssessed} of {lt.coverage.modulesTotal} modules assessed · model-extracted latent signals {lt.coverage.latentSignalsAvailable ? "available" : "not available"} · deck forensics {lt.coverage.forensicsAvailable ? "available" : "not available"} · {lt.coverage.normalizedMetrics} normalized metrics · engine {lt.version}, peer group {lt.peerGroup}.
              {lt.coverage.notes.length > 0 && ` ${lt.coverage.notes.join(" ")}`}
            </Rule>
            <LatentModules lt={lt} slug={slug} docId={docId} />
          </div>
        ) : (
          <NotComputed what="The latent signal report" />
        )}
      </Section>
    </main>
  );
}
