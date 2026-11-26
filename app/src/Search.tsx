import { useMemo, useState } from "react";
import { applyFilters, defaultFilters, FILTERABLE, type Filters, type SortKey } from "./filters";
import type { LonLat } from "./geo";
import { FEATURE_META, type TrailSummary } from "./types";
import { TrailCard } from "./ui";

type Props = { trails: TrailSummary[]; filters: Filters; setFilters: (f: Filters) => void; me: LonLat | null };

const PAGE = 60;

export function Search({ trails, filters: f, setFilters, me }: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => applyFilters(trails, f, me), [trails, f, me]);
  const set = (patch: Partial<Filters>) => { setFilters({ ...f, ...patch }); setLimit(PAGE); };
  const toggleIn = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };

  return (
    <div className="page search">
      <div className="search-row">
        <input
          type="search"
          placeholder="Trail, peak, waterfall, park…"
          value={f.text}
          onChange={(e) => set({ text: e.target.value })}
          autoFocus
        />
        <button className={`btn ${showFilters ? "primary" : ""}`} onClick={() => setShowFilters(!showFilters)}>Filters</button>
      </div>

      {showFilters && (
        <div className="filters">
          <label>Difficulty</label>
          <div className="chips">
            {(["easy", "moderate", "hard"] as const).map((d) => (
              <button key={d} className={`chip ${f.difficulty.has(d) ? "on" : ""}`} onClick={() => set({ difficulty: toggleIn(f.difficulty, d) })}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          <label>Has</label>
          <div className="chips">
            {FILTERABLE.map((k) => (
              <button key={k} className={`chip ${f.has.has(k) ? "on" : ""}`} onClick={() => set({ has: toggleIn(f.has, k) })}>
                {FEATURE_META[k].icon} {FEATURE_META[k].label}
              </button>
            ))}
          </div>

          <label>Route</label>
          <div className="chips">
            {(["any", "loop", "out-and-back"] as const).map((t) => (
              <button key={t} className={`chip ${f.type === t ? "on" : ""}`} onClick={() => set({ type: t })}>
                {t === "any" ? "Any" : t === "loop" ? "Loop" : "Out & back"}
              </button>
            ))}
          </div>

          <label>Max length: {f.maxLength ? `${f.maxLength} mi` : "any"}</label>
          <input type="range" min={0} max={16} step={1} value={f.maxLength} onChange={(e) => set({ maxLength: +e.target.value })} />

          <label>Max elevation gain: {f.maxGain ? `${f.maxGain.toLocaleString()} ft` : "any"}</label>
          <input type="range" min={0} max={4000} step={250} value={f.maxGain} onChange={(e) => set({ maxGain: +e.target.value })} />

          <label>Within: {f.maxDrive ? `${f.maxDrive} mi of you` : "any distance"}{!me && f.maxDrive ? " (turn on location)" : ""}</label>
          <input type="range" min={0} max={200} step={10} value={f.maxDrive} onChange={(e) => set({ maxDrive: +e.target.value })} />

          <button className="btn" onClick={() => setFilters({ ...defaultFilters(), text: f.text })}>Clear filters</button>
        </div>
      )}

      <div className="result-bar">
        <span>{rows.length.toLocaleString()} hikes</span>
        <select value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          <option value="distance">Closest to me</option>
          <option value="length">Shortest</option>
          <option value="gain">Least climbing</option>
          <option value="difficulty">Easiest</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="list">
        {rows.slice(0, limit).map(({ t, d }) => <TrailCard key={t.id} t={t} distance={d} />)}
        {rows.length > limit && <button className="btn" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
        {!rows.length && <p className="muted">No hikes match. Try fewer filters.</p>}
      </div>
    </div>
  );
}
