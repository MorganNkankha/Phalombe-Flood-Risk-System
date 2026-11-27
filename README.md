# Phalombe Flood Risk & Evacuation Support System

COM413 Geospatial Computing group project: a web GIS that identifies settlements in flood-risk zones
in Phalombe District, Malawi, and supports evacuation planning to nearby potential evacuation centres.

> University prototype, decision-support only, not for live emergency use.

**Frontend:** HTML5, CSS3, JavaScript, Leaflet.js, plus Turf.js for in-browser spatial queries and Chart.js for charts.
**Data prep:** Python (PyMuPDF, Shapely, GeoPandas). **Backend (Member 3):** Flask serving GeoJSON.

---

## 1. Run it

Double-click **`index.html`**. It works with no server and no backend, because the data is bundled in `data/phalombe-data.js`.

Or run it as a local website:
```bash
python -m http.server 8000      # inside this folder → http://localhost:8000
```
All libraries are in `vendor/`, so the app runs offline. **Background maps (Streets, Satellite, Terrain, Light) need internet.**
Without it, every data layer still draws on a plain background.

---

## 2. Pages

| Page | What you can do |
|---|---|
| **Dashboard** (`index.html`) | Live summary counts, overview map with TA hover statistics, exposure-by-TA chart, highest-risk villages. Click a TA or a chart bar to open the map filtered to it |
| **Flood Risk Map** (`map.html`) | 7 toggleable layers, 4 background maps, risk and TA filters, search (villages, schools, health facilities, TAs), village details with the nearest centre drawn, **buffer query** (villages within 1/2/5/10 km), **location report** (click anywhere: TA, hazard class, nearest village, nearest centre), live coordinates, full screen, CSV export |
| **Evacuation Centres** (`centres.html`) | Status chips, search, TA and type filters, sortable table, map with popups. *Working starter for Member 4* |
| **Evacuation Planning** (`planning.html`) | Pick a village and a centre (or "nearest suitable"), straight-line preview, distance and walking time, checks for crossing High/Medium zones. *Working starter for Member 4* |

---

## 3. The data is real Phalombe data

All layers come from the official **Phalombe District Basemap – Malawi** (DoDMA / UNDP, updated 20 Feb 2023).
That basemap is an ArcMap vector PDF, so its geometry was extracted directly (`tools/extract_basemap.py`) and
georeferenced from its lat/long grid. It was then checked against the independent **geoBoundaries** district outline:
**median offset ≈ 4 m**.

| Layer | Features | Original source (as stated on the basemap) |
|---|---|---|
| District outline | 1 | geoBoundaries gbOpen MWI ADM2 |
| Traditional Authorities | 6 | NSO & Department of Surveys (2018) |
| Villages | 244 | Government of Malawi |
| Schools (potential centres) | 98 | OpenStreetMap |
| Health facilities | 11 | Ministry of Health |
| Rivers and streams | 424 | OpenStreetMap |
| Roads (main + other) | 2 classes | OpenStreetMap |
| Lake Chilwa / water | 2 | OpenStreetMap |

**Known limitations:** village and school names were read from map labels, so a few may be wrong or combined
(e.g. "Unnamed primary school" where no label could be matched). The GIS member should check them in QGIS.

---

## 4. Spatial analysis (`tools/analysis.py`)

1. **Reprojection** to UTM Zone 36S (EPSG:32736) so distances are in metres
2. **Multi-ring buffer analysis**: provisional hazard zones
   - High: ≤150 m from a river or ≤1 km from Lake Chilwa
   - Medium: 150–400 m, or 1–2.5 km from the lake
   - Low: 400–800 m from a river
3. **Overlay / difference**, so rings don't overlap (High takes priority)
4. **Spatial join (point-in-polygon)**: every village and school gets its TA and hazard class
5. **Nearest-feature analysis**: each village → closest school *outside* High/Medium zones
6. **Aggregation**: exposure statistics per TA

Results: **126 of 244 villages (52%)** fall in a hazard zone. **33 of 98 schools** are potentially flood-exposed.

⚠️ The zones are a **proxy based on distance to water, not an official flood extent.** No school has been verified
as a safe shelter. All have the status "Requires verification" or "Potentially flood-exposed".
If the group gets a better flood layer (e.g. DCCMS or past flood extents), swap it in and re-run the script.

