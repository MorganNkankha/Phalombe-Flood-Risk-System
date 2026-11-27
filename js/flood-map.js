/* =========================================================
   flood-map.js: Flood Risk Map page
   Layers, background maps, filters, search, details panel,
   spatial queries (location report, radius search)
   ========================================================= */
let map, D;                       // Leaflet map, all loaded data
const layers = {};                // one Leaflet layer per data set
const markerById = {};            // feature id → circle marker
const filters = { risk: "All", ta: "All" };
let highlight = L.layerGroup();   // selection graphics (line to centre, radius circle, ...)
let selectedMarker = null;

document.addEventListener("DOMContentLoaded", async () => {
  D = await Data.loadAll(["district", "tas", "flood_zones", "rivers", "roads", "water", "settlements", "centres", "health"]);

  map = MapCommon.createMap("floodMap", { basemap: "Light" });
  const districtBounds = MapCommon.addMask(map, D.district);
  map.districtBounds = districtBounds;

  // ---- Layers (bottom → top) ----
  layers.zones  = L.geoJSON(D.flood_zones, { style: MapCommon.floodZoneStyle, interactive: false });
  layers.water  = L.geoJSON(D.water, { style: MapCommon.waterStyle, interactive: false }).addTo(map);
  layers.roads  = L.geoJSON(D.roads, { style: MapCommon.roadStyle, interactive: false });
  layers.rivers = L.geoJSON(D.rivers, { style: MapCommon.riverStyle, interactive: false });
  layers.tas    = L.layerGroup([
    L.geoJSON(D.tas, { style: { ...MapCommon.taStyle, fill: false }, interactive: false }),
    MapCommon.addTaLabels(L.layerGroup(), D.tas)
  ]);
  layers.settlements = L.geoJSON(null, {
    pointToLayer: MapCommon.settlementMarker,
    onEachFeature: (f, l) => bindPoint(f, l, showSettlement)
  });
  layers.centres = L.geoJSON(D.centres, {
    pointToLayer: MapCommon.centreMarker,
    onEachFeature: (f, l) => bindPoint(f, l, showCentre)
  });
  layers.health = L.geoJSON(D.health, {
    pointToLayer: MapCommon.healthMarker,
    onEachFeature: (f, l) => bindPoint(f, l, showHealth)
  });

  ["zones", "roads", "rivers", "tas", "settlements"].forEach(k => layers[k].addTo(map));
  highlight.addTo(map);
  map.fitBounds(districtBounds, { padding: [10, 10] });

  // TA filter options
  const taSelect = document.getElementById("taFilter");
  D.tas.features.map(f => f.properties.name).sort().forEach(n =>
    taSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHTML(n)}">TA: ${escapeHTML(n)}</option>`));

  setupLayerPanel();
  setupFilters();
  setupSearch();
  setupMapEvents();
  showIntro();

  // Deep links from the dashboard: map.html?settlement=S001 or ?ta=Kaduya
  const q = new URLSearchParams(location.search);
  if (q.get("ta")) { taSelect.value = q.get("ta"); filters.ta = q.get("ta"); }
  applyFilters();
  if (q.get("settlement")) selectById(q.get("settlement"), true);
});

/* ---------- Points: tooltip, click → details ---------- */
function bindPoint(f, layer, showFn) {
  markerById[f.properties.id] = layer;
  layer.bindTooltip(escapeHTML(f.properties.name), { direction: "top", offset: [0, -4] });
  layer.on("click", () => { select(layer); showFn(f); });
}

function select(layer) {
  if (selectedMarker && selectedMarker !== layer) {
    const f = selectedMarker.feature, kind = f.properties.id[0];
    selectedMarker.setStyle(kind === "S" ? { radius: 4.5, color: "#fff", weight: 1.5 }
                                         : { radius: 5.5, color: "#fff", weight: 2 });
  }
  layer.setStyle({ radius: 8, color: "#1d5fd1", weight: 3 });
  layer.bringToFront();
  selectedMarker = layer;
}

