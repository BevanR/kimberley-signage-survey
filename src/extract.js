/**
 * Run this in the browser console on https://www.trailforks.com/region/kimberley-3023/
 * Copy the output and save to data/trails.json
 */
(function () {
  const result = { type: "FeatureCollection", features: [] };

  const nextData = document.getElementById("__NEXT_DATA__");
  if (nextData && nextData.textContent) {
    try {
      const data = JSON.parse(nextData.textContent);
      const props = data.props?.pageProps;
      const trails = props?.trails || props?.region?.trails || props?.region?.trails || [];
      if (Array.isArray(trails)) {
        trails.forEach((t) => {
          if (t.geometry?.coordinates) {
            result.features.push({
              type: "Feature",
              geometry: t.geometry,
              properties: {
                name: t.title || t.name || "Unknown",
                winter: t.activities?.includes(17) || t.bikeId === 6,
                ski_trails: [11, 12, 13].some((id) => t.activities?.includes(id)),
              },
            });
          }
        });
      }
    } catch (e) {
      console.error("Parse error:", e);
    }
  }

  if (result.features.length === 0) {
    const seen = new Set();
    document.querySelectorAll('a[href*="/trails/"]').forEach((a) => {
      const href = a.getAttribute("href");
      const name = a.textContent?.trim();
      const path = href?.match(/\/trails\/([^/?#]+)/)?.[1];
      if (href && name && path && !seen.has(path)) {
        seen.add(path);
        result.features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: { name, winter: false, ski_trails: false, trailPath: path },
        });
      }
    });
  }

  console.log("Copy the output below to data/trails.json:");
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
