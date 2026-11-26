import { DIFFICULTY_COLOR, FEATURE_META, type FeatureKind, type TrailSummary } from "./types";

export const fmtFt = (n: number) => `${Math.round(n).toLocaleString()} ft`;
export const fmtMi = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} mi`;
export function fmtHours(h: number) {
  if (h < 1) return `${Math.max(10, Math.round((h * 60) / 5) * 5)} min`;
  const whole = Math.floor(h), min = Math.round(((h - whole) * 60) / 5) * 5;
  return min ? `${whole} h ${min} min` : `${whole} h`;
}
export const typeLabel = (t: TrailSummary["type"]) => (t === "out-and-back" ? "Out & back" : t === "loop" ? "Loop" : "Point to point");

export const go = (hash: string) => { location.hash = hash; };

export function DifficultyPill({ t }: { t: Pick<TrailSummary, "difficultySimple" | "difficulty"> }) {
  return (
    <span className="pill" style={{ background: DIFFICULTY_COLOR[t.difficultySimple] }} title={`Shenandoah rating: ${t.difficulty}`}>
      {t.difficultySimple === "easy" ? "Easy" : t.difficultySimple === "moderate" ? "Moderate" : "Hard"}
    </span>
  );
}

export function FeatureIcons({ counts, dest }: { counts: TrailSummary["counts"]; dest?: FeatureKind | null }) {
  const kinds = (Object.keys(FEATURE_META) as FeatureKind[]).filter((k) => (counts[k] || dest === k) && k !== "toilets" && k !== "trailhead");
  if (!kinds.length) return null;
  return (
    <span className="icons">
      {kinds.map((k) => (
        <span key={k} className="ficon" style={{ color: FEATURE_META[k].color }} title={FEATURE_META[k].label}>
          {FEATURE_META[k].icon}
        </span>
      ))}
    </span>
  );
}

export function TrailCard({ t, distance, badge }: { t: TrailSummary; distance?: number | null; badge?: string }) {
  return (
    <button className="card" onClick={() => go(`#/trail/${t.id}`)}>
      <div className="card-top">
        <span className="card-name">{t.name}</span>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="card-meta">
        <DifficultyPill t={t} />
        <span>{fmtMi(t.lengthMi)}</span>
        <span>↑ {fmtFt(t.gainFt)}</span>
        <span>{fmtHours(t.hours)}</span>
        <span>{typeLabel(t.type)}</span>
      </div>
      <div className="card-sub">
        <FeatureIcons counts={t.counts} dest={t.dest} />
        <span className="muted">{t.parking.name ?? "Trailhead parking"}{distance != null ? ` · ${Math.round(distance)} mi away` : ""}</span>
      </div>
    </button>
  );
}
