/**
 * Visual QA: logs in and screenshots key screens.
 *   npx tsx scripts/screenshot.ts [baseUrl] [outDir] [paths...]
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? "screenshots";
const paths = process.argv.slice(4);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1480, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', process.env.SEED_EMAIL ?? "partner@vuvp.example");
  await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? "conviction");
  await page.click("button");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const p of paths.length ? paths : ["/"]) {
    const [path, action] = p.split("|");
    await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120000 });
    if (action === "brain") {
      await page.keyboard.press("Control+j");
      await page.waitForTimeout(400);
    }
    const name = (path!.replace(/[/?=&]+/g, "_").replace(/^_/, "") || "home") + (action ? `_${action}` : "");
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    console.log("shot", name);
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
