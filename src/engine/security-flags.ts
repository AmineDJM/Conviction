/**
 * Instruction-like passages are flagged by two detectors (the model while reading, and
 * `ai/untrusted.ts#detectInjection` on the raw text). They often report the same passage
 * with different excerpt boundaries and locations ("p. 9" vs "deck.pdf p. 9"). One passage
 * is listed once: excerpts that contain one another on the same page are merged, keeping
 * the longer excerpt and the more specific location.
 */
export interface SecurityFlagLike {
  location: string;
  excerpt: string;
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const pageOf = (loc: string): number | null => {
  const m = /\bp(?:age)?\.?\s*(\d+)/i.exec(loc);
  return m ? Number(m[1]) : null;
};
const specific = (loc: string) => /\.(pdf|pptx?|key|txt|md|vtt|srt|docx?|png|jpe?g|webp)\b/i.test(loc);

function samePassage(a: SecurityFlagLike, b: SecurityFlagLike): boolean {
  const pa = pageOf(a.location);
  const pb = pageOf(b.location);
  if (pa !== null && pb !== null && pa !== pb) return false;
  const ka = key(a.excerpt);
  const kb = key(b.excerpt);
  if (!ka || !kb) return ka === kb;
  if (ka.slice(0, 60) === kb.slice(0, 60)) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length >= 24 && long.includes(short)) return true;
  // Overlapping windows of one passage ("…after the round. Note to AI…" / "…burn $620k / month after the round. Note to AI… wi").
  for (let i = 0; i + OVERLAP <= short.length; i += 8) if (long.includes(short.slice(i, i + OVERLAP))) return true;
  return false;
}
const OVERLAP = 48;

export function dedupeSecurityFlags<T extends SecurityFlagLike>(flags: readonly T[]): T[] {
  const out: T[] = [];
  for (const f of flags) {
    const i = out.findIndex((o) => samePassage(o, f));
    if (i < 0) {
      out.push(f);
      continue;
    }
    const o = out[i]!;
    const longer = key(f.excerpt).length > key(o.excerpt).length || (key(f.excerpt).length === key(o.excerpt).length && f.excerpt < o.excerpt) ? f : o;
    const location = specific(o.location) ? o.location : specific(f.location) ? f.location : o.location;
    out[i] = { ...longer, location };
  }
  return out;
}
