import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrail } from "./data";
import { applyFilters, type Filters } from "./filters";
import type { LonLat } from "./geo";
import { createMap } from "./mapStyle";
import { DIFFICULTY_COLOR, type TrailDetail, type TrailSummary } from "./types";
import { DifficultyPill, FeatureIcons, fmtFt, fmtHours, fmtMi, go, typeLabel } from "./ui";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = { trails: TrailSummary[]; filters: Filters; me: LonLat | null; activeFilters: number };

/** Map of every hike's parking lot. Tap a pin to highlight it, draw the hike on the map and show a preview card. */
export function Explore({ trails, filters, me, activeFilters }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [picked, setPickedRaw] = useState<TrailSummary[] | null>(null);
  /** The hike drawn on the map and shown big in the sheet. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrailDetail | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  /** Fit the map to the hike once its line loads (not when coming back from the trail page). */
  const fitNext = useRef(false);
  const setPicked = (p: TrailSummary[] | null, fit = true, first?: string) => {
    setPickedRaw(p);
    setPreviewId(p?.find((t) => t.id === first)?.id ?? p?.[0]?.id ?? null);
    fitNext.current = fit;
    try { sessionStorage.setItem("explore-picked", JSON.stringify(p?.map((t) => t.id) ?? null)); } catch { /* ignore */ }
  };
  const showHike = (id: string) => {
    setPreviewId(id);
    fitNext.current = true;
    sheet.current?.querySelector(".sheet-list")?.scrollTo({ top: 0 });
  };
  const setPickedRef = useRef(setPicked);
  setPickedRef.current = setPicked;
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
      // Previewed hike, drawn under the pins so the lot stays tappable.
      m.addSource("preview", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "preview-casing", type: "line", source: "preview", paint: { "line-color": "#fff", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } }, "clusters");
      m.addLayer({ id: "preview-line", type: "line", source: "preview", paint: { "line-color": "#d9480f", "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } }, "clusters");
      // Selected lot: bigger dot with a dark ring.
      m.addSource("selected", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "selected-pin", type: "circle", source: "selected",
        paint: {
          "circle-color": ["match", ["get", "d"], "easy", DIFFICULTY_COLOR.easy, "moderate", DIFFICULTY_COLOR.moderate, DIFFICULTY_COLOR.hard],
          "circle-radius": 11, "circle-stroke-color": "#111", "circle-stroke-width": 3.5,
        } });
      setReady((n) => n + 1);
    });
    m.on("click", "clusters", async (e) => {
      const f = e.features![0];
      const src = m.getSource("hikes") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties!.cluster_id);
      m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });
    m.on("click", ["pins", "selected-pin"], (e) => {
      // All hikes from the same lot sit on the same spot.
      const hits = m.queryRenderedFeatures(e.point, { layers: ["pins"] });
      if (!hits.length) return; // tapped the ring of the lot that's already selected
      const ids = [...new Set(hits.map((f) => f.properties!.id as string))];
      setPickedRef.current(ids.map((id) => byIdRef.current.get(id)!).filter(Boolean));
    });
    m.on("click", (e) => {
      if (!m.queryRenderedFeatures(e.point, { layers: ["pins", "clusters", "selected-pin"] }).length) setPickedRef.current(null);
    });
    for (const l of ["pins", "clusters", "selected-pin"]) {
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

  // Coming back from a trail page: show the same lot and hike again.
  useEffect(() => {
    try {
      const ids = JSON.parse(sessionStorage.getItem("explore-picked") ?? "null") as string[] | null;
      const p = ids?.map((id) => byId.get(id)!).filter(Boolean);
      if (p?.length) setPicked(p, false, sessionStorage.getItem("explore-preview") ?? undefined);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the previewed hike's line (works offline for downloaded hikes).
  useEffect(() => {
    setDetail(null);
    try { sessionStorage.setItem("explore-preview", previewId ?? ""); } catch { /* ignore */ }
    if (!previewId) return;
    let live = true;
    loadTrail(previewId).then((d) => live && setDetail(d), () => { /* no line offline; card still shows */ });
    return () => { live = false; };
  }, [previewId]);

  // Highlight the lot and draw the line.
  useEffect(() => {
    const m = map.current;
    if (!m?.getSource("selected")) return;
    const t = picked?.find((x) => x.id === previewId) ?? picked?.[0];
    (m.getSource("selected") as GeoJSONSource).setData(t ? {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [t.parking.lon, t.parking.lat] }, properties: { d: t.difficultySimple } }],
    } : EMPTY);
    const line = detail && detail.id === previewId ? detail : null;
    (m.getSource("preview") as GeoJSONSource).setData(line ? {
      type: "Feature", geometry: { type: "LineString", coordinates: line.geometry }, properties: {},
    } : EMPTY);
    if (line && fitNext.current) {
      fitNext.current = false;
      const sheetH = sheet.current?.offsetHeight ?? 0;
      const [w, s, e, n] = line.bbox;
      m.fitBounds([[w, s], [e, n]], { padding: { top: 80, left: 40, right: 64, bottom: sheetH + 30 }, maxZoom: 16, duration: 600 });
    }
  }, [picked, previewId, detail, ready]);

  // Keep the scale bar and map credits above the sheet.
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const place = () => box.style.setProperty("--sheet-h", `${sheet.current?.offsetHeight ?? 0}px`);
    place();
    if (!sheet.current) return;
    const ro = new ResizeObserver(place);
    ro.observe(sheet.current);
    return () => ro.disconnect();
  }, [picked]);

  const preview = picked?.find((t) => t.id === previewId) ?? null;
  const others = picked?.filter((t) => t.id !== previewId) ?? [];

  return (
    <div className="explore">
      <div className="map" ref={el} />
      <div className="topbar">
        <button className="searchbox" onClick={() => go("#/search")}>
          🔍 Search {trails.length.toLocaleString()} hikes{activeFilters ? ` · ${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : ""}
        </button>
      </div>
      {picked && picked.length > 0 && (
        <div className="sheet" ref={sheet}>
          <div className="sheet-head">
            <b>{picked[0].parking.name ?? "Trailhead"}{picked.length > 1 ? <span className="muted"> · {picked.length} hikes</span> : null}</b>
            <button className="x" onClick={() => setPicked(null)} aria-label="Close">×</button>
          </div>
          <div className="sheet-list">
            {preview && <Preview t={preview} detail={detail?.id === preview.id ? detail : null} />}
            {others.length > 0 && <div className="sheet-sub muted">Also from this lot</div>}
            {others.map((t) => (
              <button key={t.id} className="card mini" onClick={() => showHike(t.id)}>
                <span className="card-name">{t.name}</span>
                <span className="card-meta"><DifficultyPill t={t} /><span>{fmtMi(t.lengthMi)}</span><span>↑ {fmtFt(t.gainFt)}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact look at the hike: stats, a small elevation outline, and a button into the full page. */
function Preview({ t, detail }: { t: TrailSummary; detail: TrailDetail | null }) {
  const p = detail?.profile;
  let path: string | null = null;
  if (p && p.length > 1) {
    const W = 300, H = 44, total = p[p.length - 1].mi || 1;
    const lo = Math.min(...p.map((q) => q.ft)), hi = Math.max(...p.map((q) => q.ft));
    const span = Math.max(hi - lo, 150); // flat hikes stay flat
    const y = (ft: number) => H - 2 - ((ft - lo) / span) * (H - 6);
    path = `M0,${H} ` + p.map((q) => `L${((q.mi / total) * W).toFixed(1)},${y(q.ft).toFixed(1)}`).join(" ") + ` L${W},${H} Z`;
  }
  return (
    <div className="card preview">
      <div className="card-top">
        <span className="card-name">{t.name}</span>
      </div>
      <div className="card-meta">
        <DifficultyPill t={t} />
        <span>{fmtMi(t.lengthMi)}</span>
        <span>↑ {fmtFt(t.gainFt)}</span>
        <span>{fmtHours(t.hours)}</span>
        <span>{typeLabel(t.type)}</span>
      </div>
      {path ? (
        <div className="spark">
          <svg viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
          <span className="spark-label muted">{fmtFt(t.lowFt)} – {fmtFt(t.highFt)}</span>
        </div>
      ) : (
        <div className="spark spark-empty" />
      )}
      <div className="card-sub">
        <FeatureIcons counts={t.counts} dest={t.dest} />
        {t.area && <span className="muted">{t.area}</span>}
      </div>
      <button className="btn primary open" onClick={() => go(`#/trail/${t.id}`)}>View trail details →</button>
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