function selectById(id, fly = false) {
  const kind = id[0];
  const fc = kind === "S" ? D.settlements : kind === "C" ? D.centres : D.health;
  const f = fc.features.find(x => x.properties.id === id);
  if (!f) { Layout.toast("That place isn't on the map."); return; }

  // make sure its layer is visible (and not hidden by filters)
  const key = kind === "S" ? "settlements" : kind === "C" ? "centres" : "health";
  if (!map.hasLayer(layers[key])) {
    layers[key].addTo(map);
    document.querySelector(`[data-layer="${key}"]`).checked = true;
  }
  if (kind === "S" && !markerById[id]) {
    filters.risk = filters.ta = "All";
    document.getElementById("riskFilter").value = "All";
    document.getElementById("taFilter").value = "All";
    applyFilters();
  }
  const m = markerById[id];
  select(m);
  if (fly) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 13), { duration: 0.7 });
  ({ S: showSettlement, C: showCentre, F: showHealth })[kind](f);
}

/* ---------- Layer checkboxes + background switcher ---------- */
function setupLayerPanel() {
  const panel = document.getElementById("layersPanel");
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  panel.querySelectorAll("input[data-layer]").forEach(box => box.addEventListener("change", () => {
    const layer = layers[box.dataset.layer];
    box.checked ? layer.addTo(map) : map.removeLayer(layer);
    ["settlements", "centres", "health"].forEach(k => map.hasLayer(layers[k]) && layers[k].bringToFront());
  }));

  panel.querySelectorAll("[data-basemap]").forEach(btn => btn.addEventListener("click", () => {
    panel.querySelectorAll("[data-basemap]").forEach(b => b.classList.toggle("on", b === btn));
    MapCommon.setBasemap(map, btn.dataset.basemap);
  }));
}

/* ---------- Risk + TA filters ---------- */
function setupFilters() {
  document.getElementById("riskFilter").addEventListener("change", e => { filters.risk = e.target.value; applyFilters(); });
  document.getElementById("taFilter").addEventListener("change", e => { filters.ta = e.target.value; applyFilters(true); });
  document.getElementById("resetBtn").addEventListener("click", () => {
    filters.risk = filters.ta = "All";
    document.getElementById("riskFilter").value = "All";
    document.getElementById("taFilter").value = "All";
    applyFilters();
    highlight.clearLayers();
    map.flyToBounds(map.districtBounds, { padding: [10, 10], duration: 0.6 });
    showIntro();
  });
  document.getElementById("exportBtn").addEventListener("click", exportCsv);
}

let taOutline = null;
function visibleSettlements() {
  return D.settlements.features.filter(f =>
    (filters.risk === "All" || f.properties.risk_class === filters.risk) &&
    (filters.ta === "All" || f.properties.ta === filters.ta));
}

function applyFilters(zoomToTa = false) {
  // Settlements: rebuild the layer with only the matching features
  layers.settlements.clearLayers();
  Object.keys(markerById).filter(k => k[0] === "S").forEach(k => delete markerById[k]);
  const vis = visibleSettlements();
  layers.settlements.addData({ type: "FeatureCollection", features: vis });
  selectedMarker = null;

  // Zones: show only the chosen class
  layers.zones.eachLayer(l => {
    const show = filters.risk === "All" || l.feature.properties.risk_class === filters.risk;
    l.setStyle(show ? MapCommon.floodZoneStyle(l.feature) : { fillOpacity: 0 });
  });

  // TA: outline it and zoom in
  if (taOutline) { map.removeLayer(taOutline); taOutline = null; }
  if (filters.ta !== "All") {
    const ta = D.tas.features.find(f => f.properties.name === filters.ta);
    taOutline = L.geoJSON(ta, { style: { color: "#1d5fd1", weight: 3, fill: false }, interactive: false }).addTo(map);
    if (zoomToTa || !map._loaded || true) map.flyToBounds(taOutline.getBounds(), { padding: [20, 20], duration: 0.6 });
  }

  const n = vis.length, exp = vis.filter(f => f.properties.in_risk_zone).length;
  document.getElementById("visibleCount").textContent = `${n} villages shown, ${exp} in risk zones`;
}

