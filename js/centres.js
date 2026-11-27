/* =========================================================
   centres.js: Evacuation Centres page
   Status chips, search, TA/type filters, sortable table, map
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  const D = await Data.loadAll(["district", "tas", "flood_zones", "rivers", "centres", "settlements"]);

  // How many villages have each centre as their nearest one
  const served = {};
  D.settlements.features.forEach(s => { const n = s.properties.nearest_centre; if (n) served[n] = (served[n] || 0) + 1; });
  const rows = D.centres.features.map(f => ({ ...f.properties, served: served[f.properties.name] || 0, f }));

  // ---- Map ----
  const map = MapCommon.createMap("centresMap", { basemap: "Light" });
  const bounds = MapCommon.addMask(map, D.district);
  L.geoJSON(D.flood_zones, { style: f => ({ ...MapCommon.floodZoneStyle(f), fillOpacity: 0.3 }), interactive: false }).addTo(map);
  L.geoJSON(D.rivers, { style: { ...MapCommon.riverStyle, weight: 1 }, interactive: false }).addTo(map);
  L.geoJSON(D.tas, { style: { ...MapCommon.taStyle, fill: false }, interactive: false }).addTo(map);
  const markers = {};
  const centreLayer = L.geoJSON(D.centres, {
    pointToLayer: MapCommon.centreMarker,
    onEachFeature: (f, l) => {
      markers[f.properties.id] = l;
      l.bindPopup(() => popup(f.properties));
      l.on("click", () => selectRow(f.properties.id, false));
    }
  }).addTo(map);
  map.fitBounds(bounds, { padding: [8, 8] });

  function popup(p) {
    return `<b>${escapeHTML(p.name)}</b><br>${escapeHTML(p.type)}, TA ${escapeHTML(p.ta)}<br>
      ${MapCommon.statusBadge(p.status)}<br><span class="muted">Exposure: ${escapeHTML(p.exposure)}</span><br>
      <a class="link" href="planning.html?centre=${encodeURIComponent(p.id)}">Plan evacuation to here</a>`;
  }

  // ---- Filters ----
  const state = { status: "All", q: "", ta: "All", type: "All", sort: "name", dir: 1, selected: null };
  const STATUSES = ["All", "Requires verification", "Potentially flood-exposed", "Verified suitable"];
  const chips = document.getElementById("statusChips");
  const renderChips = () => chips.innerHTML = STATUSES.map(s => `
    <button class="chip ${state.status === s ? "on" : ""}" data-status="${s}">${s === "All" ? "All centres" : s}
      <span class="count">${s === "All" ? rows.length : rows.filter(r => r.status === s).length}</span></button>`).join("");
  chips.addEventListener("click", e => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    state.status = b.dataset.status; renderChips(); render();
  });

  const fill = (id, values, label) => [...new Set(values)].sort().forEach(v =>
    document.getElementById(id).insertAdjacentHTML("beforeend", `<option value="${escapeHTML(v)}">${label}: ${escapeHTML(v)}</option>`));
  fill("centreTa", rows.map(r => r.ta), "TA");
  fill("centreType", rows.map(r => r.type), "Type");
  document.getElementById("centreSearch").addEventListener("input", e => { state.q = e.target.value.toLowerCase(); render(); });
  document.getElementById("centreTa").addEventListener("change", e => { state.ta = e.target.value; render(); });
  document.getElementById("centreType").addEventListener("change", e => { state.type = e.target.value; render(); });
  document.querySelectorAll("[data-sort]").forEach(b => b.addEventListener("click", () => {
    state.dir = state.sort === b.dataset.sort ? -state.dir : (b.dataset.sort === "served" ? -1 : 1);
    state.sort = b.dataset.sort; render();
  }));

  // ---- Table ----
  const body = document.getElementById("centreBody");
  function render() {
    const list = rows.filter(r =>
      (state.status === "All" || r.status === state.status) &&
      (state.ta === "All" || r.ta === state.ta) &&
      (state.type === "All" || r.type === state.type) &&
      (!state.q || r.name.toLowerCase().includes(state.q))
    ).sort((a, b) => (typeof a[state.sort] === "number" ? a[state.sort] - b[state.sort]
                                                       : String(a[state.sort]).localeCompare(String(b[state.sort]))) * state.dir);

    body.innerHTML = list.length ? list.map(r => `
      <tr data-id="${r.id}" tabindex="0" class="${state.selected === r.id ? "selected" : ""}">
        <td><b>${escapeHTML(r.name)}</b></td><td>${escapeHTML(r.ta)}</td><td>${escapeHTML(r.type)}</td>
        <td class="r">${r.served}</td><td>${MapCommon.statusBadge(r.status)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-state">No centres match these filters. Clear the search or choose "All centres".</td></tr>`;

    // Only matching centres stay on the map
    const ids = new Set(list.map(r => r.id));
    centreLayer.eachLayer(l => l.setStyle({ opacity: ids.has(l.feature.properties.id) ? 1 : 0, fillOpacity: ids.has(l.feature.properties.id) ? 1 : 0 }));
    document.getElementById("centreCount").textContent = `${list.length} of ${rows.length} shown`;
  }

  function selectRow(id, fly = true) {
    state.selected = id; render();
    const m = markers[id];
    if (fly) map.flyTo(m.getLatLng(), 14, { duration: 0.6 });
    m.openPopup();
    body.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }
  body.addEventListener("click", e => { const r = e.target.closest("tr[data-id]"); if (r) selectRow(r.dataset.id); });
  body.addEventListener("keydown", e => { const r = e.target.closest("tr[data-id]"); if (r && e.key === "Enter") selectRow(r.dataset.id); });

  renderChips(); render();
});
