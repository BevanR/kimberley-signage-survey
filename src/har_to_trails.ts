/**
 * Convert Trailforks HAR (with multiple activity-type RMS responses) to trails.json.
 * Activity flags: snowshoe/nordic_ski/summer_mtb from trail activitytypes; winter_fat_bike from
 * activitytypes (17) or, when Trailforks omits 17, from activitytype=17 RMS response where the trail
 * has full opacity and non-grey color (grey/dim = not fat bike).
 * Excludes: difficulty 12 (chairlifts/gondolas), downhill-ski-only (activitytypes "11" only).
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { decode } from "@googlemaps/polyline-codec";
import { config } from "./config";

const HAR_PATH = join(import.meta.dir, "..", "data", "www.trailforks.com.har");

const TARGET_ACTIVITIES = [1, 10, 13, 17];

const GREY_COLORS = ["#8a8679", "#999999", "#cccccc", "#888888", "#666666", "#333333"];

function isFatBikePrimaryInRms(props: { color?: string; opacity?: number }): boolean {
  const opacity = props.opacity ?? 1;
  const color = (props.color ?? "").toLowerCase();
  if (opacity < 0.9) return false;
  return !GREY_COLORS.some((g) => color === g.toLowerCase());
}

function parseActivityTypes(s: string | undefined): number[] {
  if (!s) return [];
  return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
}

function extractFromHar(har: {
  log?: {
    entries?: Array<{
      request?: { url?: string };
      response?: { content?: { text?: string } };
    }>;
  };
}): Array<{ data: { features?: Array<unknown> }; activityTypeFromUrl: number }> {
  const entries = har.log?.entries ?? [];
  const results: Array<{ data: { features?: Array<unknown> }; activityTypeFromUrl: number }> = [];
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
  activitytypes: number[];
  inActivityType17Primary: boolean;
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
    const features = (data.features ?? []) as Array<{ properties?: { type?: string; id?: number; name?: string; difficulty?: number; color?: string; activitytypes?: string; opacity?: number }; geometry?: { encodedpath?: string; simplepath?: string } }>;
    for (const f of features) {
      if (f.properties?.type !== "trail") continue;
      if (f.properties?.difficulty === 12) continue; // chairlifts/gondolas
      const id = f.properties?.id;
      if (id == null) continue;

      const coords = decodeGeometry(f.geometry ?? {});
      if (!coords || coords.length < 2) continue;

      const act = parseActivityTypes(f.properties?.activitytypes);
      const inActivityType17Primary =
        activityTypeFromUrl === 17 && isFatBikePrimaryInRms(f.properties ?? {});

      let rec = trailById.get(id);
      if (!rec) {
        rec = {
          id,
          name: f.properties?.name ?? "Unknown",
          geometry: { type: "LineString", coordinates: coords },
          difficulty: f.properties?.difficulty,
          color: f.properties?.color ?? "#333",
          activitytypes: act,
          inActivityType17Primary,
        };
        trailById.set(id, rec);
      } else {
        if (act.length > 0) rec.activitytypes = act;
        rec.inActivityType17Primary = rec.inActivityType17Primary || inActivityType17Primary;
      }
    }
  }

  const snowshoe = (act: number[]) => act.includes(10);
  const nordic_ski = (act: number[]) => act.includes(13);
  const summer_mtb = (act: number[]) => act.includes(1);
  const downhillOnly = (act: number[]) => act.length > 0 && act.every((a) => a === 11);
  const hasTarget = (act: number[]) => act.some((a) => TARGET_ACTIVITIES.includes(a));

  const trails = Array.from(trailById.values())
    .filter((t) => !downhillOnly(t.activitytypes))
    .filter((t) => hasTarget(t.activitytypes) || t.inActivityType17Primary)
    .map((t) => {
      const wfb = t.activitytypes.includes(17) || t.inActivityType17Primary;
      return {
        ...t,
        snowshoe: snowshoe(t.activitytypes),
        nordic_ski: nordic_ski(t.activitytypes),
        winter_fat_bike: wfb,
        summer_mtb: summer_mtb(t.activitytypes),
      };
    })
    .filter((t) => t.snowshoe || t.nordic_ski || t.winter_fat_bike || t.summer_mtb);

  const output = {
    type: "FeatureCollection" as const,
    features: trails.map((t) => ({
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
