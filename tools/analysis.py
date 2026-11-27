"""
analysis.py: preliminary flood-exposure analysis for Phalombe District
------------------------------------------------------------------------
Input : layers produced by extract_basemap.py (EPSG:4326)
Output: web-ready GeoJSON (EPSG:4326) + one GeoPackage for the backend

Spatial operations
  1. Reprojection to UTM 36S (EPSG:32736) so buffers and distances are in metres
  2. Multi-ring buffer analysis around rivers and Lake Chilwa → provisional hazard zones
  3. Overlay / dissolve: zones are made non-overlapping (High wins over Medium over Low)
  4. Spatial join (point-in-polygon): settlements & facilities ← TA and hazard class
  5. Nearest-feature analysis: each settlement → closest candidate centre outside High/Medium zones
  6. Aggregation: exposure statistics per Traditional Authority

IMPORTANT: the hazard zones are a PROXY based on distance to water. They are not an official
flood extent and should be replaced by Member 1's flood-risk layer (e.g. DCCMS climate risk map)
when it is available. Candidate centres are NOT verified shelters.

Usage: python analysis.py <in_dir> <out_dir>
"""
import sys, os, json
import geopandas as gpd
import pandas as pd

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
UTM, WGS = 32736, 4326

# Buffer distances in metres: (river, Lake Chilwa)
RINGS = {"High": (150, 1000), "Medium": (400, 2500), "Low": (800, None)}

read = lambda n: gpd.read_file(f"{IN}/{n}.geojson").to_crs(UTM)
district, rivers, water = read("district"), read("rivers"), read("water")
settlements, facilities, tas, roads = read("settlements_raw"), read("facilities"), read("ta_raw"), read("roads")
dist_geom = district.union_all()

# ---------- Traditional Authorities ----------
tas["name"] = tas["name"].fillna("Lake Chilwa (water)")
tas["name"] = tas["name"].str.replace(r"^TA\s+", "", regex=True).str.title()
tas["area_km2"] = (tas.area / 1e6).round(1)
tas = tas[tas["name"] != "Lake Chilwa (Water)"][["name", "area_km2", "source", "geometry"]]   # lake is not a TA

# ---------- 1-3. Hazard zones from multi-ring buffers ----------
river_u, water_u = rivers.union_all(), water.union_all()
zones, covered = [], None
for cls in ["High", "Medium", "Low"]:
    r_m, w_m = RINGS[cls]
    g = river_u.buffer(r_m)
    if w_m: g = g.union(water_u.buffer(w_m))
    g = g.intersection(dist_geom).difference(water_u)     # inside district, not open water
    if covered is not None: g = g.difference(covered)     # rings do not overlap
    covered = g if covered is None else covered.union(g)
    zones.append({"risk_class": cls, "geometry": g})
zones = gpd.GeoDataFrame(zones, crs=UTM)
zones["area_km2"] = (zones.area / 1e6).round(1)
zones["method"] = zones["risk_class"].map({
    "High":   "≤150 m from a river or ≤1 km from Lake Chilwa",
    "Medium": "150–400 m from a river or 1–2.5 km from Lake Chilwa",
    "Low":    "400–800 m from a river"})
zones["id"] = ["FZ-H", "FZ-M", "FZ-L"]

# ---------- 4. Spatial joins ----------
def join_ta_and_zone(points):
    p = gpd.sjoin(points, tas[["name", "geometry"]].rename(columns={"name": "ta"}), how="left", predicate="within").drop(columns="index_right")
    p = gpd.sjoin(p, zones[["risk_class", "geometry"]], how="left", predicate="within").drop(columns="index_right")
    p["risk_class"] = p["risk_class"].fillna("None")
    p = p[~p.index.duplicated()]
    # points on a TA edge (simplification gaps) take the nearest TA
    miss = p["ta"].isna()
    if miss.any():
        nn = gpd.sjoin_nearest(p.loc[miss, ["geometry"]], tas[["name", "geometry"]], how="left")
        p.loc[miss, "ta"] = nn[~nn.index.duplicated()]["name"]
    return p

