"""
extract_basemap.py
------------------
Turns the official "Phalombe District Basemap - Malawi" (DoDMA / UNDP, updated 20-02-2023,
ArcMap vector PDF) into real GeoJSON layers in EPSG:4326.

Sources stated on the basemap itself:
  Roads, landuses, waterways : OpenStreetMap
  Populated places           : Government of Malawi
  Administrative borders     : National Statistics Office & Department of Surveys (2018)
  Health facilities          : Ministry of Health

Georeferencing: the PDF uses a geographic (lat/long) graticule. The 15°30'/15°40'/15°50'S and
35°30'/35°40'/35°50'E labels give a linear transform from page points to degrees. This was
checked against the independent geoBoundaries district outline: median offset ≈ 4 m.

Usage:  python extract_basemap.py <basemap.pdf> <geoBoundaries-MWI-ADM2.geojson> <out_dir>
Needs:  pip install pymupdf shapely
"""
import json, sys, math, re, os
import pymupdf
from shapely.geometry import shape, mapping, LineString, Point, MultiLineString, Polygon
from shapely.ops import unary_union, polygonize, linemerge

PDF, ADM2, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)

# ---- 1. Page points → longitude/latitude (from graticule label centres) ----
X0, XS = 52.28, 308.95     # x of 35°30'E, points per 10'
Y0, YS = 186.30, 309.00    # y of 15°30'S, points per 10'
def tf(x, y):
    return (round(35.5 + (x - X0) / XS / 6, 6), round(-(15.5 + (y - Y0) / YS / 6), 6))

page = pymupdf.open(PDF)[0]
drawings = page.get_drawings()
rgb = lambda c: tuple(round(v, 2) for v in (c or ()))

# Official district outline (independent source) used to clip everything
adm2 = json.load(open(ADM2))
district = shape(next(f for f in adm2["features"] if f["properties"]["shapeName"] == "Phalombe")["geometry"])
clip_area = district.buffer(0.004)   # ~400 m so features on the border are kept

# ---- 2. Line layers by stroke style (from the map key) ----
STYLES = {
    "rivers":          [((0.7, 0.85, 0.9), 0.96)],
    "roads_primary":   [((0.96, 0.56, 0.56), 2.88)],
    "roads_secondary": [((0.9, 0.9, 0.0), 1.68)],
    "roads_other":     [((0.88, 0.88, 0.88), 0.96)],
    "ta_lines":        [((0.31, 0.31, 0.31), 1.44)],
    "district_lines":  [((0.31, 0.31, 0.31), 4.08)],
}

def path_lines(d):
    """Split one PDF path into continuous polylines (curves approximated by their end points + controls)."""
    lines, cur = [], []
    for it in d["items"]:
        if it[0] == "l":
            a, b = it[1], it[2]
            pts = [a, b]
        elif it[0] == "c":
            a, b = it[1], it[4]
            pts = [it[1], it[2], it[3], it[4]]
        else:
            continue
        if cur and (abs(cur[-1].x - a.x) > 0.05 or abs(cur[-1].y - a.y) > 0.05):
            lines.append(cur); cur = []
        cur.extend(pts if not cur else pts[1:])
    if cur: lines.append(cur)
    return [LineString([tf(p.x, p.y) for p in l]) for l in lines if len(l) >= 2]

layers = {k: [] for k in STYLES}
for d in drawings:
    if d["type"] not in ("s", "fs"): continue
    key = (rgb(d.get("color")), round(d.get("width") or 0, 2))
    for name, styles in STYLES.items():
        if key in styles:
            layers[name].extend(path_lines(d))

