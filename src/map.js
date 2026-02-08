const CENTER = [49.665, -115.99];
const ZOOM = 13;

function getStateFromUrl() {
  const p = new URLSearchParams(location.search);
  const z = p.get("z");
  const lat = p.get("lat");
  const lng = p.get("lng");
  return {
    zoom: z ? parseInt(z, 10) : null,
    center: lat && lng ? [parseFloat(lat), parseFloat(lng)] : null,
    minTc: p.get("minTc") ?? null,
    maxTc: p.get("maxTc") ?? null,
    minR: p.get("minR") ?? null,
    maxR: p.get("maxR") ?? null,
    winter: p.get("winter") ?? null,
    ski: p.get("ski") ?? null,
    summer: p.get("summer") ?? null,
  };
}

function pushStateToUrl() {
  const c = map.getCenter();
  const p = new URLSearchParams({
    z: String(map.getZoom()),
    lat: c.lat.toFixed(6),
    lng: c.lng.toFixed(6),
    minTc: document.getElementById("min-trail-count").value || "",
    maxTc: document.getElementById("max-trail-count").value || "",
    minR: document.getElementById("min-radius").value || "",
    maxR: document.getElementById("max-radius").value || "",
    winter: document.getElementById("show-winter").checked ? "1" : "0",
    ski: document.getElementById("show-ski").checked ? "1" : "0",
    summer: document.getElementById("show-summer").checked ? "1" : "0",
  });
  const url = `${location.pathname}?${p.toString()}`;
  history.replaceState(null, "", url);
}

const baseLayers = {
  topo: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }),
  satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "&copy; Esri",
  }),
};

const map = L.map("map", { center: CENTER, zoom: ZOOM });
baseLayers.topo.addTo(map);

L.control.layers(baseLayers, null, { position: "bottomright" }).addTo(map);

let trailsLayer = null;
let intersectionsLayer = null;
let allIntersections = null;
let allTrails = null;

function styleTrail(f) {
  return { color: f?.properties?.color ?? "#333", weight: 4 };
}

function minRadiusMetersFor20px() {
  const center = map.getCenter();
  const p1 = map.latLngToContainerPoint(center);
  const p2 = L.point(p1.x + 20, p1.y);
  const latlng2 = map.containerPointToLatLng(p2);
  return Math.max(2, map.distance(center, latlng2));
}

function filterIntersection(f) {
  const tc = f.properties?.trail_count ?? 0;
  const r = f.properties?.radius_m ?? 0;
  const minTcInput = document.getElementById("min-trail-count").value;
  const minTc = minTcInput === "" ? -Infinity : parseInt(minTcInput, 10);
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
      const actualRadius = Math.max(2, f.properties?.radius_m ?? 5);
      const minRadius = minRadiusMetersFor20px();
      const radiusM = Math.max(actualRadius, minRadius);
      return L.circle(latlng, {
        radius: radiusM,
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

function filterTrail(f) {
  const winter = f.properties?.winter ?? false;
  const ski = f.properties?.ski_trails ?? false;
  const summer = !winter && !ski;
  const showWinter = document.getElementById("show-winter").checked;
  const showSki = document.getElementById("show-ski").checked;
  const showSummer = document.getElementById("show-summer").checked;
  return (winter && showWinter) || (ski && showSki) || (summer && showSummer);
}

function applyTrailFilters() {
  if (!allTrails) return;
  const filtered = {
    type: "FeatureCollection",
    features: allTrails.features.filter(filterTrail),
  };
  if (trailsLayer) map.removeLayer(trailsLayer);
  trailsLayer = L.geoJSON(filtered, { style: styleTrail });
  trailsLayer.addTo(map);
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
  allTrails = await trailsRes.json();
  allIntersections = await intersectionsRes.json();

  const state = getStateFromUrl();
  if (state.center && state.zoom != null) {
    map.setView(state.center, state.zoom);
  }
  if (state.minTc != null) document.getElementById("min-trail-count").value = state.minTc;
  if (state.maxTc != null) document.getElementById("max-trail-count").value = state.maxTc;
  if (state.minR != null) document.getElementById("min-radius").value = state.minR;
  if (state.maxR != null) document.getElementById("max-radius").value = state.maxR;
  if (state.winter != null) document.getElementById("show-winter").checked = state.winter === "1";
  if (state.ski != null) document.getElementById("show-ski").checked = state.ski === "1";
  if (state.summer != null) document.getElementById("show-summer").checked = state.summer === "1";

  ["min-trail-count", "max-trail-count", "min-radius", "max-radius"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => { applyFilters(); pushStateToUrl(); });
    document.getElementById(id).addEventListener("change", () => { applyFilters(); pushStateToUrl(); });
  });
  ["show-winter", "show-ski", "show-summer"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => { applyTrailFilters(); pushStateToUrl(); });
  });

  applyTrailFilters();
  applyFilters();
  pushStateToUrl();

  map.on("zoomend", () => { applyFilters(); pushStateToUrl(); });
  map.on("moveend", pushStateToUrl);

  if (!state.center || state.zoom == null) {
    const filteredForBounds = allIntersections.features.filter(filterIntersection);
    if (filteredForBounds.length > 0) {
      const bounds = L.geoJSON({ type: "FeatureCollection", features: filteredForBounds }).getBounds();
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
      pushStateToUrl();
    }
  }
}

main().catch(console.error);
