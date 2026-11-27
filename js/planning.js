/* =========================================================
   planning.js: Evacuation Planning page (starter)
   Straight-line preview + checks with Turf.js:
   distance, does the line cross High/Medium zones,
   is the destination inside a zone.
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  const D = await Data.loadAll(["district", "tas", "flood_zones", "rivers", "roads", "settlements", "centres"]);
  const byId = (fc, id) => fc.features.find(f => f.properties.id === id);

  // ---- Map ----
  const map = MapCommon.createMap("planMap", { basemap: "Streets" });
  const bounds = MapCommon.addMask(map, D.district);
  L.geoJSON(D.flood_zones, { style: MapCommon.floodZoneStyle, interactive: false }).addTo(map);
  L.geoJSON(D.roads, { style: MapCommon.roadStyle, interactive: false }).addTo(map);
  L.geoJSON(D.rivers, { style: MapCommon.riverStyle, interactive: false }).addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  map.fitBounds(bounds, { padding: [8, 8] });

  // ---- Form options ----
  const start = document.getElementById("startSelect");
  const dest = document.getElementById("destSelect");
  const byName = (a, b) => a.properties.name.localeCompare(b.properties.name);
  start.innerHTML = [...D.settlements.features].sort(byName).map(f =>
    `<option value="${f.properties.id}">${escapeHTML(f.properties.name)} (${escapeHTML(f.properties.ta)})</option>`).join("");
  dest.innerHTML = `<option value="nearest">Nearest suitable centre</option>` +
    [...D.centres.features].sort(byName).map(f =>
      `<option value="${f.properties.id}">${escapeHTML(f.properties.name)}${f.properties.status === "Potentially flood-exposed" ? " (flood-exposed)" : ""}</option>`).join("");

  // Arriving from the map: planning.html?settlement=S001 or ?centre=C001
  const q = new URLSearchParams(location.search);
  if (q.get("settlement") && byId(D.settlements, q.get("settlement"))) start.value = q.get("settlement");
  if (q.get("centre") && byId(D.centres, q.get("centre"))) dest.value = q.get("centre");

  document.getElementById("planForm").addEventListener("submit", e => { e.preventDefault(); plan(); });
  if (q.get("settlement") || q.get("centre")) plan();

  function plan() {
    const s = byId(D.settlements, start.value);
    let c;
    if (dest.value === "nearest") {
      const usable = { type: "FeatureCollection", features: D.centres.features.filter(f => f.properties.status !== "Potentially flood-exposed") };
      c = byId(D.centres, turf.nearestPoint(s, usable).properties.id);
    } else {
      c = byId(D.centres, dest.value);
    }

    const line = turf.lineString([s.geometry.coordinates, c.geometry.coordinates]);
    const km = turf.length(line, { units: "kilometers" });
    const serious = D.flood_zones.features.filter(z => z.properties.risk_class !== "Low");
    const crosses = serious.some(z => turf.booleanIntersects(line, z));
    const destZone = MapCommon.featureAt(D.flood_zones, c.geometry.coordinates);
    const startZone = MapCommon.featureAt(D.flood_zones, s.geometry.coordinates);

    // Draw
    routeLayer.clearLayers();
    const [sx, sy] = s.geometry.coordinates, [cx, cy] = c.geometry.coordinates;
    const pl = L.polyline([[sy, sx], [cy, cx]], { color: "#1d5fd1", weight: 4, dashArray: "8 7" }).addTo(routeLayer);
    L.circleMarker([sy, sx], { radius: 8, color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 })
      .bindTooltip(`Start: ${escapeHTML(s.properties.name)}`, { permanent: true, direction: "left", offset: [-8, 0] }).addTo(routeLayer);
    L.circleMarker([cy, cx], { radius: 9, color: "#fff", weight: 3, fillColor: "#1d5fd1", fillOpacity: 1 })
      .bindTooltip(`Centre: ${escapeHTML(c.properties.name)}`, { permanent: true, direction: "right", offset: [8, 0] }).addTo(routeLayer);
    map.flyToBounds(pl.getBounds(), { padding: [70, 70], maxZoom: 14, duration: 0.7 });

    // Results
    document.getElementById("distOut").textContent = `${km.toFixed(2)} km`;
    const mins = Math.round(km / 4 * 60);
    document.getElementById("walkOut").textContent =
      `Roughly ${mins} minutes on foot at 4 km/h in a straight line. Real paths are longer.`;

    const pill = (yes, yesText = "Yes", noText = "No") =>
      `<span class="pill ${yes ? "pill-yes" : "pill-no"}">${yes ? yesText : noText}</span>`;
    document.getElementById("checks").innerHTML = `
      <div class="check-row"><span>Starting point in a flood-risk zone</span>${startZone ? `<span class="pill pill-yes">${startZone.properties.risk_class}</span>` : pill(false)}</div>
      <div class="check-row"><span>Straight line crosses a High or Medium zone</span>${pill(crosses)}</div>
      <div class="check-row"><span>Destination in a flood-risk zone</span>${destZone ? `<span class="pill pill-yes">${destZone.properties.risk_class}</span>` : pill(false)}</div>
      <div class="check-row"><span>Road-network route</span><span class="pill pill-pending">Pending backend</span></div>`;

    document.getElementById("centreCard").innerHTML = `
      <span class="detail-kind">Selected centre</span>
      <h3 style="margin:2px 0 6px">${escapeHTML(c.properties.name)}</h3>
      ${MapCommon.statusBadge(c.properties.status)}
      <div class="detail-rows">
        <div class="detail-row"><span>Type</span><span>${escapeHTML(c.properties.type)}</span></div>
        <div class="detail-row"><span>Traditional Authority</span><span>${escapeHTML(c.properties.ta)}</span></div>
        <div class="detail-row"><span>Exposure</span><span>${escapeHTML(c.properties.exposure)}</span></div>
      </div>`;
  }
});
