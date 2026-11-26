import maplibregl, { type Map as MlMap } from "maplibre-gl";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSaved, loadTrail, putSaved, type Saved } from "./data";
import { ElevationChart } from "./ElevationChart";
import { usePosition } from "./geo";
import { createMap } from "./mapStyle";
import { downloadTrail, mb } from "./offline";
import { FEATURE_META, type FeatureKind, type TrailDetail } from "./types";
import { DifficultyPill, fmtFt, fmtHours, fmtMi, typeLabel } from "./ui";

export function TrailPage({ id }: { id: string }) {
  const [trail, setTrail] = useState<TrailDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [hidden, setHidden] = useState<Set<FeatureKind>>(new Set());
  const pos = usePosition();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const cursor = useRef<maplibregl.Marker | null>(null);
  const markers = useRef<{ kind: FeatureKind; m: maplibregl.Marker }[]>([]);

  useEffect(() => {
    setTrail(null); setError(null); setActive(null);
    loadTrail(id).then(setTrail, (e) => setError(String(e.message ?? e)));
    const refresh = () => getSaved().then((s) => setSaved(s[id] ?? null));
    refresh();
    window.addEventListener("saved-changed", refresh);
    return () => window.removeEventListener("saved-changed", refresh);
  }, [id]);

  // Map with the trail, its features and parking.
  useEffect(() => {
    if (!trail || !mapEl.current) return;
    const m = createMap(mapEl.current, { bounds: trail.bbox as [number, number, number, number], fitBoundsOptions: { padding: 40 } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    m.on("style.load", () => {
      m.addSource("trail", { type: "geojson", data: lineString(trail.geometry) });
      m.addLayer({ id: "trail-casing", type: "line", source: "trail", paint: { "line-color": "#fff", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "trail-line", type: "line", source: "trail", paint: { "line-color": "#d9480f", "line-width": 4 }, layout: { "line-cap": "round", "line-join": "round" } });
    });
    const add = (kind: FeatureKind, lon: number, lat: number, title: string, info?: string) => {
      const el = document.createElement("div");
      el.className = `fmarker k-${kind}`;
      el.textContent = FEATURE_META[kind].icon;
      el.style.background = FEATURE_META[kind].color;
      el.title = title;
      const mk = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setDOMContent(popup(title, info))).addTo(m);
      markers.current.push({ kind, m: mk });
    };
    add("parking", trail.parking.lon, trail.parking.lat, trail.parking.name ?? "Parking");
    for (const f of trail.features) add(f.kind, f.lon, f.lat, `${f.name ?? FEATURE_META[f.kind].label} · mile ${f.mi.toFixed(1)}`, f.info ?? (f.name ? FEATURE_META[f.kind].label : undefined));
    const el = document.createElement("div");
    el.className = "cursor-dot";
    cursor.current = new maplibregl.Marker({ element: el });
    return () => { markers.current = []; m.remove(); map.current = null; };
  }, [trail]);

  // Feature toggles.
  useEffect(() => {
    for (const { kind, m } of markers.current) m.getElement().style.display = hidden.has(kind) ? "none" : "";
  }, [hidden, trail]);

  // Chart drag -> dot on the map.
  useEffect(() => {
    const c = cursor.current, m = map.current;
    if (!c || !m || !trail) return;
    if (active == null) { c.remove(); return; }
    const p = trail.profile[active];
    c.setLngLat([p.lon, p.lat]).addTo(m);
  }, [active, trail]);

  // Where am I on this trail? (live, nothing is recorded)
  const onTrail = useMemo(() => {
    if (!trail || !pos) return null;
    const line = lineString(trail.profile.map((p) => [p.lon, p.lat]));
    const n = nearestPointOnLine(line, point([pos.lon, pos.lat]), { units: "miles" });
    const off = n.properties.dist ?? 99;
    if (off > 0.1) return { off };
    const at = n.properties.location ?? 0;
    const p = trail.profile.reduce((b, q) => (Math.abs(q.mi - at) < Math.abs(b.mi - at) ? q : b), trail.profile[0]);
    return { off, mi: p.mi, ft: p.ft };
  }, [trail, pos]);

  if (error) return <div className="page"><p className="error">Couldn't load this trail. {error}</p></div>;
  if (!trail) return <div className="page"><p className="muted">Loading trail…</p></div>;

  const camps = trail.features.filter((f) => f.kind === "campsite" || f.kind === "shelter");
  const kinds = [...new Set(trail.features.map((f) => f.kind))];
  const toggle = (k: FeatureKind) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const save = async () => {
    if (saved) { await putSaved(trail.id, null); return; }
    const { profile: _p, features: _f, geometry: _g, ...summary } = trail;
    await putSaved(trail.id, { summary, savedAt: Date.now(), downloaded: false, bytes: 0 });
  };
  const download = async () => {
    setProgress([0, 1]);
    try { await downloadTrail(trail, (d, t) => setProgress([d, t])); } finally { setProgress(null); }
  };

  return (
    <div className="trail">
      <div className="trail-map" ref={mapEl} />
      <div className="trail-body">
        <button className="back" onClick={() => history.back()}>‹ Back</button>
        <h1>{trail.name}</h1>
        <div className="muted">{trail.via.length ? `via ${trail.via.join(", ")}` : ""}{trail.area ? `${trail.via.length ? " · " : ""}${trail.area}` : ""}</div>

        <ElevationChart profile={trail.profile} active={active} onActive={setActive} youMi={onTrail && "mi" in onTrail ? onTrail.mi : null} />

        <div className="stats">
          <div><span>Length</span><b>{fmtMi(trail.lengthMi)}</b></div>
          <div><span>Elev. gain</span><b>{fmtFt(trail.gainFt)}</b></div>
          <div><span>High point</span><b>{fmtFt(trail.highFt)}</b></div>
          <div><span>Est. time</span><b>{fmtHours(trail.hours)}</b></div>
          <div><span>Route</span><b>{typeLabel(trail.type)}</b></div>
          <div><span>Difficulty</span><b><DifficultyPill t={trail} /></b></div>
        </div>

        {onTrail && "mi" in onTrail && onTrail.mi != null && (
          <div className="you-box">You're at <b>mile {onTrail.mi.toFixed(1)}</b> of {fmtMi(trail.lengthMi)} · {fmtFt(onTrail.ft!)} · {fmtMi(Math.max(0, trail.lengthMi - onTrail.mi))} to go</div>
        )}

        <div className="actions">
          <button className={saved ? "btn" : "btn primary"} onClick={save}>{saved ? "★ Saved" : "☆ Save"}</button>
          <button className="btn primary" disabled={!!progress} onClick={download}>
            {progress ? `Downloading ${Math.round((progress[0] / progress[1]) * 100)}%` : saved?.downloaded ? `✓ Offline (${mb(saved.bytes)}) · Refresh` : "⬇ Download for offline"}
          </button>
        </div>

        <h2>Parking</h2>
        <p>
          {trail.parking.name ?? "Trailhead parking"} ·{" "}
          <a href={`https://maps.apple.com/?daddr=${trail.parking.lat},${trail.parking.lon}`} target="_blank" rel="noreferrer">Directions</a>
        </p>

        <h2>Camping &amp; shelters</h2>
        {camps.length ? (
          <ul className="features">
            {camps.map((f, i) => (
              <li key={i} onClick={() => map.current?.flyTo({ center: [f.lon, f.lat], zoom: 15 })}>
                <span className="fdot" style={{ background: FEATURE_META[f.kind].color }}>{FEATURE_META[f.kind].icon}</span>
                <span>{f.name ?? FEATURE_META[f.kind].label}<br /><span className="muted small">{f.info ?? "No details mapped"}</span></span>
                <span className="muted">mile {f.mi.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No campsites or shelters are mapped within 100 m of this hike.</p>}
        {trail.camping && <p className="camp-rule">{trail.camping}</p>}
        <p className="muted small">Fee and permit details come from OpenStreetMap and are often missing. Land rules are general guidance; check with the park or forest before you go.</p>

        {kinds.length > 0 && (
          <>
            <h2>Along the trail</h2>
            <div className="chips">
              {kinds.map((k) => (
                <button key={k} className={`chip ${hidden.has(k) ? "" : "on"}`} onClick={() => toggle(k)}>
                  {FEATURE_META[k].icon} {FEATURE_META[k].label}
                </button>
              ))}
            </div>
            <ul className="features">
              {trail.features.filter((f) => !hidden.has(f.kind)).map((f, i) => (
                <li key={i} onClick={() => map.current?.flyTo({ center: [f.lon, f.lat], zoom: 15 })}>
                  <span className="fdot" style={{ background: FEATURE_META[f.kind].color }}>{FEATURE_META[f.kind].icon}</span>
                  <span>{f.name ?? FEATURE_META[f.kind].label}</span>
                  <span className="muted">mile {f.mi.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="fine">
          Difficulty uses the Shenandoah rating (√(2 × gain × miles) = {trail.rating}: {trail.difficulty}). Time assumes 2 mph plus 30 min per 1,000 ft of climb.
          Data © OpenStreetMap contributors; elevation from USGS via AWS Terrain Tiles.
        </p>
      </div>
    </div>
  );
}

/** Popup body: title plus an optional detail line. Built from DOM nodes so names are never parsed as HTML. */
function popup(title: string, info?: string) {
  const el = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = title;
  el.append(b);
  if (info) {
    const d = document.createElement("div");
    d.className = "popup-info";
    d.textContent = info;
    el.append(d);
  }
  return el;
}
