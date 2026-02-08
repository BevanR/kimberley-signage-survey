/**
 * Convert HAR file (with Trailforks RMS response) to trails.json format.
 * Run after capturing network traffic from the Trailforks region page.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { decode } from "@googlemaps/polyline-codec";
import { config } from "./config";

const HAR_PATH = join(import.meta.dir, "..", "data", "www.trailforks.com.har");

const FAT_BIKE_IDS = [6, 17];
const SKI_IDS = [11, 12, 13];

function parseActivityTypes(s: string | undefined): number[] {
  if (!s) return [];
  return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
}

function extractRmsResponse(har: { log?: { entries?: Array<{ request?: { url?: string }; response?: { content?: { text?: string } } }> } }): unknown {
  const entries = har.log?.entries ?? [];
  for (const e of entries) {
    const url = e.request?.url ?? "";
    if (url.includes("rms") && url.includes("format=geojson")) {
      const text = e.response?.content?.text;
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          // skip
        }
      }
    }
  }
  return null;
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
  const har = JSON.parse(await readFile(HAR_PATH, "utf-8"));
  const rms = extractRmsResponse(har);
  if (!rms || typeof rms !== "object" || !("features" in rms)) {
    console.error("No RMS GeoJSON found in HAR. Ensure data/www.trailforks.com.har contains the Trailforks region page capture.");
    process.exit(1);
  }

  type RmsFeature = { properties?: { type?: string; name?: string; activitytypes?: string; difficulty?: number; color?: string }; geometry?: { encodedpath?: string; simplepath?: string } };
  const features = (rms as { features: RmsFeature[] }).features;
  const trails = features.filter((f) => f.properties?.type === "trail");

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
  console.log("Wrote", output.features.length, "trails to", config.trails_path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
