/**
 * Document ingestion. Text is extracted deterministically where possible;
 * decks without a usable text layer are sent to the multimodal model as a file
 * or images. Page structure is preserved for citations ("p. 7").
 */
import JSZip from "jszip";
import { createHash } from "node:crypto";

export type DocKind = "PDF" | "PPTX" | "IMAGE" | "TEXT" | "OTHER";

export interface ExtractedPage {
  pageNo: number;
  text: string;
}

export interface ExtractedDocument {
  filename: string;
  mime: string;
  kind: DocKind;
  sha256: string;
  sizeBytes: number;
  pages: ExtractedPage[];
  /** True when the text layer is too thin to rely on (scanned / image deck). */
  needsVisual: boolean;
  /** Base64 payload for the model when visual understanding is needed. */
  visualPayload: { type: "file"; filename: string; dataUrl: string } | { type: "images"; dataUrls: string[] } | null;
}

export function detectKind(filename: string, mime: string): DocKind {
  const f = filename.toLowerCase();
  if (mime === "application/pdf" || f.endsWith(".pdf")) return "PDF";
  if (f.endsWith(".pptx") || mime.includes("presentationml")) return "PPTX";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(f)) return "IMAGE";
  if (mime.startsWith("text/") || /\.(txt|md|csv)$/.test(f)) return "TEXT";
  return "OTHER";
}

const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

async function extractPdf(buf: Buffer): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ pageNo: i + 1, text: clean(t) }));
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function slideText(xml: string): string {
  // Paragraph-aware: join runs within <a:p>, newline between paragraphs.
  const paras = xml.split(/<\/a:p>/);
  const lines: string[] = [];
  for (const p of paras) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]!));
    if (runs.length) lines.push(runs.join(""));
  }
  return lines.join("\n");
}

async function extractPptx(buf: Buffer): Promise<ExtractedPage[]> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/slide(\d+)/.exec(a)![1]) - Number(/slide(\d+)/.exec(b)![1]));
  const pages: ExtractedPage[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.file(name)!.async("string");
    const num = /slide(\d+)/.exec(name)![1];
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
    const notes = notesFile ? slideText(await notesFile.async("string")) : "";
    const body = slideText(xml);
    pages.push({ pageNo: i + 1, text: clean(notes ? `${body}\n\n[Speaker notes]\n${notes}` : body) });
  }
  return pages;
}

export async function extractDocument(filename: string, mime: string, buf: Buffer): Promise<ExtractedDocument> {
  const kind = detectKind(filename, mime);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  let pages: ExtractedPage[] = [];
  let visualPayload: ExtractedDocument["visualPayload"] = null;

  if (kind === "PDF") {
    try {
      pages = await extractPdf(buf);
    } catch {
      pages = [];
    }
  } else if (kind === "PPTX") {
    pages = await extractPptx(buf);
  } else if (kind === "TEXT") {
    pages = [{ pageNo: 1, text: clean(buf.toString("utf8")) }];
  } else if (kind === "IMAGE") {
    pages = [{ pageNo: 1, text: "" }];
  }

  const totalChars = pages.reduce((a, p) => a + p.text.length, 0);
  const avgChars = pages.length ? totalChars / pages.length : 0;
  const needsVisual = kind === "IMAGE" || (kind === "PDF" && (pages.length === 0 || avgChars < 120));
  if (needsVisual) {
    const b64 = buf.toString("base64");
    visualPayload =
      kind === "PDF"
        ? { type: "file", filename, dataUrl: `data:application/pdf;base64,${b64}` }
        : { type: "images", dataUrls: [`data:${mime || "image/png"};base64,${b64}`] };
  }
  return { filename, mime, kind, sha256, sizeBytes: buf.length, pages, needsVisual, visualPayload };
}

/** Render pages for the model with stable page markers used in citations. */
export function renderPagesForModel(docs: { filename: string; pages: ExtractedPage[] }[], maxChars = 90_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const d of docs) {
    parts.push(`### DOCUMENT: ${d.filename}`);
    for (const p of d.pages) {
      const block = `--- PAGE ${p.pageNo} ---\n${p.text || "[no text layer]"}`;
      if (used + block.length > maxChars) {
        parts.push(`--- [TRUNCATED: remaining pages omitted for budget] ---`);
        return parts.join("\n");
      }
      parts.push(block);
      used += block.length;
    }
  }
  return parts.join("\n");
}