/* ---------- Search ---------- */
function setupSearch() {
  const input = document.getElementById("searchInput");
  const list = document.getElementById("suggestions");
  const index = [
    ...D.settlements.features.map(f => ({ id: f.properties.id, name: f.properties.name, sub: `Village, ${f.properties.ta}` })),
    ...D.centres.features.map(f => ({ id: f.properties.id, name: f.properties.name, sub: f.properties.type })),
    ...D.health.features.map(f => ({ id: f.properties.id, name: f.properties.name, sub: "Health facility" })),
    ...D.tas.features.map(f => ({ ta: f.properties.name, name: `TA ${f.properties.name}`, sub: "Traditional Authority" }))
  ];
  let matches = [], active = -1;

  const render = () => {
    list.innerHTML = matches.map((m, i) => `
      <li role="option" data-i="${i}" class="${i === active ? "active" : ""}" aria-selected="${i === active}">
        <span>${escapeHTML(m.name)}</span><small>${escapeHTML(m.sub)}</small></li>`).join("");
    list.hidden = !matches.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
  };

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    active = -1;
    matches = q ? index.filter(m => m.name.toLowerCase().includes(q))
                       .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
                       .slice(0, 10) : [];
    render();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { active = Math.min(active + 1, matches.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Escape") { list.hidden = true; }
    else if (e.key === "Enter") {
      const m = matches[active >= 0 ? active : 0];
      m ? choose(m) : Layout.toast("No place matches that search. Try part of the name.");
    }
  });
  list.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-i]");
    if (li) choose(matches[+li.dataset.i]);
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));

  function choose(m) {
    input.value = m.name;
    list.hidden = true;
    if (m.ta) {
      filters.ta = m.ta;
      document.getElementById("taFilter").value = m.ta;
      applyFilters(true);
    } else {
      selectById(m.id, true);
    }
  }
}

/* ---------- Map events: coordinates, location report, full screen ---------- */
function setupMapEvents() {
  const coords = document.getElementById("coords");
  map.on("mousemove", e => {
    coords.textContent = `${Math.abs(e.latlng.lat).toFixed(5)}° S, ${e.latlng.lng.toFixed(5)}° E`;
  });
  map.on("click", e => showLocationReport(e.latlng));

  const box = document.getElementById("mapBox");
  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else box.requestFullscreen?.().catch(() => Layout.toast("Full screen isn't available in this browser."));
  });
  document.addEventListener("fullscreenchange", () => setTimeout(() => map.invalidateSize(), 100));
}

/* ---------- Details panel views ---------- */
const panel = () => document.getElementById("detailsPanel");
const row = (k, v) => `<div class="detail-row"><span>${k}</span><span>${v}</span></div>`;

function showIntro() {
  const S = D.settlements.features;
  panel().innerHTML = `
    <div class="card-head"><h2 class="card-title">Settlement details</h2></div>
    <div class="empty-state">
      Select a village to see its flood-risk details and nearest potential evacuation centre.
      <ul>
        <li>Click a dot on the map, or search above</li>
        <li>Click anywhere else for a location report</li>
        <li>Use the filters to focus on one risk class or TA</li>
      </ul>
    </div>
    <div class="detail-rows">
      ${row("Villages mapped", S.length)}
      ${row("In flood-risk zones", S.filter(f => f.properties.in_risk_zone).length)}
      ${row("Potential centres", D.centres.features.length)}
    </div>`;
}

