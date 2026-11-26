import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadTrail } from "./data";
import { applyFilters, type Filters } from "./filters";
import type { LonLat } from "./geo";
import { createMap } from "./mapStyle";
import { DIFFICULTY_COLOR, type TrailDetail, type TrailSummary } from "./types";
import { DifficultyPill, fmtFt, fmtHours, fmtMi, go, typeLabel } from "./ui";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
/** Lots with more hikes than this only draw the first ones (each line is a separate download). */
const MAX_ROUTES = 12;

type Props = { trails: TrailSummary[]; filters: Filters; me: LonLat | null; activeFilters: number };

/**
 * Map of every hike's parking lot. Tap a pin: the lot gets a dark ring, every hike from it is drawn
 * (the one you're looking at glows, the others are dimmer, each has a mileage label), and swipeable
 * cards at the bottom preview them one at a time. Tap a card for the full trail page.
 */
export function Explore({ trails, filters, me, activeFilters }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [picked, setPickedRaw] = useState<TrailSummary[] | null>(null);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState<Record<string, TrailDetail | null>>({}); // null: couldn't load
  const sheet = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const labels = useRef<maplibregl.Marker[]>([]);
  /** Fit the map to the routes once they load (not when coming back from the trail page). */
  const fitNext = useRef(false);

  const setPicked = (p: TrailSummary[] | null, fit = true, first = 0) => {
    setPickedRaw(p);
    setActive(first);
    fitNext.current = fit;
    try { sessionStorage.setItem("explore-picked", JSON.stringify(p ? { ids: p.map((t) => t.id), active: first } : null)); } catch { /* ignore */ }
  };
  const setPickedRef = useRef(setPicked);
  setPickedRef.current = setPicked;
  /** Switch hikes from the map (tap a route or label): scroll the cards, the scroll handler does the rest. */
  const showIndex = (i: number) => {
    const s = strip.current, slide = s?.children[i] as HTMLElement | undefined;
    if (s && slide) s.scrollTo({ left: slide.offsetLeft - (s.clientWidth - slide.offsetWidth) / 2, behavior: "smooth" });
    setActive(i);
  };
  const showIndexRef = useRef(showIndex);
  showIndexRef.current = showIndex;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const rows = useMemo(() => applyFilters(trails, filters, me), [trails, filters, me]);
  const byId = useMemo(() => new Map(trails.map((t) => [t.id, t])), [trails]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const [ready, setReady] = useState(0);

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
      // Routes from the picked lot, under the pins so the lot stays tappable.
      m.addSource("routes", { type: "geojson", data: EMPTY });
      const round = { "line-cap": "round", "line-join": "round" } as const;
      const on = ["==", ["get", "on"], true] as maplibregl.FilterSpecification;
      const off = ["==", ["get", "on"], false] as maplibregl.FilterSpecification;
      m.addLayer({ id: "routes-casing", type: "line", source: "routes", filter: off, paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.6 }, layout: round });
      m.addLayer({ id: "routes-dim", type: "line", source: "routes", filter: off, paint: { "line-color": "#d9480f", "line-width": 3.5, "line-opacity": 0.6 }, layout: round });
      m.addLayer({ id: "route-glow", type: "line", source: "routes", filter: on, paint: { "line-color": "#ff7a3d", "line-width": 16, "line-blur": 8, "line-opacity": 0.55 }, layout: round });
      m.addLayer({ id: "route-casing", type: "line", source: "routes", filter: on, paint: { "line-color": "#fff", "line-width": 8 }, layout: round });
      m.addLayer({ id: "route-line", type: "line", source: "routes", filter: on, paint: { "line-color": "#d9480f", "line-width": 5 }, layout: round });
      m.addLayer({ id: "clusters", type: "circle", source: "hikes", filter: ["has", "point_count"],
        paint: { "circle-color": "#2f5d3a", "circle-opacity": 0.85, "circle-radius": ["step", ["get", "point_count"], 14, 20, 18, 100, 24], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      m.addLayer({ id: "cluster-count", type: "symbol", source: "hikes", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#fff" } });
      m.addLayer({ id: "pins", type: "circle", source: "hikes", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["match", ["get", "d"], "easy", DIFFICULTY_COLOR.easy, "moderate", DIFFICULTY_COLOR.moderate, DIFFICULTY_COLOR.hard],
          "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
        } });
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
    const hit = (pt: maplibregl.Point, layers: string[]) => {
      const r = 8; // finger-sized
      return m.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers });
    };
    m.on("click", (e) => {
      const pins = hit(e.point, ["pins"]);
      if (pins.length) {
        // Every hike under the finger (lots right next to each other overlap when zoomed out), nearest lot first.
        const dist = (f: maplibregl.MapGeoJSONFeature) => {
          const px = m.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
          return Math.hypot(px.x - e.point.x, px.y - e.point.y);
        };
        const ids = [...new Set([...pins].sort((a, b) => dist(a) - dist(b)).map((f) => f.properties!.id as string))];
        const already = pickedRef.current;
        if (already && ids.every((id) => already.some((t) => t.id === id))) return; // same lot again
        setPickedRef.current(ids.map((id) => byIdRef.current.get(id)!).filter(Boolean));
        return;
      }
      const route = hit(e.point, ["route-line", "routes-dim"])[0];
      if (route) {
        const i = pickedRef.current?.findIndex((t) => t.id === route.properties!.id) ?? -1;
        if (i >= 0) showIndexRef.current(i);
        return;
      }
      if (!hit(e.point, ["clusters", "selected-pin"]).length) setPickedRef.current(null);
    });
    for (const l of ["pins", "clusters", "selected-pin", "route-line", "routes-dim"]) {
      m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
    }
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    (map.current?.getSource("hikes") as GeoJSONSource | undefined)?.setData(geojson);
  }, [geojson, ready]);

  // Coming back from a trail page: show the same lot and hike again.
  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem("explore-picked") ?? "null") as { ids: string[]; active: number } | null;
      const p = v?.ids?.map((id) => byId.get(id)!).filter(Boolean);
      if (p?.length) setPicked(p, false, Math.min(v!.active ?? 0, p.length - 1));
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember which card is showing; put the strip on it when coming back.
  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem("explore-picked") ?? "null");
      if (v) sessionStorage.setItem("explore-picked", JSON.stringify({ ...v, active }));
    } catch { /* ignore */ }
  }, [active]);
  useEffect(() => {
    const s = strip.current, slide = s?.children[active] as HTMLElement | undefined;
    if (s && slide) s.scrollLeft = slide.offsetLeft - (s.clientWidth - slide.offsetWidth) / 2;
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the lot's routes (works offline for downloaded hikes; others just show no line).
  useEffect(() => {
    let live = true;
    for (const t of picked?.slice(0, MAX_ROUTES) ?? []) {
      if (t.id in details) continue;
      loadTrail(t.id).then(
        (d) => live && setDetails((all) => ({ ...all, [t.id]: d })),
        () => live && setDetails((all) => ({ ...all, [t.id]: null })), // offline and not downloaded: card only
      );
    }
    return () => { live = false; };
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw: ring on the lot, routes, mileage labels; fit the view.
  useEffect(() => {
    const m = map.current;
    for (const l of labels.current) l.remove();
    labels.current = [];
    if (!m?.getSource("selected")) return;
    const cur = picked?.[active];
    (m.getSource("selected") as GeoJSONSource).setData(cur ? {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [cur.parking.lon, cur.parking.lat] }, properties: { d: cur.difficultySimple } }],
    } : EMPTY);
    const shown = (picked ?? []).slice(0, MAX_ROUTES).map((t, i) => ({ t, i, d: details[t.id]! })).filter((x) => x.d);
    (m.getSource("routes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      // Active route last so it draws on top where routes share trail.
      features: [...shown].sort((a, b) => Number(a.i === active) - Number(b.i === active)).map(({ d, i }) => ({
        type: "Feature", geometry: { type: "LineString", coordinates: d.geometry }, properties: { id: d.id, on: i === active },
      })),
    });
    if (shown.length > 1 || (shown.length === 1 && (picked?.length ?? 0) > 1)) {
      const taken: [number, number][] = [];
      for (const { d, i } of shown) {
        const at = labelSpot(d.geometry, taken);
        taken.push(at);
        const b = document.createElement("button");
        b.className = `dist-label${i === active ? " on" : ""}`;
        b.textContent = fmtMi(d.lengthMi);
        b.onclick = (ev) => { ev.stopPropagation(); showIndexRef.current(i); };
        labels.current.push(new maplibregl.Marker({ element: b, anchor: "bottom", offset: [0, -4] }).setLngLat(at).addTo(m));
      }
    }
    const pad = { top: 80, left: 40, right: 64, bottom: (sheet.current?.offsetHeight ?? 0) + 30 };
    const all = (picked ?? []).slice(0, MAX_ROUTES);
    if (fitNext.current && all.every((t) => t.id in details)) {
      // Whole lot once everything's loaded.
      fitNext.current = false;
      if (shown.length) m.fitBounds(union(shown.map((x) => x.d.bbox)), { padding: pad, maxZoom: 16, duration: 600 });
    } else if (!fitNext.current && details[cur?.id ?? ""]) {
      // Swiped to a hike that runs off screen.
      const [w, s, e, n] = details[cur!.id]!.bbox, v = m.getBounds();
      if (!v.contains([w, s]) || !v.contains([e, n])) m.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom: 16, duration: 600 });
    }
  }, [picked, active, details, ready]);

  // Keep the scale bar and map credits above the cards.
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

  const onSwipe = () => {
    const s = strip.current;
    if (!s) return;
    const mid = s.scrollLeft + s.clientWidth / 2;
    let best = 0, bestD = Infinity;
    Array.from(s.children).forEach((c, i) => {
      const el = c as HTMLElement, d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== active) setActive(best);
  };

  return (
    <div className="explore">
      <div className="map" ref={el} />
      <div className="topbar">
        <button className="searchbox" onClick={() => go("#/search")}>
          🔍 Search {trails.length.toLocaleString()} hikes{activeFilters ? ` · ${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : ""}
        </button>
      </div>
      {picked && picked.length > 0 && (
        <div className="cards" ref={sheet}>
          {picked.length > 1 && <div className="count-pill">{active + 1} of {picked.length}</div>}
          <div className={`strip${picked.length === 1 ? " single" : ""}`} ref={strip} onScroll={onSwipe}>
            {picked.map((t, i) => (
              <Preview key={t.id} t={t} detail={details[t.id] ?? null} on={i === active} onClose={() => setPicked(null)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact look at a hike: stats and a small elevation outline. Tap it for the full trail page. */
function Preview({ t, detail, on, onClose }: { t: TrailSummary; detail: TrailDetail | null; on: boolean; onClose: () => void }) {
  const p = detail?.profile;
  let path: string | null = null;
  if (p && p.length > 1) {
    const W = 300, H = 36, total = p[p.length - 1].mi || 1;
    const lo = Math.min(...p.map((q) => q.ft)), hi = Math.max(...p.map((q) => q.ft));
    const span = Math.max(hi - lo, 150); // flat hikes stay flat
    const y = (ft: number) => H - 2 - ((ft - lo) / span) * (H - 6);
    path = `M0,${H} ` + p.map((q) => `L${((q.mi / total) * W).toFixed(1)},${y(q.ft).toFixed(1)}`).join(" ") + ` L${W},${H} Z`;
  }
  return (
    <div className={`slide${on ? " on" : ""}`} role="button" tabIndex={0} onClick={() => go(`#/trail/${t.id}`)}
      onKeyDown={(e) => { if (e.key === "Enter") go(`#/trail/${t.id}`); }}>
      <button className="x slide-x" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close">×</button>
      <div className="slide-name">{t.name}</div>
      <div className="slide-area muted">{t.area ?? t.parking.name ?? "Trailhead parking"}</div>
      <div className="card-meta">
        <DifficultyPill t={t} />
        <span>{fmtMi(t.lengthMi)}</span>
        <span>↑ {fmtFt(t.gainFt)}</span>
        <span>{fmtHours(t.hours)}</span>
        <span>{typeLabel(t.type)}</span>
      </div>
      <div className="spark">
        {path ? (
          <>
            <svg viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
            <span className="spark-label muted">{fmtFt(t.lowFt)} – {fmtFt(t.highFt)}</span>
          </>
        ) : <div className="spark-empty" />}
      </div>
      <div className="slide-go">Details ›</div>
    </div>
  );
}

function union(boxes: [number, number, number, number][]): [[number, number], [number, number]] {
  let [w, s, e, n] = boxes[0];
  for (const b of boxes) { w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]); }
  return [[w, s], [e, n]];
}

/** Where to put a route's mileage label: its far end from the lot, nudged along the line away from labels already placed. */
function labelSpot(g: [number, number][], taken: [number, number][]): [number, number] {
  const start = g[0], far = (p: number[]) => Math.hypot(p[0] - start[0], (p[1] - start[1]) * 1.25);
  const order = g.map((p, i) => i).sort((a, b) => far(g[b]) - far(g[a]));
  const near = (p: number[]) => taken.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.0025);
  for (const i of order.slice(0, Math.max(1, Math.floor(g.length * 0.6)))) if (!near(g[i])) return g[i];
  return g[order[0]];
}

function saved(): Partial<maplibregl.MapOptions> | null {
  try {
    const v = JSON.parse(sessionStorage.getItem("explore-view") ?? "null");
    return v ? { center: v.center, zoom: v.zoom } : null;
  } catch {
    return null;
  }
}
