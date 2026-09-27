/**
 * GET /api/admin/export[?files=0]  (OWNER)
 * ZIP of every workspace table + original documents (decrypted). See src/server/export.ts.
 */
import { Readable } from "node:stream";
import { buildExport, ExportTooLargeError } from "@/server/export";
import { audit } from "@/server/repo";
import { requireRole } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  const includeFiles = new URL(req.url).searchParams.get("files") !== "0";
  try {
    const { zip, manifest, filename } = await buildExport(s.workspaceId, { includeFiles, exportedBy: s.email });
    audit(s.workspaceId, s.userId, "DATA_EXPORTED", undefined, `${Object.values(manifest.counts).reduce((a, b) => a + b, 0)} rows, ${manifest.documents.files} files${includeFiles ? "" : " (no files)"}`);
    const node = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } });
    return new Response(Readable.toWeb(node as Readable) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof ExportTooLargeError ? 413 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
