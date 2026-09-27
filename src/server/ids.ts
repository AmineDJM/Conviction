import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const gen = customAlphabet(alphabet, 16);

export const newId = (prefix: string) => `${prefix}_${gen()}`;
export const nowIso = () => new Date().toISOString();

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "company"
  );
}

export function normName(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|ltd|llc|gmbh|sas|sa|ag|bv|corp|co|limited|technologies|labs|ai|hq)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Sequential readable ids inside the canonical object (CLM-001, SRC-004…). */
export function seqIdFactory(prefix: string, existing: string[], width = 3) {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return () => `${prefix}-${String(++max).padStart(width, "0")}`;
}
