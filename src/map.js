const CENTER = [49.665, -115.99];
const ZOOM = 13;

const baseLayers = {
  topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  }),
  satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "&copy; Esri",
  }),
};

const map = L.map("map", { center: CENTER, zoom: ZOOM });
baseLayers.topo.addTo(map);

L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

let trailsLayer = null;
let intersectionsLayer = null;
let allIntersections = null;

function styleTrail() {
  return { color: "#333", weight: 2 };
}

function filterIntersection(f) {
  const tc = f.properties?.trail_count ?? 0;
  const r = f.properties?.radius_m ?? 0;
  const minTc = parseInt(document.getElementById("min-trail-count").value, 10);
  const maxTcInput = document.getElementById("max-trail-count").value;
  const maxTc = maxTcInput === "" ? Infinity : parseInt(maxTcInput, 10);
  const minRInput = document.getElementById("min-radius").value;
  const minR = minRInput === "" ? -Infinity : parseFloat(minRInput);
  const maxRInput = document.getElementById("max-radius").value;
  const maxR = maxRInput === "" ? Infinity : parseFloat(maxRInput);
  return tc >= minTc && tc <= maxTc && r >= minR && r <= maxR;
}

function applyFilters() {
  if (!allIntersections) return;
  const filtered = {
    type: "FeatureCollection",
    features: allIntersections.features.filter(filterIntersection),
  };
  if (intersectionsLayer) map.removeLayer(intersectionsLayer);
  intersectionsLayer = L.geoJSON(filtered, {
    pointToLayer: (f, latlng) => {
      const tc = f.properties?.trail_count ?? 1;
      const radius = Math.max(8, Math.min(24, tc * 4));
      return L.circleMarker(latlng, {
        radius,
        fillColor: "#e74c3c",
        color: "#c0392b",
        weight: 1,
        fillOpacity: 0.7,
      });
    },
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      const names = Array.isArray(p.trail_names) ? p.trail_names.join(", ") : p.trail_names || "";
      const photos = Array.isArray(p.photos) ? p.photos.length : 0;
      layer.bindPopup(
        `<strong>${p.trail_count} trails</strong><br>${names}<br>Radius: ${p.radius_m?.toFixed(1) ?? "?"} m<br>Photos: ${photos}`
      );
    },
  });
  intersectionsLayer.addTo(map);
}

async function main() {
  const [trailsRes, intersectionsRes] = await Promise.all([
    fetch("./data/trails.json"),
    fetch("./data/intersections.geojson"),
  ]);
  if (!trailsRes.ok || !intersectionsRes.ok) {
    console.error("Failed to load data");
    return;
  }
  const trails = await trailsRes.json();
  allIntersections = await intersectionsRes.json();

  trailsLayer = L.geoJSON(trails, {
    style: styleTrail,
  });
  trailsLayer.addTo(map);

  ["min-trail-count", "max-trail-count", "min-radius", "max-radius"].forEach((id) => {
    document.getElementById(id).addEventListener("input", applyFilters);
    document.getElementById(id).addEventListener("change", applyFilters);
  });

  applyFilters();

  const bounds = L.latLngBounds(
    trailsLayer.getBounds(),
    L.geoJSON(allIntersections).getBounds()
  );
  map.fitBounds(bounds, { padding: [20, 20] });
}

main().catch(console.error);