In the browser, **Turf.js** runs further queries live: point-in-polygon (location report), buffer (radius search),
nearest point, and line-polygon intersection (planning checks).

Rebuild everything:
```bash
pip install pymupdf shapely geopandas pyogrio
python tools/extract_basemap.py basemap.pdf geoBoundaries-MWI-ADM2.geojson work/
python tools/analysis.py work/ data/geojson/
python tools/build_frontend_data.py
```
`data/phalombe.gpkg` holds every layer in one GeoPackage for QGIS and the backend.

---

## 5. Code structure

```
index.html  map.html  centres.html  planning.html
css/style.css          all styling (colours from the approved mockups)
js/config.js           ★ settings: data source, API URL, colours, background maps
js/data.js             loads every layer: Flask API or bundled data
js/layout.js           shared top bar, sidebar, footer, About dialog, toast
js/map-common.js       shared Leaflet helpers: base maps, district mask, styles, spatial helpers
js/dashboard.js | flood-map.js | centres.js | planning.js     one script per page
data/geojson/*.geojson  analysis output (EPSG:4326)
data/phalombe-data.js   same data bundled for offline use
data/phalombe.gpkg      GeoPackage for QGIS / Flask
tools/                  Python data pipeline
vendor/                 Leaflet 1.9.4, Turf 7.1, Chart.js 4.4
```

**How a page works:** `layout.js` injects the shared layout. The page script calls
`Data.loadAll([...])`, then builds Leaflet layers with `L.geoJSON(data, { style, pointToLayer, onEachFeature })`.
No numbers are hard-coded. Every count is computed from the data.

---

## 6. Connecting to the Flask backend (Member 3)

Set `DATA_SOURCE: "api"` in `js/config.js`. Each endpoint returns a GeoJSON FeatureCollection in **EPSG:4326**,
with the same property names as the files in `data/geojson/`.

| Endpoint | Layer file | Key properties |
|---|---|---|
| `/api/district` | district | name |
| `/api/tas` | tas | name, area_km2, settlements, exposed, high, medium, low, centres |
| `/api/flood-zones` | flood_zones | id, risk_class, area_km2, method |
| `/api/rivers` `/api/roads` `/api/water` | rivers, roads, water | class (roads) |
| `/api/settlements` | settlements | id, name, ta, risk_class, in_risk_zone, nearest_centre, nearest_centre_km |
| `/api/centres` | centres | id, name, ta, type, status, exposure |
| `/api/health` | health | id, name, ta, type, risk_class |

Minimal Flask app serving both the site and the API from the GeoPackage:
```python
import geopandas as gpd
from flask import Flask, Response, send_from_directory, abort

app = Flask(__name__, static_folder=".", static_url_path="")
LAYERS = {"district": "district", "tas": "tas", "flood-zones": "flood_zones", "rivers": "rivers",
          "roads": "roads", "water": "water", "settlements": "settlements", "centres": "centres", "health": "health"}

@app.route("/")
def home():
    return send_from_directory(".", "index.html")

@app.route("/api/<name>")
def layer(name):
    if name not in LAYERS: abort(404)
    gdf = gpd.read_file("data/phalombe.gpkg", layer=LAYERS[name])
    return Response(gdf.to_crs(4326).to_json(), mimetype="application/json")

if __name__ == "__main__":
    app.run(debug=True)
```
If a call fails, the site shows a message and uses the bundled copy, so the demo never shows a blank map.

---

## 7. Q&A preparation

- **Spatial problem:** which Phalombe villages lie in flood-prone areas, and where is the nearest place they could evacuate to?
- **Methods:** georeferencing, reprojection, multi-ring buffers, overlay, point-in-polygon spatial join,
  nearest-feature analysis, aggregation by TA, plus live buffer and point-in-polygon queries in the browser.
- **Why UTM for analysis but WGS84 for the web?** Buffers need metres. Leaflet displays EPSG:4326.
- **Why canvas rendering?** `preferCanvas: true` draws about 7,000 road segments on one canvas instead of thousands of SVG elements.
- **Security:** `escapeHTML()` stops names from the data being run as HTML (XSS).
- **Limitations:** proxy hazard zones, straight-line distances, label-derived names, unverified centres.

---

## 8. Git
```bash
git checkout -b frontend
git add .
git commit -m "Frontend: dashboard, flood risk map, real Phalombe data layers"
git push -u origin frontend
```
