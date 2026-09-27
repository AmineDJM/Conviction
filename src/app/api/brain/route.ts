import { z } from "zod";
import { apiSession } from "@/server/session";
import { askBrain } from "@/brain/chat";
import { getCompany } from "@/server/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  question: z.string().min(1).max(4000),
  threadId: z.string().nullable().optional(),
  contextSlug: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { question, threadId, contextSlug } = parsed.data;
  const ctx = contextSlug ? getCompany(s.workspaceId, contextSlug) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of askBrain({ workspaceId: s.workspaceId, userId: s.userId, question, threadId, contextCompanyId: ctx?.id ?? null, signal: req.signal })) send(ev);
      } catch (e) {
        send({ type: "error", message: (e as Error).message.slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
