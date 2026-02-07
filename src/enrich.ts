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

type TrailFeature = Feature<LineString, { name?: string; winter?: boolean; ski_trails?: boolean }>;

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

  const features: Feature[] = [];
  const csvRows: string[][] = [["cluster_id", "trail_count", "trail_names", "winter", "ski_trails", "lat", "lon", "radius_m", "photos"]];

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
    const winter = intersecting.some((t) => t.properties?.winter === true);
    const skiTrails = intersecting.some((t) => t.properties?.ski_trails === true);

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
        winter,
        ski_trails: skiTrails,
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
      String(winter),
      String(skiTrails),
      String(cluster.center.lat),
      String(cluster.center.lon),
      String(cluster.radius_m),
      photos.join("; "),
    ]);
  }

  const geojson: FeatureCollection = { type: "FeatureCollection", features };
  await mkdir(dirname(config.intersections_geojson_path), { recursive: true });
  await writeFile(config.intersections_geojson_path, JSON.stringify(geojson, null, 2));
  await writeFile(config.intersections_csv_path, csvRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n"));

  console.log(`Wrote ${config.intersections_geojson_path}`);
  console.log(`Wrote ${config.intersections_csv_path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
