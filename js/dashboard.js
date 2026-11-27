/* =========================================================
   dashboard.js: summary numbers, overview map, TA chart,
   highlighted risk areas
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  const { district, tas, flood_zones, rivers, water, settlements, centres } =
    await Data.loadAll(["district", "tas", "flood_zones", "rivers", "water", "settlements", "centres"]);

  const S = settlements.features.map(f => f.properties);
  const C = centres.features.map(f => f.properties);
  const count = (arr, fn) => arr.filter(fn).length;

  /* ---------- 1. Summary numbers (computed, never typed in) ---------- */
  const exposed = count(S, p => p.in_risk_zone);
  const byClass = { High: 0, Medium: 0, Low: 0 };
  S.forEach(p => { if (p.risk_class in byClass) byClass[p.risk_class]++; });
  const needVerify = count(C, p => p.status === "Requires verification");
  const exposedCentres = count(C, p => p.status === "Potentially flood-exposed");

  Layout.countUp(document.getElementById("statSettlements"), S.length);
  Layout.countUp(document.getElementById("statExposed"), exposed);
  Layout.countUp(document.getElementById("statCentres"), C.length);
  Layout.countUp(document.getElementById("statVerify"), needVerify);
  setText("statSettlementsSub", `Villages across ${tas.features.length} Traditional Authorities`);
  setText("statExposedSub", `${Math.round(exposed / S.length * 100)}% of villages: ${byClass.High} high, ${byClass.Medium} medium, ${byClass.Low} low`);
  setText("statCentresSub", `Schools, ${exposedCentres} of them potentially flood-exposed`);
  setText("statVerifySub", "None verified as safe yet");

  /* ---------- 2. Overview map ---------- */
  const map = MapCommon.createMap("dashMap", { basemap: "Light", scrollWheelZoom: false });
  const bounds = MapCommon.addMask(map, district);
  L.geoJSON(flood_zones, { style: MapCommon.floodZoneStyle, interactive: false }).addTo(map);
  L.geoJSON(water, { style: MapCommon.waterStyle, interactive: false }).addTo(map);
  L.geoJSON(rivers, { style: { ...MapCommon.riverStyle, weight: 1.1 }, interactive: false }).addTo(map);

  // TA polygons: hover shows that TA's exposure, click opens the map filtered to it
  const hoverBox = document.getElementById("hoverInfo");
  const taLayer = L.geoJSON(tas, {
    style: MapCommon.taStyle,
    onEachFeature: (f, layer) => {
      layer.on("mouseover", () => {
        layer.setStyle({ weight: 3, color: "#1d5fd1", fillColor: "#1d5fd1", fillOpacity: 0.06 });
        const p = f.properties;
        hoverBox.hidden = false;
        hoverBox.innerHTML = `
          <h4>TA ${escapeHTML(p.name)}</h4>
          <div class="row"><span class="muted">Villages</span><b>${p.settlements}</b></div>
          <div class="row"><span class="muted">In risk zones</span><b>${p.exposed} (${p.settlements ? Math.round(p.exposed / p.settlements * 100) : 0}%)</b></div>
          <div class="row"><span class="muted">High risk</span><b>${p.high}</b></div>
          <div class="row"><span class="muted">Candidate centres</span><b>${p.centres}</b></div>
          <div class="row"><span class="muted">Area</span><b>${p.area_km2} km²</b></div>`;
      });
      layer.on("mouseout", () => { taLayer.resetStyle(layer); hoverBox.hidden = true; });
      layer.on("click", () => location.href = `map.html?ta=${encodeURIComponent(f.properties.name)}`);
    }
  }).addTo(map);
  MapCommon.addTaLabels(map, tas);

  L.geoJSON(settlements, {
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 2.2, stroke: false, fillColor: "#0f172a", fillOpacity: 0.75, interactive: false })
  }).addTo(map);
  map.fitBounds(bounds, { padding: [8, 8] });

  /* ---------- 3. Risk class card ---------- */
  const zoneArea = Object.fromEntries(flood_zones.features.map(f => [f.properties.risk_class, f.properties.area_km2]));
  document.getElementById("classRows").innerHTML = ["High", "Medium", "Low"].map(c => `
    <div class="class-row">
      <span class="swatch" style="background:var(--${c.toLowerCase()})"></span>
      <span>${c}</span>
      <b>${byClass[c]} villages</b>
      <span class="muted">${zoneArea[c] ?? "–"} km²</span>
    </div>`).join("");

  /* ---------- 4. Chart: exposure per TA ---------- */
  const taRows = tas.features.map(f => f.properties).sort((a, b) => b.exposed - a.exposed);
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  new Chart(document.getElementById("taChart"), {
    type: "bar",
    data: {
      labels: taRows.map(t => t.name),
      datasets: ["High", "Medium", "Low"].map(c => ({
        label: c, data: taRows.map(t => t[c.toLowerCase()]),
        backgroundColor: APP_CONFIG.RISK_COLORS[c], borderRadius: 3, barThickness: 18
      }))
    },
    options: {
      indexAxis: "y", maintainAspectRatio: false,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 600 },
      scales: {
        x: { stacked: true, grid: { color: "#eef1f5" }, ticks: { precision: 0 },
             title: { display: true, text: "Villages in risk zones" } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { weight: 600 } } }
      },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: { callbacks: { footer: (items) => {
          const t = taRows[items[0].dataIndex];
          return `${t.exposed} of ${t.settlements} villages exposed`;
        } } }
      },
      onClick: (e, els) => { if (els.length) location.href = `map.html?ta=${encodeURIComponent(taRows[els[0].index].name)}`; }
    }
  });

  /* ---------- 5. Highlighted risk areas ---------- */
  const top = settlements.features
    .filter(f => f.properties.in_risk_zone)
    .sort((a, b) => MapCommon.RISK_ORDER[a.properties.risk_class] - MapCommon.RISK_ORDER[b.properties.risk_class]
                    || a.properties.name.localeCompare(b.properties.name))
    .slice(0, 25);
  const tbody = document.getElementById("riskTableBody");
  tbody.innerHTML = top.map(f => {
    const p = f.properties;
    return `<tr data-id="${escapeHTML(p.id)}" tabindex="0">
      <td><b>${escapeHTML(p.name)}</b></td>
      <td>${escapeHTML(p.ta)}</td>
      <td class="r">${p.nearest_centre_km != null ? p.nearest_centre_km.toFixed(1) + " km" : "–"}</td>
      <td>${MapCommon.riskBadge(p.risk_class)}</td></tr>`;
  }).join("");
  const open = (row) => row && (location.href = `map.html?settlement=${encodeURIComponent(row.dataset.id)}`);
  tbody.addEventListener("click", e => open(e.target.closest("tr[data-id]")));
  tbody.addEventListener("keydown", e => { if (e.key === "Enter") open(e.target.closest("tr[data-id]")); });
});

function setText(id, value) { document.getElementById(id).textContent = value; }
