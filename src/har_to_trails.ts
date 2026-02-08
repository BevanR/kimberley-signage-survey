/**
 * Convert Trailforks RMS GeoJSON to trails.json format.
 * Input: data/rms_response.json (single response) or data/www.trailforks.com.har (full HAR).
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { decode } from "@googlemaps/polyline-codec";
import { config } from "./config";

const DATA_DIR = join(import.meta.dir, "..", "data");
const RMS_JSON_PATH = join(DATA_DIR, "rms_response.json");
const HAR_PATH = join(DATA_DIR, "www.trailforks.com.har");

const FAT_BIKE_IDS = [6, 17];
const SKI_IDS = [11, 12, 13];

function parseActivityTypes(s: string | undefined): number[] {
  if (!s) return [];
  return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
}

function parseRmsJson(data: unknown): unknown[] {
  if (data && typeof data === "object" && "features" in data) return [data];
  if (Array.isArray(data)) return data;
  return [];
}

function extractFromHar(har: { log?: { entries?: Array<{ request?: { url?: string }; response?: { content?: { text?: string } } }> } }): unknown[] {
  const entries = har.log?.entries ?? [];
  const results: unknown[] = [];
  for (const e of entries) {
    const url = e.request?.url ?? "";
    if (url.includes("rms") && url.includes("format=geojson")) {
      const text = e.response?.content?.text;
      if (text) {
        try {
          results.push(JSON.parse(text));
        } catch {
          // skip
        }
      }
    }
  }
  return results;
}

function decodeGeometry(geom: { encodedpath?: string; simplepath?: string }): [number, number][] | null {
  const encoded = geom.encodedpath || geom.simplepath;
  if (!encoded || typeof encoded !== "string") return null;
  try {
    const decoded = decode(encoded, 5);
    return decoded.map(([lat, lon]) => [lon, lat] as [number, number]);
  } catch {
    return null;
  }
}

async function main() {
  let allRms: unknown[];
  try {
    const json = JSON.parse(await readFile(RMS_JSON_PATH, "utf-8"));
    allRms = parseRmsJson(json);
  } catch {
    try {
      const har = JSON.parse(await readFile(HAR_PATH, "utf-8"));
      allRms = extractFromHar(har);
    } catch {
      console.error("No input found. Either:\n  1. Save the RMS GeoJSON response to data/rms_response.json (DevTools → Network → rms?format=geojson → Copy response)\n  2. Or save HAR from the region page to data/www.trailforks.com.har");
      process.exit(1);
    }
  }
  if (allRms.length === 0) {
    console.error("No valid RMS GeoJSON in input.");
    process.exit(1);
  }

  type RmsFeature = { properties?: { type?: string; id?: number; name?: string; activitytypes?: string; difficulty?: number; color?: string }; geometry?: { encodedpath?: string; simplepath?: string } };
  const trailById = new Map<number, RmsFeature>();
  for (const rms of allRms) {
    if (typeof rms !== "object" || !("features" in rms)) continue;
    const features = (rms as { features: RmsFeature[] }).features;
    for (const f of features) {
      if (f.properties?.type !== "trail") continue;
      const id = f.properties?.id;
      if (id != null && !trailById.has(id)) trailById.set(id, f);
    }
  }
  const trails = Array.from(trailById.values());

  const output = {
    type: "FeatureCollection" as const,
    features: [] as Array<{ type: "Feature"; geometry: { type: "LineString"; coordinates: [number, number][] }; properties: { name: string; winter: boolean; ski_trails: boolean; difficulty?: number; color: string } }>,
  };

  for (const t of trails) {
    const coords = decodeGeometry(t.geometry ?? {});
    if (!coords || coords.length < 2) continue;

    const act = parseActivityTypes(t.properties?.activitytypes);
    const winter = act.some((id) => FAT_BIKE_IDS.includes(id));
    const skiTrails = act.some((id) => SKI_IDS.includes(id));

    output.features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        name: t.properties?.name ?? "Unknown",
        winter,
        ski_trails: skiTrails,
        difficulty: t.properties?.difficulty,
        color: t.properties?.color ?? "#333",
      },
    });
  }

  await mkdir(dirname(config.trails_path), { recursive: true });
  await writeFile(config.trails_path, JSON.stringify(output, null, 2));
  console.log(`Merged ${allRms.length} RMS response(s), wrote ${output.features.length} trails to ${config.trails_path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
