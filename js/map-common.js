/* =========================================================
   map-common.js: Leaflet helpers shared by all map pages
   ========================================================= */
const MapCommon = (() => {
  const RISK_ORDER = { High: 0, Medium: 1, Low: 2, None: 3 };
  const riskColor = (c) => APP_CONFIG.RISK_COLORS[c] || APP_CONFIG.RISK_COLORS.None;

  /* Base map. preferCanvas draws vector layers on one canvas, so it stays fast with ~7,000 road segments. */
  function createMap(id, { basemap = "Light", ...opts } = {}) {
    const map = L.map(id, { preferCanvas: true, zoomSnap: 0.25, ...opts })
      .setView(APP_CONFIG.MAP_CENTER, APP_CONFIG.MAP_ZOOM);
    map.basemaps = {};
    for (const [name, b] of Object.entries(APP_CONFIG.BASEMAPS)) {
      map.basemaps[name] = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom });
    }
    map.basemaps[basemap].addTo(map);
    map.currentBasemap = basemap;
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
    return map;
  }

  function setBasemap(map, name) {
    map.removeLayer(map.basemaps[map.currentBasemap]);
    map.basemaps[name].addTo(map).bringToBack();
    map.currentBasemap = name;
  }

  /* Dims everything outside Phalombe: a world-sized polygon with the district cut out as a hole. */
  function addMask(map, district) {
    const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
    const holes = [];
    district.features.forEach(f => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(p => holes.push(p[0].map(([x, y]) => [y, x])));
    });
    L.polygon([world, ...holes], {
      stroke: false, fillColor: "#1e293b", fillOpacity: 0.28, interactive: false
    }).addTo(map);
    const outline = L.geoJSON(district, { style: { color: "#1e293b", weight: 2.5, fill: false }, interactive: false }).addTo(map);
    return outline.getBounds();
  }

  /* ---- Layer styles ---- */
  const floodZoneStyle = (f) => ({
    stroke: false, fillColor: riskColor(f.properties.risk_class), fillOpacity: 0.42
  });
  const riverStyle = { color: APP_CONFIG.RIVER_COLOR, weight: 1.6, opacity: 0.9 };
  const waterStyle = { color: "#7fb3e0", weight: 1, fillColor: "#a9cdee", fillOpacity: 0.9 };
  const roadStyle = (f) => f.properties.class === "Secondary"
    ? { color: "#b38600", weight: 2.2, opacity: 0.9 }
    : { color: "#8a8f98", weight: 0.8, opacity: 0.55 };
  const taStyle = { color: "#475569", weight: 1.4, dashArray: "5 4", fill: true, fillOpacity: 0 };

  const settlementMarker = (f, latlng) => L.circleMarker(latlng, {
    radius: 4.5, color: "#ffffff", weight: 1.5, fillColor: "#0f172a", fillOpacity: 1, bubblingMouseEvents: false
  });

  const centreMarker = (f, latlng) => L.circleMarker(latlng, {
    radius: 5.5, color: "#ffffff", weight: 2, bubblingMouseEvents: false,
    fillColor: f.properties.status === "Potentially flood-exposed" ? "#b4271b"
             : f.properties.status === "Verified suitable" ? "#2e9e57" : "#1d5fd1",
    fillOpacity: 1
  });

  const healthMarker = (f, latlng) => L.circleMarker(latlng, {
    radius: 5.5, color: "#ffffff", weight: 2, fillColor: "#be185d", fillOpacity: 1, bubblingMouseEvents: false
  });

  /* TA name labels placed at a point guaranteed to be inside each polygon */
  function addTaLabels(map, tas) {
    const group = L.layerGroup();
    tas.features.forEach(f => {
      const [x, y] = turf.pointOnFeature(f).geometry.coordinates;
      L.tooltip({ permanent: true, direction: "center", className: "ta-label", interactive: false })
        .setLatLng([y, x]).setContent(escapeHTML(f.properties.name)).addTo(group);
    });
    return group.addTo(map);
  }

  function riskBadge(cls, suffix = "") {
    const label = cls && cls !== "None" ? `${cls} risk` : "Outside mapped zones";
    return `<span class="risk-badge risk-${(cls || "none").toLowerCase()}">${label}${suffix}</span>`;
  }

  function statusBadge(status) {
    const cls = status === "Verified suitable" ? "ok" : status === "Potentially flood-exposed" ? "bad" : "warn";
    return `<span class="status-badge status-${cls}">${escapeHTML(status)}</span>`;
  }

  /* Point-in-polygon query: which feature of `fc` contains [lng, lat]? */
  function featureAt(fc, lngLat) {
    const pt = turf.point(lngLat);
    return fc.features.find(f => turf.booleanPointInPolygon(pt, f)) || null;
  }

  /* Straight-line distance in km between two GeoJSON points */
  const distanceKm = (a, b) => turf.distance(a, b, { units: "kilometers" });

  return {
    RISK_ORDER, riskColor, createMap, setBasemap, addMask, addTaLabels,
    floodZoneStyle, riverStyle, waterStyle, roadStyle, taStyle,
    settlementMarker, centreMarker, healthMarker,
    riskBadge, statusBadge, featureAt, distanceKm
  };
})();
