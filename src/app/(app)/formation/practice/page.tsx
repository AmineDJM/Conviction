import { requireSession } from "@/server/session";
import { listCompanies } from "@/server/repo";
import { Practice } from "@/components/formation/practice";

export const metadata = { title: "Practice · Formation" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function PracticePage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const cases = listCompanies(s.workspaceId)
    .filter((c) => c.status === "READY" && c.currentVersionId)
    .map((c) => ({ id: c.id, name: c.name }));
  const expert = one(sp.expert);
  return <Practice cases={cases} initial={{ caseId: one(sp.case), kind: one(sp.kind), drill: one(sp.drill), expert: expert === "1" ? true : expert === "0" ? false : null }} />;
}
