/**
 * Identity-bearing domain of a company website (pure). Shared by the Fund Brain
 * entity resolution (brain/entities.ts) and company duplicate detection
 * (engine/company-match.ts), so both agree on what "same website" means:
 *   - subdomains fold onto the registrable domain (app.acme.io → acme.io; acme.co.uk kept whole);
 *   - hosting platforms keep the full host (acme.notion.site ≠ widgetly.notion.site);
 *   - profiles and link hubs (LinkedIn, Linktree, DocSend…) are not websites (null).
 */
export const SECOND_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "com.br", "co.in", "co.nz", "com.sg", "co.za", "com.mx", "com.cn", "co.kr", "com.tr", "co.il"]);
/** Hosting platforms and profiles where the registrable domain says nothing about identity. */
export const SHARED_HOSTS = ["github.io", "notion.site", "vercel.app", "netlify.app", "webflow.io", "carrd.co", "wixsite.com", "squarespace.com", "herokuapp.com", "pages.dev", "framer.website", "framer.ai", "super.site", "typedream.app", "softr.app", "bubbleapps.io", "glide.page", "substack.com", "medium.com", "blogspot.com", "wordpress.com"];
export const NOT_A_WEBSITE = ["linkedin.com", "twitter.com", "x.com", "crunchbase.com", "facebook.com", "instagram.com", "linktr.ee", "angel.co", "wellfound.com", "producthunt.com", "youtube.com", "docsend.com", "google.com", "drive.google.com"];

/** Identity-bearing domain of a company website (null for profiles, link hubs and unparseable values). */
export function websiteDomain(website: string | null | undefined): string | null {
  if (!website || !website.trim()) return null;
  let host: string;
  try {
    host = new URL(website.includes("://") ? website.trim() : `https://${website.trim()}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!host.includes(".")) return null;
  if (NOT_A_WEBSITE.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  if (SHARED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return host;
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join(".") : last2;
}
