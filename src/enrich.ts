import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { config } from "./config";
import pointToLineDistance from "@turf/point-to-line-distance";
import { point, lineString } from "@turf/helpers";
import type { Feature, FeatureCollection, LineString } from "geojson";

type Cluster = {
  cluster_id: string;
  center: { lat: number; lon: number };
  radius_m: number;
  photos: { filename: string }[];
};

type TrailProps = { name?: string; snowshoe?: boolean; nordic_ski?: boolean; winter_fat_bike?: boolean; summer_mtb?: boolean };
type TrailFeature = Feature<LineString, TrailProps>;

async function main() {
  let clustersData: { clusters: Cluster[] };
  let trailsData: FeatureCollection;

  try {
    clustersData = JSON.parse(await readFile(config.clusters_path, "utf-8"));
  } catch {
    console.error(`Error: Could not read ${config.clusters_path}. Run cluster.ts first.`);
    process.exit(1);
  }

  try {
    trailsData = JSON.parse(await readFile(config.trails_path, "utf-8"));
  } catch {
    console.error(`Error: Could not read ${config.trails_path}. Run fetch_trails.ts first.`);
    process.exit(1);
  }

  const trails = (trailsData.features || []).filter(
    (f): f is TrailFeature => f.type === "Feature" && f.geometry?.type === "LineString"
  );

  const trailsWithCoords = trails.filter((t) => (t.geometry.coordinates?.length ?? 0) >= 2);
  if (trailsWithCoords.length === 0) {
    console.error("No trail geometry found. All trails have empty coordinates.");
    console.error("Capture HAR from the Trailforks region page with activity types: Snowshoe, Nordic ski, Winter fat bike, Summer MTB. Save as data/www.trailforks.com.har, then run: bun run har_to_trails");
    process.exit(1);
  }

  const features: Feature[] = [];
  const csvRows: string[][] = [["cluster_id", "trail_count", "trail_names", "snowshoe", "nordic_ski", "winter_fat_bike", "summer_mtb", "lat", "lon", "radius_m", "photos"]];

  for (const cluster of clustersData.clusters) {
    const bufferM = cluster.radius_m + config.intersection_buffer_m;
    const centerPt = point([cluster.center.lon, cluster.center.lat]);

    const intersecting: TrailFeature[] = [];
    for (const trail of trails) {
      const coords = trail.geometry.coordinates;
      if (coords.length < 2) continue;
      const line = lineString(coords as [number, number][]);
      const dist = pointToLineDistance(centerPt, line, { units: "meters" });
      if (dist <= bufferM) intersecting.push(trail);
    }

    const trailNames = intersecting.map((t) => t.properties?.name || "Unknown").filter(Boolean);
    const snowshoe = intersecting.some((t) => t.properties?.snowshoe === true);
    const nordic_ski = intersecting.some((t) => t.properties?.nordic_ski === true);
    const winter_fat_bike = intersecting.some((t) => t.properties?.winter_fat_bike === true);
    const summer_mtb = intersecting.some((t) => t.properties?.summer_mtb === true);

    if (intersecting.length === 0) {
      console.warn(`Warning: cluster ${cluster.cluster_id} has no intersecting trails`);
    }

    const photos = cluster.photos.map((p) => p.filename);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cluster.center.lon, cluster.center.lat] },
      properties: {
        cluster_id: cluster.cluster_id,
        trail_count: intersecting.length,
        trail_names: trailNames,
        snowshoe,
        nordic_ski,
        winter_fat_bike,
        summer_mtb,
        lat: cluster.center.lat,
        lon: cluster.center.lon,
        radius_m: cluster.radius_m,
        photos,
      },
    });

    csvRows.push([
      cluster.cluster_id,
      String(intersecting.length),
      trailNames.join("; "),
      String(snowshoe),
      String(nordic_ski),
      String(winter_fat_bike),
      String(summer_mtb),
      String(cluster.center.lat),
      String(cluster.center.lon),
      String(cluster.radius_m),
      photos.join("; "),
    ]);
  }

  const sorted = features
    .map((f, i) => ({ f, row: csvRows[i + 1] }))
    .sort((a, b) => (b.f.properties?.trail_count ?? 0) - (a.f.properties?.trail_count ?? 0));

  const sortedFeatures = sorted.map((s) => s.f);
  const sortedCsvRows = [csvRows[0], ...sorted.map((s) => s.row)];

  const geojson: FeatureCollection = { type: "FeatureCollection", features: sortedFeatures };
  await mkdir(dirname(config.intersections_geojson_path), { recursive: true });
  await writeFile(config.intersections_geojson_path, JSON.stringify(geojson, null, 2));
  await writeFile(config.intersections_csv_path, sortedCsvRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n"));

  console.log(`Wrote ${config.intersections_geojson_path}`);
  console.log(`Wrote ${config.intersections_csv_path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
