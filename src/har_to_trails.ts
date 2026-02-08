/**
 * Convert Trailforks HAR (with multiple activity-type RMS responses) to trails.json.
 * Activity support is derived from which RMS requests each trail appears in.
 * Trailforks filters by activitytype in the URL (1=MTB, 10=snowshoe, 13=nordic ski, 17=winter fat bike).
 * Requires: data/www.trailforks.com.har with RMS requests for snowshoe, nordic ski, winter fat bike, summer MTB.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { decode } from "@googlemaps/polyline-codec";
import { config } from "./config";

const DATA_DIR = join(import.meta.dir, "..", "data");
const HAR_PATH = join(DATA_DIR, "www.trailforks.com.har");

type RmsEntry = {
  data: { features?: Array<unknown> };
  activityTypeFromUrl: number;
};

function extractFromHar(har: {
  log?: {
    entries?: Array<{
      request?: { url?: string };
      response?: { content?: { text?: string } };
    }>;
  };
}): RmsEntry[] {
  const entries = har.log?.entries ?? [];
  const results: RmsEntry[] = [];
  for (const e of entries) {
    const url = e.request?.url ?? "";
    if (!url.includes("rms") || !url.includes("format=geojson")) continue;
    const m = url.match(/activitytype=(\d+)/);
    const activityTypeFromUrl = m ? parseInt(m[1], 10) : 0;
    const text = e.response?.content?.text;
    if (!text) continue;
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && "features" in data) {
        results.push({ data, activityTypeFromUrl });
      }
    } catch {
      // skip
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

type TrailRecord = {
  id: number;
  name: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  difficulty?: number;
  color: string;
  snowshoe: boolean;
  nordic_ski: boolean;
  winter_fat_bike: boolean;
  summer_mtb: boolean;
};

async function main() {
  let har: unknown;
  try {
    har = JSON.parse(await readFile(HAR_PATH, "utf-8"));
  } catch {
    console.error("No HAR found. Capture HAR from Trailforks region page with activity types: Snowshoe, Nordic ski, Winter fat bike, Summer MTB.\nSave as data/www.trailforks.com.har");
    process.exit(1);
  }

  const allRms = extractFromHar(har as Parameters<typeof extractFromHar>[0]);
  if (allRms.length === 0) {
    console.error("No RMS GeoJSON found. Ensure HAR includes rms?format=geojson requests.");
    process.exit(1);
  }

  const trailById = new Map<number, TrailRecord>();

  for (const { data, activityTypeFromUrl } of allRms) {
    const features = data.features ?? [];
    const snowshoe = activityTypeFromUrl === 10;
    const nordic_ski = activityTypeFromUrl === 13;
    const winter_fat_bike = activityTypeFromUrl === 17;
    const summer_mtb = activityTypeFromUrl === 1;

    for (const f of features) {
      if (f.properties?.type !== "trail") continue;
      const id = f.properties?.id;
      if (id == null) continue;

      const coords = decodeGeometry(f.geometry ?? {});
      if (!coords || coords.length < 2) continue;

      let rec = trailById.get(id);
      if (!rec) {
        rec = {
          id,
          name: f.properties?.name ?? "Unknown",
          geometry: { type: "LineString", coordinates: coords },
          difficulty: f.properties?.difficulty,
          color: f.properties?.color ?? "#333",
          snowshoe: false,
          nordic_ski: false,
          winter_fat_bike: false,
          summer_mtb: false,
        };
        trailById.set(id, rec);
      }
      rec.snowshoe = rec.snowshoe || snowshoe;
      rec.nordic_ski = rec.nordic_ski || nordic_ski;
      rec.winter_fat_bike = rec.winter_fat_bike || winter_fat_bike;
      rec.summer_mtb = rec.summer_mtb || summer_mtb;
    }
  }

  const output = {
    type: "FeatureCollection" as const,
    features: Array.from(trailById.values()).map((t) => ({
      type: "Feature" as const,
      geometry: t.geometry,
      properties: {
        name: t.name,
        difficulty: t.difficulty,
        color: t.color,
        snowshoe: t.snowshoe,
        nordic_ski: t.nordic_ski,
        winter_fat_bike: t.winter_fat_bike,
        summer_mtb: t.summer_mtb,
      },
    })),
  };

  await mkdir(dirname(config.trails_path), { recursive: true });
  await writeFile(config.trails_path, JSON.stringify(output, null, 2));
  const counts = { snowshoe: output.features.filter((f) => f.properties.snowshoe).length, nordic_ski: output.features.filter((f) => f.properties.nordic_ski).length, winter_fat_bike: output.features.filter((f) => f.properties.winter_fat_bike).length, summer_mtb: output.features.filter((f) => f.properties.summer_mtb).length };
  console.log(`Merged ${allRms.length} RMS response(s), wrote ${output.features.length} trails (snowshoe: ${counts.snowshoe}, nordic_ski: ${counts.nordic_ski}, winter_fat_bike: ${counts.winter_fat_bike}, summer_mtb: ${counts.summer_mtb})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
