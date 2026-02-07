import { join } from "path";

const projectRoot = join(import.meta.dir, "..");

export const config = {
  photos_path: join(projectRoot, "photos"),
  clusters_path: join(projectRoot, "data", "clusters.json"),
  trails_path: join(projectRoot, "data", "trails.json"),
  intersections_geojson_path: join(projectRoot, "data", "intersections.geojson"),
  intersections_csv_path: join(projectRoot, "data", "intersections.csv"),
  cluster_threshold_m: 30,
  intersection_buffer_m: 30,
  region_id: 3023,
  fetch_delay_ms: 1500,
} as const;
