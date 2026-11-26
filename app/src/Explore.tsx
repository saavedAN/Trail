import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyFilters, type Filters } from "./filters";
import type { LonLat } from "./geo";
import { createMap } from "./mapStyle";
import { DIFFICULTY_COLOR, type TrailSummary } from "./types";
import { TrailCard, go } from "./ui";

type Props = { trails: TrailSummary[]; filters: Filters; me: LonLat | null; activeFilters: number };

/** Map of every hike's parking lot. Tap a pin to see the hikes that start there. */
export function Explore({ trails, filters, me, activeFilters }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [picked, setPicked] = useState<TrailSummary[] | null>(null);
  const rows = useMemo(() => applyFilters(trails, filters, me), [trails, filters, me]);
  const byId = useMemo(() => new Map(trails.map((t) => [t.id, t])), [trails]);

  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: rows.map(({ t }) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [t.parking.lon, t.parking.lat] },
      properties: { id: t.id, d: t.difficultySimple },
    })),
  }), [rows]);

  useEffect(() => {
    const m = createMap(el.current!, saved() ?? {});
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    m.on("moveend", () => {
      try { sessionStorage.setItem("explore-view", JSON.stringify({ center: m.getCenter(), zoom: m.getZoom() })); } catch { /* ignore */ }
    });
    m.on("style.load", () => {
      m.addSource("hikes", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 40, clusterMaxZoom: 11 });
      m.addLayer({ id: "clusters", type: "circle", source: "hikes", filter: ["has", "point_count"],
        paint: { "circle-color": "#2f5d3a", "circle-opacity": 0.85, "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 100, 24], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.addLayer({ id: "cluster-count", type: "symbol", source: "hikes", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#fff" } });
      m.addLayer({ id: "pins", type: "circle", source: "hikes", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["match", ["get", "d"], "easy", DIFFICULTY_COLOR.easy, "moderate", DIFFICULTY_COLOR.moderate, DIFFICULTY_COLOR.hard],
          "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
        } });
      setReady((n) => n + 1);
    });
    m.on("click", "clusters", async (e) => {
      const f = e.features![0];
      const src = m.getSource("hikes") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties!.cluster_id);
      m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });
    m.on("click", "pins", (e) => {
      // All hikes from the same lot sit on the same spot.
      const ids = m.queryRenderedFeatures(e.point, { layers: ["pins"] }).map((f) => f.properties!.id as string);
      setPicked(ids.map((id) => byIdRef.current.get(id)!).filter(Boolean));
    });
    m.on("click", (e) => {
      if (!m.queryRenderedFeatures(e.point, { layers: ["pins", "clusters"] }).length) setPicked(null);
    });
    for (const l of ["pins", "clusters"]) {
      m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
    }
    return () => { m.remove(); map.current = null; };
  }, []);

  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const [ready, setReady] = useState(0);
  useEffect(() => {
    (map.current?.getSource("hikes") as GeoJSONSource | undefined)?.setData(geojson);
  }, [geojson, ready]);

  return (
    <div className="explore">
      <div className="map" ref={el} />
      <div className="topbar">
        <button className="searchbox" onClick={() => go("#/search")}>
          🔍 Search {trails.length.toLocaleString()} hikes{activeFilters ? ` · ${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : ""}
        </button>
      </div>
      {picked && picked.length > 0 && (
        <div className="sheet">
          <div className="sheet-head">
            <b>{picked[0].parking.name ?? "Trailhead"}</b>
            <button className="x" onClick={() => setPicked(null)} aria-label="Close">×</button>
          </div>
          <div className="sheet-list">
            {picked.map((t) => <TrailCard key={t.id} t={t} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function saved(): Partial<maplibregl.MapOptions> | null {
  try {
    const v = JSON.parse(sessionStorage.getItem("explore-view") ?? "null");
    return v ? { center: v.center, zoom: v.zoom } : null;
  } catch {
    return null;
  }
}