settlements = join_ta_and_zone(settlements)
settlements["in_risk_zone"] = settlements["risk_class"] != "None"

facilities = join_ta_and_zone(facilities)

# Candidate evacuation centres = schools (larger buildings, public). Health facilities kept separately.
centres = facilities[facilities["type"].str.contains("school")].copy()
centres["exposure"] = centres["risk_class"].replace("None", "Outside mapped zones")
centres["status"] = centres["risk_class"].map(
    lambda c: "Potentially flood-exposed" if c in ("High", "Medium") else "Requires verification")
centres = centres.drop(columns="risk_class")

# ---------- 5. Nearest suitable candidate centre ----------
usable = centres[centres["status"] != "Potentially flood-exposed"][["name", "geometry"]]
near = gpd.sjoin_nearest(settlements[["geometry"]], usable.rename(columns={"name": "nearest_centre"}),
                         how="left", distance_col="d_m")
near = near[~near.index.duplicated()]
settlements["nearest_centre"] = near["nearest_centre"]
settlements["nearest_centre_km"] = (near["d_m"] / 1000).round(2)

# Stable ids
settlements = settlements.reset_index(drop=True)
settlements["id"] = [f"S{i+1:03d}" for i in range(len(settlements))]
centres = centres.reset_index(drop=True)
centres["id"] = [f"C{i+1:03d}" for i in range(len(centres))]
facilities = facilities.reset_index(drop=True)
facilities["id"] = [f"F{i+1:03d}" for i in range(len(facilities))]

# ---------- 6. TA summary ----------
summary = settlements.groupby("ta").agg(settlements=("id", "count"),
                                        exposed=("in_risk_zone", "sum"),
                                        high=("risk_class", lambda s: (s == "High").sum()),
                                        medium=("risk_class", lambda s: (s == "Medium").sum()),
                                        low=("risk_class", lambda s: (s == "Low").sum()))
summary["centres"] = centres.groupby("ta").size()
summary = summary.fillna(0).astype(int).reset_index()
tas = tas.merge(summary.rename(columns={"ta": "name"}), on="name", how="left").fillna(
    {"settlements": 0, "exposed": 0, "high": 0, "medium": 0, "low": 0, "centres": 0})

# ---------- Output ----------
def out(gdf, name, cols, simplify=None, prec=5):
    g = gdf[cols + ["geometry"]].copy()
    if simplify: g["geometry"] = g.geometry.simplify(simplify)
    g = g.to_crs(WGS)
    g.to_file(f"{OUT}/{name}.geojson", driver="GeoJSON", COORDINATE_PRECISION=prec)
    g.to_file(f"{OUT}/phalombe.gpkg", layer=name, driver="GPKG")
    print(f"{name:12s} {len(g):5d} features  {os.path.getsize(f'{OUT}/{name}.geojson')/1024:7.0f} KB")

roads["class"] = pd.Categorical(roads["class"], ["Primary", "Secondary", "Other"])
out(district, "district", ["name", "source"], simplify=20)
out(tas, "tas", ["name", "area_km2", "settlements", "exposed", "high", "medium", "low", "centres", "source"], simplify=25)
out(zones, "flood_zones", ["id", "risk_class", "area_km2", "method"], simplify=20)
out(rivers, "rivers", ["id", "source"], simplify=10)
roads = roads.dissolve(by="class", as_index=False, observed=True)[["class", "source", "geometry"]]
out(roads, "roads", ["class", "source"], simplify=15)
out(water, "water", ["type", "source"], simplify=20)
out(settlements, "settlements", ["id", "name", "ta", "risk_class", "in_risk_zone", "nearest_centre", "nearest_centre_km", "source"])
out(centres, "centres", ["id", "name", "ta", "type", "status", "exposure", "source"])
out(facilities[facilities["type"] == "Health facility"], "health", ["id", "name", "ta", "type", "risk_class", "source"])

print("\nTA summary\n", summary.to_string(index=False))
print("\nSettlements by class:", settlements["risk_class"].value_counts().to_dict())
print("Centres by status:", centres["status"].value_counts().to_dict())
