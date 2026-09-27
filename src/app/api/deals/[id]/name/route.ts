import { apiSession } from "@/server/session";
import { getCompany } from "@/server/repo";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const c = getCompany(s.workspaceId, (await params).id);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ id: c.id, name: c.name, slug: c.slug });
}