def save(name, features):
    with open(f"{OUT}/{name}.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    print(f"{name}: {len(features)} features")

def line_features(lines, props):
    merged = linemerge(MultiLineString(lines)) if lines else None
    if merged is None: return []
    geoms = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    out = []
    for g in geoms:
        g = g.intersection(clip_area)
        if g.is_empty: continue
        parts = list(g.geoms) if hasattr(g, "geoms") else [g]
        for p in parts:
            if p.geom_type == "LineString" and p.length > 0.0005:
                out.append({"type": "Feature", "properties": dict(props),
                            "geometry": mapping(p.simplify(0.00005))})
    return out

rivers = line_features(layers["rivers"], {"source": "OpenStreetMap via DoDMA basemap"})
for i, f in enumerate(rivers): f["properties"]["id"] = f"R{i+1}"
save("rivers", rivers)

roads = []
for cls, key in [("Primary", "roads_primary"), ("Secondary", "roads_secondary"), ("Other", "roads_other")]:
    roads += line_features(layers[key], {"class": cls, "source": "OpenStreetMap via DoDMA basemap"})
save("roads", roads)

# ---- 3. Text labels ----
spans = []
for b in page.get_text("dict")["blocks"]:
    for li, l in enumerate(b.get("lines", [])):
        for s in l["spans"]:
            if s["text"].strip():
                spans.append({"text": s["text"], "size": round(s["size"], 1), "font": s["font"],
                              "color": s["color"], "bbox": s["bbox"], "line": (b["number"], li)})

GENERIC = re.compile(r"^(\([A-D]\)|((LEA|FP|F\.P|CCAP|Primary|Secondary|Community)\s*)*(School|CDSS|Primary|Secondary|Community|Hosp|Camp|Ref Camp|LEA|FP))$", re.I)

def label_groups(pred):
    """One label item per text line of the given style (joined later if a line is a generic suffix)."""
    lines = {}
    for s in spans:
        if pred(s):
            lines.setdefault(s["line"], []).append(s)
    items = []
    for g in lines.values():
        g.sort(key=lambda s: s["bbox"][0])
        text = g[0]["text"]
        for prev, s in zip(g, g[1:]):            # add a space where spans have a visible gap
            text += (" " if s["bbox"][0] - prev["bbox"][2] > 1.0 else "") + s["text"]
        text = re.sub(r"\s+", " ", text).strip()
        items.append({"text": text, "bbox": [min(s["bbox"][0] for s in g), min(s["bbox"][1] for s in g),
                                             max(s["bbox"][2] for s in g), max(s["bbox"][3] for s in g)]})
    return items

def neighbour(items, it, direction):
    """Line of the same style stacked directly above (-1) or below (+1) 'it'."""
    best = None
    for o in items:
        if o is it: continue
        overlap = min(o["bbox"][2], it["bbox"][2]) - max(o["bbox"][0], it["bbox"][0])
        gap = (it["bbox"][1] - o["bbox"][3]) if direction < 0 else (o["bbox"][1] - it["bbox"][3])
        if overlap > 0 and -7 <= gap <= 3.5 and (best is None or gap < best[0]):
            best = (gap, o)
    return best[1] if best else None

def full_label(items, it):
    """Join a matched line with stacked suffix lines (e.g. 'Mpoto' + 'Primary Community' + 'School')."""
    parts, top, bottom = [it["text"]], it, it
    while GENERIC.match(top["text"]):            # matched a suffix: climb to the real name
        up = neighbour(items, top, -1)
        if not up or up["text"] in parts: break
        parts.insert(0, up["text"]); top = up
    while True:                                   # add generic suffix lines below
        down = neighbour(items, bottom, +1)
        if not down or down["text"] in parts: break
        if GENERIC.match(down["text"]) and not re.search(r"(School|CDSS)$", bottom["text"]):
            parts.append(down["text"]); bottom = down
        else:
            break
    return " ".join(parts)

def rect_dist(px, py, bbox):
    dx = max(bbox[0] - px, 0, px - bbox[2]); dy = max(bbox[1] - py, 0, py - bbox[3])
    return math.hypot(dx, dy)

def match_labels(points, labels, max_d):
    """Greedy nearest matching of symbol points to their labels."""
    pairs = sorted(((rect_dist(px, py, lb["bbox"]) + (6 if GENERIC.match(lb["text"]) else 0), i, j)
                    for i, (px, py) in enumerate(points) for j, lb in enumerate(labels)
                    if rect_dist(px, py, lb["bbox"]) < max_d))
    used_p, used_l, res = set(), set(), {}
    for d, i, j in pairs:
        if i in used_p or j in used_l: continue
        used_p.add(i); used_l.add(j); res[i] = full_label(labels, labels[j])
    return res

# ---- 4. Villages: tiny black dots + 6 pt black labels ----
dots = []
for d in drawings:
    if d["type"] == "fs" and rgb(d.get("fill")) == (0, 0, 0) and d["rect"].width < 1.0:
        c = ((d["rect"].x0 + d["rect"].x1) / 2, (d["rect"].y0 + d["rect"].y1) / 2)
        if not any(abs(c[0] - e[0]) < 0.3 and abs(c[1] - e[1]) < 0.3 for e in dots):
            dots.append(c)
vlabels = label_groups(lambda s: s["size"] == 6.0 and s["font"] == "ArialMT" and s["color"] == 0)
vnames = match_labels(dots, vlabels, 14)
# Trading centres (bold 8.9 pt) are also populated places
tc_labels = label_groups(lambda s: s["size"] == 8.9 and s["font"] == "Arial-BoldMT" and s["color"] == 0)

settlements = []
for i, (x, y) in enumerate(dots):
    lon, lat = tf(x, y)
    if not district.contains(Point(lon, lat)) or i not in vnames: continue
    if len(re.sub(r"\(.*?\)", "", vnames[i]).strip()) < 3: continue   # label fragment, not a name
    settlements.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": {"name": vnames[i], "kind": "Village",
                                       "source": "Government of Malawi via DoDMA basemap"}})

