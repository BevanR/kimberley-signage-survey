import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import ExifReader from "exifreader";
import distance from "@turf/distance";
import { point } from "@turf/helpers";
import ngeohash from "ngeohash";
import { config } from "./config";

type PhotoMeta = {
  filename: string;
  lat: number;
  lon: number;
  timestamp: string;
};

function parseExifTimestamp(tags: Record<string, unknown>): string {
  const exif = tags["exif"] as Record<string, unknown> | undefined;
  const dt = tags["DateTimeOriginal"] || tags["CreateDate"] || tags["DateTime"]
    || exif?.["DateTimeOriginal"] || exif?.["CreateDate"] || exif?.["DateTime"];
  if (!dt || typeof dt !== "object" || !("description" in dt)) return "";
  const desc = (dt as { description?: string }).description;
  if (!desc) return "";
  const m = desc.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return desc;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function extractGps(tags: Record<string, unknown>): { lat: number; lon: number } | null {
  const latTag = tags["GPSLatitude"];
  const lonTag = tags["GPSLongitude"];
  const latRef = tags["GPSLatitudeRef"];
  const lonRef = tags["GPSLongitudeRef"];

  if (!latTag || !lonTag) {
    const gps = tags["gps"] as Record<string, number> | undefined;
    if (gps?.Latitude != null && gps?.Longitude != null) {
      return { lat: gps.Latitude, lon: gps.Longitude };
    }
    return null;
  }

  const toDecimal = (tag: unknown): number | null => {
    if (!tag || typeof tag !== "object" || !("value" in tag)) return null;
    const v = (tag as { value: unknown }).value;
    if (Array.isArray(v) && v.length >= 3) {
      const [d, m, s] = v.map((x: { numerator?: number; denominator?: number }) =>
        typeof x === "object" && x && "numerator" in x && "denominator" in x
          ? (x.numerator as number) / (x.denominator as number)
          : Number(x)
      );
      return d + m / 60 + s / 3600;
    }
    return null;
  };

  const lat = toDecimal(latTag);
  const lon = toDecimal(lonTag);
  if (lat == null || lon == null) return null;

  const latSign = latRef && String((latRef as { value?: string }).value).toUpperCase() === "S" ? -1 : 1;
  const lonSign = lonRef && String((lonRef as { value?: string }).value).toUpperCase() === "W" ? -1 : 1;

  return { lat: lat * latSign, lon: lon * lonSign };
}

async function loadPhotoMeta(dir: string): Promise<PhotoMeta[]> {
  const files = await readdir(dir, { withFileTypes: true });
  const photos: PhotoMeta[] = [];

  for (const f of files) {
    if (!f.isFile()) continue;
    const ext = f.name.toLowerCase().slice(-4);
    if (ext !== ".jpg" && ext !== "jpeg" && !f.name.toLowerCase().endsWith(".heic")) continue;

    const buf = await readFile(join(dir, f.name));
    const tags = ExifReader.load(buf, { expanded: true }) as Record<string, unknown>;

    const gps = extractGps(tags);
    if (!gps) {
      console.warn(`Skipping ${f.name} (no GPS)`);
      continue;
    }

    photos.push({
      filename: f.name,
      lat: gps.lat,
      lon: gps.lon,
      timestamp: parseExifTimestamp(tags) || "",
    });
  }

  return photos;
}

function unionFind(n: number): { find: (i: number) => number; union: (i: number, j: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };
  return { find, union };
}

function singleLinkageCluster(photos: PhotoMeta[], thresholdM: number): number[][] {
  const n = photos.length;
  const uf = unionFind(n);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = distance(
        point([photos[i].lon, photos[i].lat]),
        point([photos[j].lon, photos[j].lat]),
        { units: "meters" }
      );
      if (dist <= thresholdM) uf.union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  return [...clusters.values()];
}

async function main() {
  const photos = await loadPhotoMeta(config.photos_path);
  if (photos.length === 0) {
    console.error("No photos found in", config.photos_path);
    process.exit(1);
  }

  const clusters = singleLinkageCluster(photos, config.cluster_threshold_m);

  const result = clusters.map((indices) => {
    const clusterPhotos = indices.map((i) => photos[i]);
    const centerLat = clusterPhotos.reduce((s, p) => s + p.lat, 0) / clusterPhotos.length;
    const centerLon = clusterPhotos.reduce((s, p) => s + p.lon, 0) / clusterPhotos.length;

    const center = point([centerLon, centerLat]);
    let radiusM = 0;
    const enriched = clusterPhotos.map((p) => {
      const d = distance(center, point([p.lon, p.lat]), { units: "meters" });
      radiusM = Math.max(radiusM, d);
      return {
        filename: p.filename,
        lat: p.lat,
        lon: p.lon,
        timestamp: p.timestamp,
        distance_from_center_m: Math.round(d * 100) / 100,
      };
    });

    const clusterId = `cluster_${ngeohash.encode(centerLat, centerLon, 6)}`;

    return {
      cluster_id: clusterId,
      center: { lat: centerLat, lon: centerLon },
      radius_m: Math.round(radiusM * 100) / 100,
      photos: enriched,
    };
  });

  await mkdir(dirname(config.clusters_path), { recursive: true });
  await writeFile(config.clusters_path, JSON.stringify({ clusters: result }, null, 2));
  console.log(`Wrote ${result.length} clusters to ${config.clusters_path}`);
}

main();