/**
 * Fetch trail geometry and metadata from Trailforks.
 *
 * Strategy:
 * 1. If TRAILFORKS_APP_ID and TRAILFORKS_APP_SECRET env vars are set, try API (not implemented - requires API docs)
 * 2. Otherwise: Playwright - navigate to region page, extract trail data from the map.
 * 3. Fallback: Run extract.js manually in browser console on the region page, save output to data/trails.json
 */

import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { config } from "./config";

const REGION_URL = `https://www.trailforks.com/region/kimberley-${config.region_id}/`;

const EXTRACT_SCRIPT = `
() => {
  const result = { trails: [], source: null };
  const nextData = document.getElementById('__NEXT_DATA__');
  if (nextData && nextData.textContent) {
    try {
      const data = JSON.parse(nextData.textContent);
      result.source = 'next_data';
      if (data.props?.pageProps) {
        const props = data.props.pageProps;
        if (props.trails) result.trails = props.trails;
        else if (props.region?.trails) result.trails = props.region.trails;
        else if (props.region) result.trails = props.region.trails || [];
      }
    } catch (e) {}
  }
  if (result.trails.length === 0 && window.L) {
    const maps = document.querySelectorAll('.leaflet-container');
    maps.forEach((mapEl) => {
      const map = (mapEl as any)._leaflet_id && (window as any).L?.Map?.map?.(mapEl);
      if (map && map._layers) {
        Object.values(map._layers).forEach((layer: any) => {
          if (layer?.feature?.geometry?.coordinates) {
            result.trails.push({
              type: 'Feature',
              geometry: layer.feature.geometry,
              properties: layer.feature.properties || { name: layer.options?.name || 'Unknown' }
            });
          }
        });
        if (result.trails.length > 0) result.source = 'leaflet';
      }
    });
  }
  if (result.trails.length === 0) {
    const links = document.querySelectorAll('a[href*="/trails/"]');
    const seen = new Set();
    links.forEach((a) => {
      const href = a.getAttribute('href');
      const name = a.textContent?.trim();
      if (href && name && !seen.has(href)) {
        seen.add(href);
        result.trails.push({ name, url: href.startsWith('http') ? href : 'https://www.trailforks.com' + href, geometry: null });
      }
    });
    if (result.trails.length > 0) result.source = 'dom_links';
  }
  return result;
}
`;

async function fetchViaPlaywright(): Promise<{ trails: unknown[]; source: string | null }> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(REGION_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    const data = await page.evaluate(EXTRACT_SCRIPT);
    return data;
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.argv.includes("--print-snippet")) {
    const { readFile } = await import("fs/promises");
    const snippet = await readFile(new URL("./extract.js", import.meta.url), "utf-8");
    console.log("Run this in the browser console on", REGION_URL);
    console.log("Then copy the JSON output and save to data/trails.json\n");
    console.log(snippet);
    return;
  }

  console.log("Fetching trails from", REGION_URL);

  let trails: unknown[];
  let source: string | null;

  try {
    const result = await fetchViaPlaywright();
    trails = result.trails;
    source = result.source;
  } catch (err) {
    console.error("Playwright failed:", err);
    console.error("\nFallback: run 'bun run fetch_trails --print-snippet' and use extract.js in the browser console.");
    process.exit(1);
  }

  if (!trails || trails.length === 0) {
    console.error(
      "Could not extract trail data. Try running extract.js manually in the browser console on the region page, then save the output to data/trails.json"
    );
    process.exit(1);
  }

  console.log(`Extracted ${trails.length} trails (source: ${source})`);

  const output = {
    type: "FeatureCollection",
    features: Array.isArray(trails)
      ? trails.map((t: unknown) => {
          const tr = t as Record<string, unknown>;
          if (tr.type === "Feature" && tr.geometry) {
            return tr;
          }
          return {
            type: "Feature",
            geometry: tr.geometry || { type: "Point", coordinates: [0, 0] },
            properties: {
              name: tr.name || "Unknown",
              winter: tr.winter ?? false,
              ski_trails: tr.ski_trails ?? false,
              ...(typeof tr.properties === "object" && tr.properties ? (tr.properties as object) : {}),
            },
          };
        })
      : [],
  };

  await mkdir(dirname(config.trails_path), { recursive: true });
  await writeFile(config.trails_path, JSON.stringify(output, null, 2));
  console.log("Wrote", config.trails_path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
