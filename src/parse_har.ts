/**
 * Parse HAR file and extract RMS GeoJSON URLs and response bodies.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

const HAR_PATH = join(import.meta.dir, "..", "data", "www.trailforks.com.har");
const OUTPUT_PATH = join(import.meta.dir, "..", "data", "har_analysis.json");

async function main() {
  const har = JSON.parse(await readFile(HAR_PATH, "utf-8"));
  const entries = har.log?.entries ?? [];

  const rmsEntries = entries.filter((e: { request: { url: string } }) =>
    e.request?.url?.includes("rms") && e.request?.url?.includes("geojson")
  );

  const extracted = rmsEntries.map((e: { request: { url: string; method: string }; response: { status: number; content?: { text?: string; mimeType?: string } } }) => {
    const url = e.request.url;
    const body = e.response?.content?.text;
    return {
      url,
      method: e.request.method,
      status: e.response.status,
      mimeType: e.response?.content?.mimeType,
      bodyLength: body?.length ?? 0,
      body: body,
    };
  });

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify({ entryCount: extracted.length, entries: extracted }, null, 2));
  console.log("Found", extracted.length, "RMS GeoJSON requests");

  for (const e of extracted) {
    if (e.body && e.status === 200) {
      try {
        const data = JSON.parse(e.body);
        const outPath = join(import.meta.dir, "..", "data", "rms_response.json");
        await writeFile(outPath, JSON.stringify(data, null, 2));
        console.log("Saved full response to data/rms_response.json");
        console.log("Keys:", Object.keys(data));
        if (data.features) {
          console.log("Features:", data.features.length);
          if (data.features[0]) {
            console.log("Sample feature keys:", Object.keys(data.features[0]));
            console.log("Sample properties:", data.features[0].properties);
          }
        }
        break;
      } catch {
        console.log("Body is not JSON");
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
