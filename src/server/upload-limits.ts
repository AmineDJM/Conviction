/**
 * Request-size limits for upload routes. `req.formData()` / `req.json()` buffer the
 * whole body, so the size is enforced before: Content-Length above the cap is
 * refused at once, and a body without one (chunked) is read with a running count.
 */
export const MAX_UPLOAD_FILES = 20;

export class BodyLimitError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new BodyLimitError(`Upload exceeds ${mb(maxBytes)}`, 413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyLimitError(`Upload exceeds ${mb(maxBytes)}`, 413);
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Multipart body, at most `maxBytes` in total and `maxFiles` file parts. */
export async function readFormData(req: Request, maxBytes: number, maxFiles = MAX_UPLOAD_FILES): Promise<FormData> {
  const body = await readCapped(req, maxBytes);
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new BodyLimitError("Invalid multipart body", 400);
  }
  let files = 0;
  for (const [, v] of form.entries()) if (typeof v !== "string") files++;
  if (files > maxFiles) throw new BodyLimitError(`Too many files (at most ${maxFiles})`, 400);
  return form;
}

/** JSON body of at most `maxBytes`; null when it is not valid JSON. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const body = await readCapped(req, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

export const bodyLimitResponse = (e: BodyLimitError) => Response.json({ error: e.message }, { status: e.status });
