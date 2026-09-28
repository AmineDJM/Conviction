/** POST multipart {file} → DOCUMENTED knowledge extracted from a fund document (verbatim-verified). */
import { apiSession, canWrite } from "@/server/session";
import { importFundDocument } from "@/server/fund-brain";
import { BodyLimitError, bodyLimitResponse, readFormData } from "@/server/upload-limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  let form: FormData;
  try {
    form = await readFormData(req, 26 * 1024 * 1024, 1);
  } catch (e) {
    if (e instanceof BodyLimitError) return bodyLimitResponse(e);
    throw e;
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Add a document" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "Document exceeds 25 MB" }, { status: 400 });
  try {
    const r = await importFundDocument(s.workspaceId, s.userId, { filename: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
