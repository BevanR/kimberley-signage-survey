/**
 * Capture network requests from Trailforks region page using Playwright.
 * Outputs a JSON file with URLs and response bodies for analysis.
 */

import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

const TARGET_URL = "https://www.trailforks.com/region/kimberley-3023/";
const OUTPUT_PATH = join(import.meta.dir, "..", "data", "network_capture.json");

async function main() {
  const entries: Array<{ url: string; method: string; status: number; mimeType: string; body?: string }> = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("response", async (response) => {
    const url = response.url();
    const method = response.request().method();
    const status = response.status();

    const mimeType = response.headers()["content-type"] || "";
    const isJson = mimeType.includes("json") || url.includes("geojson") || url.includes("rms");

    if (!isJson || status !== 200) return;
    if (url.includes("chunk") || url.includes("hot-update")) return;

    try {
      const body = await response.text();
      if (body.length > 0 && body.length < 5_000_000) {
        entries.push({ url, method, status, mimeType, body });
      } else if (body.length > 0) {
        entries.push({ url, method, status, mimeType, body: `[truncated ${body.length} chars]` });
      }
    } catch {
      entries.push({ url, method, status, mimeType });
    }
  });

  console.log("Loading", TARGET_URL, "...");
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000);

  await browser.close();

  const harLike = {
    capturedAt: new Date().toISOString(),
    pageUrl: TARGET_URL,
    entryCount: entries.length,
    entries: entries.map((e) => ({
      url: e.url,
      method: e.method,
      status: e.status,
      mimeType: e.mimeType,
      bodyLength: e.body?.length ?? 0,
      body: e.body,
    })),
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(harLike, null, 2));
  console.log("Wrote", entries.length, "requests to", OUTPUT_PATH);

  const trailUrls = entries.filter((e) => e.url.includes("rms") || e.url.includes("geojson") || e.url.includes("trail"));
  console.log("\nTrail-related URLs:");
  trailUrls.forEach((e) => console.log(" ", e.url.slice(0, 120) + (e.url.length > 120 ? "..." : "")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
