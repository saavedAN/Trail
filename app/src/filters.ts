import type { FeatureKind, TrailSummary } from "./types";
import { milesBetween, type LonLat } from "./geo";

export type SortKey = "distance" | "length" | "gain" | "difficulty" | "name";

export type Filters = {
  text: string;
  difficulty: Set<TrailSummary["difficultySimple"]>;
  maxLength: number; // miles; 0 = any
  maxGain: number; // feet; 0 = any
  has: Set<FeatureKind>;
  type: "any" | "loop" | "out-and-back";
  maxDrive: number; // straight-line miles from you; 0 = any
  sort: SortKey;
};

export const defaultFilters = (): Filters => ({
  text: "", difficulty: new Set(), maxLength: 0, maxGain: 0, has: new Set(), type: "any", maxDrive: 0, sort: "distance",
});

export const FILTERABLE: FeatureKind[] = ["waterfall", "viewpoint", "peak", "water", "campsite", "shelter"];

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "");

export function applyFilters(all: TrailSummary[], f: Filters, me: LonLat | null) {
  const q = norm(f.text.trim());
  const dist = (t: TrailSummary) => (me ? milesBetween(me, t.parking) : null);
  const rows = all
    .filter((t) => {
      if (q && !norm(`${t.name} ${t.via.join(" ")} ${t.parking.name ?? ""}`).includes(q)) return false;
      if (f.difficulty.size && !f.difficulty.has(t.difficultySimple)) return false;
      if (f.maxLength && t.lengthMi > f.maxLength) return false;
      if (f.maxGain && t.gainFt > f.maxGain) return false;
      if (f.type !== "any" && t.type !== f.type) return false;
      for (const k of f.has) if (!(t.counts[k] || t.dest === k)) return false;
      if (f.maxDrive && me && (dist(t) ?? 0) > f.maxDrive) return false;
      return true;
    })
    .map((t) => ({ t, d: dist(t) }));
  const by: Record<SortKey, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
    distance: (a, b) => (a.d ?? 0) - (b.d ?? 0) || a.t.name.localeCompare(b.t.name),
    length: (a, b) => a.t.lengthMi - b.t.lengthMi,
    gain: (a, b) => a.t.gainFt - b.t.gainFt,
    difficulty: (a, b) => a.t.rating - b.t.rating,
    name: (a, b) => a.t.name.localeCompare(b.t.name),
  };
  return rows.sort(by[me || f.sort !== "distance" ? f.sort : "name"]);
}