function showSettlement(f) {
  const p = f.properties;
  highlight.clearLayers();

  // Dashed line to the nearest suitable candidate centre
  const centre = D.centres.features.find(c => c.properties.name === p.nearest_centre && c.properties.status !== "Potentially flood-exposed");
  if (centre) {
    const [x1, y1] = f.geometry.coordinates, [x2, y2] = centre.geometry.coordinates;
    L.polyline([[y1, x1], [y2, x2]], { color: "#1d5fd1", weight: 2.5, dashArray: "6 6", interactive: false }).addTo(highlight);
    L.circleMarker([y2, x2], { radius: 8, color: "#1d5fd1", weight: 3, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(highlight);
  }

  const [lng, lat] = f.geometry.coordinates;
  panel().innerHTML = `
    <div class="card-head"><h2 class="card-title">Settlement details</h2></div>
    <span class="detail-kind">Village</span>
    <h3>${escapeHTML(p.name)}</h3>
    ${MapCommon.riskBadge(p.risk_class)}
    <div class="detail-rows">
      ${row("Traditional Authority", escapeHTML(p.ta))}
      ${row("In flood-risk zone", p.in_risk_zone ? "Yes" : "No")}
      ${row("Nearest centre", p.nearest_centre ? escapeHTML(p.nearest_centre) : "Not available")}
      ${row("Straight-line distance", p.nearest_centre_km != null ? `${p.nearest_centre_km.toFixed(2)} km` : "–")}
      ${row("Coordinates", `${Math.abs(lat).toFixed(4)}° S, ${lng.toFixed(4)}° E`)}
    </div>
    <div class="radius-tool">
      <label>Find villages within</label>
      <div class="seg" id="radiusSeg">
        ${[1, 2, 5, 10].map(k => `<button data-km="${k}">${k} km</button>`).join("")}
      </div>
      <div class="radius-result" id="radiusResult">Choose a distance to run a buffer query.</div>
    </div>
    <a class="btn btn-primary" href="planning.html?settlement=${encodeURIComponent(p.id)}">Plan evacuation</a>
    <p class="note">The nearest centre is the closest school outside High and Medium zones. It has not been verified as safe.</p>`;

  document.querySelectorAll("#radiusSeg button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#radiusSeg button").forEach(x => x.classList.toggle("on", x === b));
    radiusQuery(f, +b.dataset.km);
  }));
}

/* Buffer query: villages within k km of the selected village (Turf.js) */
let radiusLayer = null;
function radiusQuery(f, km) {
  if (radiusLayer) highlight.removeLayer(radiusLayer);
  const circle = turf.circle(f, km, { units: "kilometers", steps: 64 });
  const inside = D.settlements.features.filter(s => s !== f && turf.booleanPointInPolygon(s, circle));
  radiusLayer = L.layerGroup([
    L.geoJSON(circle, { style: { color: "#1d5fd1", weight: 1.5, fillColor: "#1d5fd1", fillOpacity: 0.07 }, interactive: false }),
    ...inside.map(s => L.circleMarker([s.geometry.coordinates[1], s.geometry.coordinates[0]],
      { radius: 6, color: "#1d5fd1", weight: 2, fill: false, interactive: false }))
  ]).addTo(highlight);
  map.flyToBounds(L.geoJSON(circle).getBounds(), { padding: [20, 20], duration: 0.5 });

  const c = { High: 0, Medium: 0, Low: 0 };
  inside.forEach(s => { if (s.properties.risk_class in c) c[s.properties.risk_class]++; });
  document.getElementById("radiusResult").innerHTML =
    `<b>${inside.length}</b> other villages within ${km} km: ${c.High} high, ${c.Medium} medium, ${c.Low} low risk.`;
}

function showCentre(f) {
  const p = f.properties;
  highlight.clearLayers();
  const served = D.settlements.features.filter(s => s.properties.nearest_centre === p.name);
  panel().innerHTML = `
    <div class="card-head"><h2 class="card-title">Centre details</h2></div>
    <span class="detail-kind">Potential evacuation centre</span>
    <h3>${escapeHTML(p.name)}</h3>
    ${MapCommon.statusBadge(p.status)}
    <div class="detail-rows">
      ${row("Type", escapeHTML(p.type))}
      ${row("Traditional Authority", escapeHTML(p.ta))}
      ${row("Flood exposure", escapeHTML(p.exposure))}
      ${row("Nearest centre for", `${served.length} villages`)}
    </div>
    <a class="btn btn-outline" href="planning.html?centre=${encodeURIComponent(p.id)}">Plan evacuation to this centre</a>
    <p class="note">Suitability, capacity and access need field verification before this school is used as a shelter.</p>`;
  served.forEach(s => L.circleMarker([s.geometry.coordinates[1], s.geometry.coordinates[0]],
    { radius: 6, color: "#1d5fd1", weight: 2, fill: false, interactive: false }).addTo(highlight));
}

