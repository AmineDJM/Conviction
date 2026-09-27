import { Bullets, Section } from "@/components/ui";

const ENCRYPTION_LABEL: Record<string, string> = {
  DATA_ENCRYPTION_KEY: "AES-256-GCM, key from DATA_ENCRYPTION_KEY",
  SESSION_SECRET: "AES-256-GCM, key derived from SESSION_SECRET (set DATA_ENCRYPTION_KEY to use a dedicated key)",
  DEVELOPMENT: "AES-256-GCM with the development key — not for real data",
};

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-6">
      <div className="font-medium text-ink">{k}</div>
      <div className="text-ink-2">{children}</div>
    </div>
  );
}

/** What leaves the system, what never does, and where data lives. Facts only — mirrors the code paths in src/ai/openai.ts. */
export function DataPolicy({ model, embeddingModel, storage, encryption, database }: { model: string; embeddingModel: string; storage: { kind: string; where: string }; encryption: string; database: string }) {
  return (
    <Section eyebrow="Data policy" title="What is sent, what is kept, where it lives">
      <div className="divide-y divide-line border-y border-line text-[13px]">
        <Row k="Sent to OpenAI">
          <Bullets
            items={[
              <>Document text by page, and page images or the PDF itself when a deck has no usable text layer — via the Responses API ({model}) with <code className="font-mono text-[12px]">store: false</code>.</>,
              <>Research queries the model issues through the web-search tool, and the question plus retrieved workspace context when you ask the Fund Brain.</>,
              <>Founder-call notes and meeting transcripts you add, for structured extraction.</>,
              <>Retrieval chunks (deck pages, claims, memo sections, fund knowledge) for embeddings ({embeddingModel}); unchanged text is never re-embedded.</>,
            ]}
          />
        </Row>
        <Row k="Never sent">
          <Bullets items={["Passwords (stored only as scrypt hashes) and session tokens.", "Other workspaces' data — every query is scoped to one workspace.", "The audit log, member list, backups and exports."]} />
        </Row>
        <Row k="OpenAI retention">
          Responses are requested with <code className="font-mono text-[12px]">store: false</code>, so they are not kept for later retrieval. OpenAI&apos;s API data-usage terms apply (API data is not used for training by default; abuse-monitoring retention may apply unless your organization has zero data retention).
        </Row>
        <Row k="Documents at rest">
          {storage.kind === "local" ? "Persistent disk" : "Object storage"}: <span className="font-mono text-[12px]">{storage.where}</span>. Every file is encrypted before it is written ({ENCRYPTION_LABEL[encryption] ?? encryption}).
        </Row>
        <Row k="Database">
          SQLite on the persistent disk: <span className="font-mono text-[12px]">{database}</span>. It holds extracted page text, analyses, memory and the audit log; protect it with disk-level encryption (Render states that its disks are encrypted at rest).
        </Row>
        <Row k="Retention & deletion">
          Everything is kept until deleted. Deleting a deal (deal header → Delete, owners and partners) permanently removes its versions, documents, pages, memory, facts, chunks and stored files. Backups taken before the deletion age out with backup retention.
        </Row>
      </div>
    </Section>
  );
}
