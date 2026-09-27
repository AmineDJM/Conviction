import { apiSession } from "@/server/session";
import { catalog, lexicalSearch, chunkItems } from "@/brain/retrieval";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const cat = catalog(s.workspaceId);
  const ql = q.toLowerCase();
  const companies = (q ? cat.filter((c) => c.name.toLowerCase().includes(ql) || (c.oneLiner ?? "").toLowerCase().includes(ql)) : cat)
    .slice(0, q ? 8 : 6)
    .map((c) => ({ slug: c.slug, name: c.name, oneLiner: c.oneLiner, status: c.status }));
  const evidence =
    q.length >= 3
      ? chunkItems(lexicalSearch(s.workspaceId, [q], { k: 6, kinds: ["CLAIM", "PAGE", "SECTION", "SOURCE"] }).map((h) => h.id)).map((c) => ({
          title: c.title,
          href: c.href,
          snippet: c.text.slice(0, 120),
        }))
      : [];
  return Response.json({ companies, evidence });
}
