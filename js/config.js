/* =========================================================
   config.js: the only file you normally need to edit
   ========================================================= */
const APP_CONFIG = {
  // "bundle" = use the prepared real data in data/phalombe-data.js (works with no backend)
  // "api"    = load every layer from Member 3's Flask API (falls back to the bundle if a call fails)
  DATA_SOURCE: "bundle",

  // When Flask serves these files, "/api" works with no CORS setup.
  // If you open the HTML separately, use "http://127.0.0.1:5000/api" and enable flask-cors.
  API_BASE: "/api",

  // Flask endpoint for each layer (see README → API contract)
  ENDPOINTS: {
    district: "/district", tas: "/tas", flood_zones: "/flood-zones", rivers: "/rivers",
    roads: "/roads", water: "/water", settlements: "/settlements", centres: "/centres", health: "/health"
  },

  MAP_CENTER: [-15.69, 35.68],   // Phalombe District
  MAP_ZOOM: 10,

  RISK_COLORS: { High: "#d93a2b", Medium: "#f08c2a", Low: "#2e9e57", None: "#94a3b8" },
  RIVER_COLOR: "#3d85c6",

  // Background maps (loaded by the browser, need internet)
  BASEMAPS: {
    Streets:   { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 },
    Satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 },
    Terrain:   { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap contributors", maxZoom: 17 },
    Light:     { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "&copy; OpenStreetMap contributors &copy; CARTO", maxZoom: 19 }
  }
};
