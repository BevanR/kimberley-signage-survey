const CENTER = [49.665, -115.99];
const ZOOM = 13;

const ACTIVITY_IDS = ["snowshoe", "nordic_ski", "winter_fat_bike", "summer_mtb"];

function getStateFromUrl() {
  const p = new URLSearchParams(location.search);
  const z = p.get("z");
  const lat = p.get("lat");
  const lng = p.get("lng");
  const state = {
    zoom: z ? parseInt(z, 10) : null,
    center: lat && lng ? [parseFloat(lat), parseFloat(lng)] : null,
    minTc: p.get("minTc") ?? null,
    maxTc: p.get("maxTc") ?? null,
    minR: p.get("minR") ?? null,
    maxR: p.get("maxR") ?? null,
  };
  for (const id of ACTIVITY_IDS) {
    state[id] = p.get(id) ?? null;
  }
  return state;
}

const DEFAULTS = { minTc: "2", maxTc: "", minR: "", maxR: "", snowshoe: "1", nordic_ski: "1", winter_fat_bike: "1", summer_mtb: "0" };

function pushStateToUrl() {
  const c = map.getCenter();
  const minTc = document.getElementById("min-trail-count").value || "";
  const maxTc = document.getElementById("max-trail-count").value || "";
  const minR = document.getElementById("min-radius").value || "";
  const maxR = document.getElementById("max-radius").value || "";

  const p = new URLSearchParams({
    z: String(map.getZoom()),
    lat: c.lat.toFixed(6),
    lng: c.lng.toFixed(6),
  });
  if (minTc !== DEFAULTS.minTc) p.set("minTc", minTc);
  if (maxTc !== DEFAULTS.maxTc) p.set("maxTc", maxTc);
  if (minR !== DEFAULTS.minR) p.set("minR", minR);
  if (maxR !== DEFAULTS.maxR) p.set("maxR", maxR);
  for (const id of ACTIVITY_IDS) {
    const val = document.getElementById(`show-${id.replace(/_/g, "-")}`)?.checked ? "1" : "0";
    if (val !== DEFAULTS[id]) p.set(id, val);
  }

  const url = p.toString() ? `${location.pathname}?${p.toString()}` : location.pathname;
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

function minRadiusMetersFor10px() {
  const center = map.getCenter();
  const p1 = map.latLngToContainerPoint(center);
  const p2 = L.point(p1.x + 10, p1.y);
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
      const minRadius = minRadiusMetersFor10px();
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
      const activities = ["snowshoe", "nordic_ski", "winter_fat_bike", "summer_mtb"]
        .filter((k) => p[k])
        .map((k) => k.replace(/_/g, " "))
        .join(", ");
      const photoList = Array.isArray(p.photos) ? p.photos : [];
      const photoGallery = photoList.length
        ? `<div class="intersection-photos"><div class="intersection-photos-scroll">${photoList
            .map(
              (fn) =>
                `<a href="./photos/${fn}" target="_blank" rel="noopener"><img src="./photos/${fn}" alt="${fn}"></a>`
            )
            .join("")}</div></div>`
        : "";
      layer.bindPopup(
        `Intersection ID: ${p.cluster_id ?? "—"}<br><strong>${p.trail_count} trails</strong><br>${names}<br>Activities: ${activities || "—"}<br>Radius: ${p.radius_m?.toFixed(1) ?? "?"} m${photoGallery ? `<br>${photoGallery}` : ""}`
      );
    },
  });
  intersectionsLayer.addTo(map);
}

function filterTrail(f) {
  for (const id of ACTIVITY_IDS) {
    const el = document.getElementById(`show-${id.replace(/_/g, "-")}`);
    if (el?.checked && f.properties?.[id] === true) return true;
  }
  return false;
}

function applyTrailFilters() {
  if (!allTrails) return;
  const filtered = {
    type: "FeatureCollection",
    features: allTrails.features.filter(filterTrail),
  };
  if (trailsLayer) map.removeLayer(trailsLayer);
  const visibleLayer = L.geoJSON(filtered, { style: styleTrail });
  const hoverLayer = L.geoJSON(filtered, {
    style: () => ({ color: "transparent", weight: 14 }),
    onEachFeature: (f, layer) => {
      const p = f.properties || {};
      const activities = ACTIVITY_IDS.filter((id) => p[id])
        .map((id) => id.replace(/_/g, " "))
        .join(", ");
      layer.bindTooltip(
        `<strong>${p.name || "Unknown"}</strong>${activities ? `<br>${activities}` : ""}`,
        { permanent: false, direction: "top", className: "trail-tooltip" }
      );
    },
  });
  trailsLayer = L.layerGroup([visibleLayer, hoverLayer]);
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
  if (state.minTc !== null && state.minTc !== undefined) document.getElementById("min-trail-count").value = state.minTc;
  if (state.maxTc !== null && state.maxTc !== undefined) document.getElementById("max-trail-count").value = state.maxTc;
  if (state.minR !== null && state.minR !== undefined) document.getElementById("min-radius").value = state.minR;
  if (state.maxR !== null && state.maxR !== undefined) document.getElementById("max-radius").value = state.maxR;
  for (const id of ACTIVITY_IDS) {
    const el = document.getElementById(`show-${id.replace(/_/g, "-")}`);
    if (el && state[id] !== null && state[id] !== undefined) el.checked = state[id] === "1";
  }

  ["min-trail-count", "max-trail-count", "min-radius", "max-radius"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => { applyFilters(); pushStateToUrl(); });
    document.getElementById(id).addEventListener("change", () => { applyFilters(); pushStateToUrl(); });
  });
  ACTIVITY_IDS.forEach((id) => {
    const el = document.getElementById(`show-${id.replace(/_/g, "-")}`);
    if (el) el.addEventListener("change", () => { applyTrailFilters(); pushStateToUrl(); });
  });

  document.getElementById("reset-filters").addEventListener("click", () => {
    document.getElementById("min-trail-count").value = DEFAULTS.minTc;
    document.getElementById("max-trail-count").value = DEFAULTS.maxTc;
    document.getElementById("min-radius").value = DEFAULTS.minR;
    document.getElementById("max-radius").value = DEFAULTS.maxR;
    for (const id of ACTIVITY_IDS) {
      const el = document.getElementById(`show-${id.replace(/_/g, "-")}`);
      if (el) el.checked = DEFAULTS[id] === "1";
    }
    applyTrailFilters();
    applyFilters();
    pushStateToUrl();
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