function showHealth(f) {
  const p = f.properties;
  highlight.clearLayers();
  panel().innerHTML = `
    <div class="card-head"><h2 class="card-title">Facility details</h2></div>
    <span class="detail-kind">Health facility</span>
    <h3>${escapeHTML(p.name)}</h3>
    ${MapCommon.riskBadge(p.risk_class)}
    <div class="detail-rows">
      ${row("Traditional Authority", escapeHTML(p.ta))}
      ${row("Source", "Ministry of Health")}
    </div>`;
}

/* Location report: point-in-polygon + nearest-feature queries for any clicked point */
function showLocationReport(latlng) {
  if (selectedMarker) { select(selectedMarker); selectedMarker.setStyle({ radius: 4.5, color: "#fff", weight: 1.5 }); selectedMarker = null; }
  highlight.clearLayers();
  const pt = turf.point([latlng.lng, latlng.lat]);
  const inDistrict = MapCommon.featureAt(D.district, pt.geometry.coordinates);
  L.circleMarker(latlng, { radius: 6, color: "#0f172a", weight: 2, fillColor: "#fde047", fillOpacity: 1, interactive: false }).addTo(highlight);

  if (!inDistrict) {
    panel().innerHTML = `<div class="card-head"><h2 class="card-title">Location report</h2></div>
      <p class="empty-state">This point is outside Phalombe District. Click inside the district boundary.</p>`;
    return;
  }
  const ta = MapCommon.featureAt(D.tas, pt.geometry.coordinates);
  const zone = MapCommon.featureAt(D.flood_zones, pt.geometry.coordinates);
  const nearestVillage = turf.nearestPoint(pt, D.settlements);
  const usable = { type: "FeatureCollection", features: D.centres.features.filter(c => c.properties.status !== "Potentially flood-exposed") };
  const nearestCentre = turf.nearestPoint(pt, usable);
  const cls = zone ? zone.properties.risk_class : "None";

  panel().innerHTML = `
    <div class="card-head"><h2 class="card-title">Location report</h2></div>
    <span class="detail-kind">${Math.abs(latlng.lat).toFixed(5)}° S, ${latlng.lng.toFixed(5)}° E</span>
    <h3>${ta ? `TA ${escapeHTML(ta.properties.name)}` : "Phalombe District"}</h3>
    ${MapCommon.riskBadge(cls)}
    <div class="detail-rows">
      ${row("Hazard rule", zone ? escapeHTML(zone.properties.method) : "More than 800 m from rivers")}
      ${row("Nearest village", `${escapeHTML(nearestVillage.properties.name)}, ${MapCommon.distanceKm(pt, nearestVillage).toFixed(2)} km`)}
      ${row("Nearest potential centre", `${escapeHTML(nearestCentre.properties.name)}, ${MapCommon.distanceKm(pt, nearestCentre).toFixed(2)} km`)}
    </div>
    <p class="note">Computed in your browser with point-in-polygon and nearest-feature queries.</p>`;
}

/* ---------- Export visible settlements ---------- */
function exportCsv() {
  const rows = [["id", "name", "ta", "risk_class", "in_risk_zone", "nearest_centre", "nearest_centre_km", "latitude", "longitude"]];
  visibleSettlements().forEach(f => {
    const p = f.properties, [lng, lat] = f.geometry.coordinates;
    rows.push([p.id, p.name, p.ta, p.risk_class, p.in_risk_zone, p.nearest_centre ?? "", p.nearest_centre_km ?? "", lat, lng]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `phalombe_settlements_${filters.risk}_${filters.ta}.csv`.replace(/\s+/g, "_");
  a.click();
  URL.revokeObjectURL(a.href);
  Layout.toast(`Exported ${rows.length - 1} villages.`);
}
