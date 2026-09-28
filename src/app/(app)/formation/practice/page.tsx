import { requireSession } from "@/server/session";
import { listCompanies } from "@/server/repo";
import { Practice } from "@/components/formation/practice";

export const metadata = { title: "Practice · Formation" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function PracticePage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const ready = listCompanies(s.workspaceId).filter((c) => c.status === "READY" && c.currentVersionId);
  const cases = ready.map((c) => ({ id: c.id, name: c.name }));
  // `?case=` takes a company id or a deal slug (the command palette links from /deals/<slug>).
  const raw = one(sp.case);
  const slugOf = (x: string) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  const caseId = raw ? (ready.find((c) => c.id === raw) ?? ready.find((c) => c.slug === raw || c.slug === slugOf(raw)))?.id ?? null : null;
  const expert = one(sp.expert);
  return <Practice cases={cases} initial={{ caseId, kind: one(sp.kind), drill: one(sp.drill), expert: expert === "1" ? true : expert === "0" ? false : null }} />;
}
