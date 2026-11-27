/* =========================================================
   layout.js: shared top bar, collapsible sidebar, footer,
   "About the data" dialog and toast messages.
   Written once and injected into every page.
   ========================================================= */

// Stops names coming from the data being run as HTML (XSS protection)
function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const fmt = (n) => Number(n).toLocaleString("en-GB");

const Layout = (() => {
  const NAV = [
    { id: "dashboard", label: "Dashboard",           href: "index.html",    icon: "grid" },
    { id: "map",       label: "Flood Risk Map",      href: "map.html",      icon: "pin" },
    { id: "centres",   label: "Evacuation Centres",  href: "centres.html",  icon: "home" },
    { id: "planning",  label: "Evacuation Planning", href: "planning.html", icon: "route" }
  ];

  const ICONS = {
    grid:  '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pin:   '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    home:  '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/>',
    menu:  '<path d="M4 6h16M4 12h16M4 18h16"/>',
    info:  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const icon = (name, cls = "icon") =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // Water-drop mark for the app logo
  const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3c5 6.5 9 11.6 9 16.2A9 9 0 0 1 7 19.2C7 14.6 11 9.5 16 3z" fill="#1d5fd1"/>
      <path d="M10.5 21.5c2 .9 3.6.9 5.5 0s3.6-.9 5.5 0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </svg>`;

  function render() {
    const page = document.body.dataset.page;
    const live = Data.isLive();

    document.body.insertAdjacentHTML("afterbegin", `
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="topbar">
        <button class="icon-btn" id="sidebarToggle" aria-label="Show or hide navigation">${icon("menu")}</button>
        ${LOGO}
        <div class="brand">
          <span class="app-title">Phalombe Flood Risk &amp; Evacuation Support</span>
          <span class="app-sub">Phalombe District, Malawi</span>
        </div>
        <span class="data-badge ${live ? "live" : ""}" id="dataBadge"
              title="${live ? "Data is loaded from the project backend" : "Real Phalombe layers with a provisional hazard analysis. Not yet from the backend."}">
          ${live ? "LIVE DATA" : "DEMO DATA"}
        </span>
      </header>
      <nav class="sidebar" id="sidebar" aria-label="Main">
        <div class="nav-links">
          ${NAV.map(n => `
            <a href="${n.href}" class="nav-link ${n.id === page ? "active" : ""}" ${n.id === page ? 'aria-current="page"' : ""}>
              ${icon(n.icon)}<span>${n.label}</span>
            </a>`).join("")}
        </div>
        <button class="about-btn" id="aboutBtn">${icon("info")}<span>About the data</span></button>
      </nav>`);

    document.body.insertAdjacentHTML("beforeend", `
      <footer class="footer">University prototype, decision-support only, not for live emergency use.</footer>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
      <dialog class="about" id="aboutDialog" aria-labelledby="aboutTitle">
        <button class="icon-btn about-close" id="aboutClose" aria-label="Close">${icon("close")}</button>
        <h2 id="aboutTitle">About the data</h2>
        <p>All layers show real Phalombe geography. They were taken from the official
           <strong>Phalombe District Basemap</strong> (DoDMA / UNDP, updated 20 February 2023) and
           georeferenced to WGS84. The result matches the geoBoundaries district outline to within about 4 m.</p>
        <table class="about-table">
          <tr><th>Rivers, roads, schools</th><td>OpenStreetMap (via the district basemap)</td></tr>
          <tr><th>Villages</th><td>Government of Malawi (via the district basemap)</td></tr>
          <tr><th>TA boundaries</th><td>National Statistics Office &amp; Department of Surveys, 2018</td></tr>
          <tr><th>Health facilities</th><td>Ministry of Health (via the district basemap)</td></tr>
          <tr><th>District outline</th><td>geoBoundaries gbOpen, MWI ADM2</td></tr>
        </table>
        <h3>How flood-risk zones were made</h3>
        <p>Multi-ring buffers around rivers and Lake Chilwa. <b>High</b> is within 150&nbsp;m of a river or 1&nbsp;km of the lake,
           <b>Medium</b> 150–400&nbsp;m or 1–2.5&nbsp;km, and <b>Low</b> 400–800&nbsp;m of a river.
           This is a provisional proxy, <em>not an official flood extent</em>. Replace it with the group's flood-risk layer when it is ready.</p>
        <h3>Evacuation centres</h3>
        <p>Schools are shown as <em>potential</em> centres only. None has been verified as safe. Each one keeps the status
           "Requires verification" until it is checked in the field. Distances are straight-line, not road routes.</p>
      </dialog>`);

    // Sidebar collapse (remembered between pages)
    let collapsed = false;
    try { collapsed = localStorage.getItem("sidebarCollapsed") === "1"; } catch (e) {}
    document.body.classList.toggle("sidebar-collapsed", collapsed);

    document.getElementById("sidebarToggle").addEventListener("click", () => {
      if (window.matchMedia("(max-width: 860px)").matches) {
        document.body.classList.toggle("sidebar-open");
      } else {
        const now = document.body.classList.toggle("sidebar-collapsed");
        try { localStorage.setItem("sidebarCollapsed", now ? "1" : "0"); } catch (e) {}
      }
      setTimeout(() => window.dispatchEvent(new Event("resize")), 220);   // Leaflet re-measures
    });

    const dlg = document.getElementById("aboutDialog");
    document.getElementById("aboutBtn").addEventListener("click", () => dlg.showModal());
    document.getElementById("aboutClose").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
  }

  // Animated count for the dashboard numbers (skipped if the user prefers reduced motion)
  function countUp(el, target) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(target); return; }
    const start = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min((t - start) / dur, 1);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  document.addEventListener("DOMContentLoaded", render);
  return { toast, countUp, icon };
})();
