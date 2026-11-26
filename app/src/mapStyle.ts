import maplibregl, { type Map as MlMap } from "maplibre-gl";
import mlcontour from "maplibre-contour";

// Base map: OpenFreeMap (free OpenStreetMap vector tiles, no key).
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Elevation: AWS Terrain Tiles (USGS 3DEP in the US), used for hillshade and contour lines.
export const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const DEM_MAXZOOM = 13;
export const VECTOR_MAXZOOM = 14;
// Satellite: USGS National Map imagery (public domain, US only).
export const SAT_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
export const SAT_MAXZOOM = 16;
const SAT_PREF = "satellite";
const satOn = () => { try { return localStorage.getItem(SAT_PREF) === "1"; } catch { return false; } };

// Contours are computed in the browser from the elevation tiles. Fetching on the main thread
// (worker: false) keeps every request visible to the service worker, so they work offline.
const dem = new mlcontour.DemSource({ url: DEM_URL, encoding: "terrarium", maxzoom: DEM_MAXZOOM, worker: false });
dem.setupMaplibre(maplibregl);

const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e6" } }],
};

export function createMap(container: HTMLElement, opts: Partial<maplibregl.MapOptions> = {}): MlMap {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [-79.6, 37.6],
    zoom: 7,
    attributionControl: { compact: true },
    ...opts,
  });
  map.on("style.load", () => { addSatellite(map); addTopo(map); });
  map.addControl(new SatelliteToggle(), "top-right");
  // No signal and no cached base map: fall back to a plain background so trails, features and GPS still show.
  map.once("error", (e) => {
    const url = (e.error as { url?: string } | undefined)?.url ?? "";
    if (url.startsWith(STYLE_URL) && !map.isStyleLoaded()) map.setStyle(FALLBACK_STYLE);
  });
  return map;
}

/** Satellite imagery under the labels, hidden until switched on. */
function addSatellite(map: MlMap) {
  if (map.getSource("satellite")) return;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addSource("satellite", { type: "raster", tiles: [SAT_URL], tileSize: 256, maxzoom: SAT_MAXZOOM, attribution: "Imagery: USGS" });
  map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: satOn() ? "visible" : "none" } }, firstSymbol);
}

/** Map button that switches between the topo map and satellite imagery. */
class SatelliteToggle implements maplibregl.IControl {
  private map?: MlMap;
  private btn = document.createElement("button");
  onAdd(map: MlMap) {
    this.map = map;
    const box = document.createElement("div");
    box.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.btn.type = "button";
    this.btn.className = "sat-toggle";
    this.btn.onclick = () => this.set(!satOn());
    this.paint();
    box.append(this.btn);
    return box;
  }
  onRemove() { this.btn.parentElement?.remove(); }
  private set(on: boolean) {
    try { localStorage.setItem(SAT_PREF, on ? "1" : "0"); } catch { /* private mode */ }
    if (this.map?.getLayer("satellite")) this.map.setLayoutProperty("satellite", "visibility", on ? "visible" : "none");
    this.paint();
  }
  private paint() {
    const on = satOn();
    this.btn.textContent = on ? "Map" : "Sat";
    this.btn.title = this.btn.ariaLabel = on ? "Show topo map" : "Show satellite";
  }
}

/** Hillshade + contour lines (40 ft, bold every 200 ft) so the street map reads like a topo map. */
function addTopo(map: MlMap) {
  if (map.getSource("dem")) return;
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addSource("dem", { type: "raster-dem", encoding: "terrarium", tiles: [dem.sharedDemProtocolUrl], maxzoom: DEM_MAXZOOM, tileSize: 256 });
  map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#5a5145" } }, firstSymbol);
  map.addSource("contours", {
    type: "vector",
    tiles: [
      dem.contourProtocolUrl({
        multiplier: 3.28084, // feet
        thresholds: { 11: [200, 1000], 12: [100, 500], 13: [100, 500], 14: [40, 200], 15: [20, 100] },
        elevationKey: "ele",
        levelKey: "level",
        contourLayer: "contours",
      }),
    ],
    maxzoom: 15,
  });
  map.addLayer({
    id: "contour-lines", type: "line", source: "contours", "source-layer": "contours",
    paint: { "line-color": "#9a7b4f", "line-opacity": 0.45, "line-width": ["match", ["get", "level"], 1, 1.1, 0.5] },
  }, firstSymbol);
  map.addLayer({
    id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours",
    filter: [">", ["get", "level"], 0],
    layout: { "symbol-placement": "line", "text-size": 10, "text-field": ["concat", ["number-format", ["get", "ele"], {}], "'"], "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": "#7a5f3a", "text-halo-color": "#fff", "text-halo-width": 1 },
  });
}