# ---- 5. Schools and health facilities: ESRI marker glyphs ----
def glyphs(pred):
    return [((s["bbox"][0] + s["bbox"][2]) / 2, (s["bbox"][1] + s["bbox"][3]) / 2)
            for s in spans if s["font"] == "ESRIDefaultMarker" and pred(s)]

def facilities(points, label_pred, ftype, source, max_d=30):
    labels = label_groups(label_pred)
    names = match_labels(points, labels, max_d)
    out = []
    for i, (x, y) in enumerate(points):
        lon, lat = tf(x, y)
        if not district.contains(Point(lon, lat)): continue
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {"name": names.get(i, f"Unnamed {ftype.lower()}"), "type": ftype,
                                   "source": source}})
    return out

primary   = facilities(glyphs(lambda s: s["text"] == "n" and s["color"] == 0xb8420d),
                       lambda s: s["size"] == 7.9 and s["color"] == 0xb8420d, "Primary school",
                       "OpenStreetMap via DoDMA basemap")
secondary = facilities(glyphs(lambda s: s["text"] == "n" and s["color"] == 0xa900e6),
                       lambda s: s["size"] == 7.9 and s["color"] == 0x8400a8, "Secondary school",
                       "OpenStreetMap via DoDMA basemap")
health    = facilities(glyphs(lambda s: s["text"] == "G" and s["color"] == 0xe60000),
                       lambda s: s["color"] == 0xe60000 and s["font"] == "ArialNarrow-Bold", "Health facility",
                       "Ministry of Health via DoDMA basemap")
# Manual QA corrections after checking the PDF visually
CORRECTIONS = {"Holy": "Holy Family CDSS", "Phalombe": "Phalombe District Hospital"}
for f in primary + secondary + health:
    n = f["properties"]["name"]
    if n in CORRECTIONS and (n != "Phalombe" or f["properties"]["type"] == "Health facility"):
        f["properties"]["name"] = CORRECTIONS[n]
save("facilities", primary + secondary + health)

# ---- 6. Traditional Authority polygons: polygonise TA lines + district outline ----
outline = district.boundary
noded = unary_union([l for l in layers["ta_lines"]] + [outline])
polys = [p for p in polygonize(noded) if p.area > 0.0003 and district.buffer(0.002).contains(p.representative_point())]
ta_labels = label_groups(lambda s: s["size"] == 9.8 and s["color"] == 0x4e4e4e)
ta_features = []
for p in polys:
    p = p.intersection(district)
    if p.is_empty or p.area < 0.0003: continue
    inside = [lb["text"] for lb in ta_labels
              if p.contains(Point(tf((lb["bbox"][0] + lb["bbox"][2]) / 2, (lb["bbox"][1] + lb["bbox"][3]) / 2)))]
    ta_features.append({"type": "Feature", "geometry": mapping(p.simplify(0.0002)),
                        "properties": {"name": inside[0] if inside else None, "labels_found": inside,
                                       "area_km2": None,
                                       "source": "NSO & Dept of Surveys (2018) via DoDMA basemap"}})
save("ta_raw", ta_features)

save("settlements_raw", settlements)
save("district", [{"type": "Feature", "geometry": mapping(district),
                   "properties": {"name": "Phalombe", "source": "geoBoundaries gbOpen MWI ADM2"}}])

# Water / wetland polygons (Lake Chilwa, Mpoto lagoon)
water = []
for d in drawings:
    if d["type"] == "f" and rgb(d.get("fill")) in [(0.75, 0.91, 1.0)] and d["rect"].width > 5:
        for poly_pts in [[it for it in d["items"] if it[0] == "l"]]:
            pts = [tf(it[1].x, it[1].y) for it in poly_pts]
            if len(pts) >= 3:
                g = Polygon(pts).buffer(0)
                g = g.intersection(clip_area.buffer(0.03))
                if not g.is_empty and g.area > 0.00002:
                    water.append({"type": "Feature", "geometry": mapping(g.simplify(0.0002)),
                                  "properties": {"type": "Water", "source": "OpenStreetMap via DoDMA basemap"}})
save("water", water)
