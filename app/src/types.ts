export type FeatureKind = "parking" | "campsite" | "shelter" | "water" | "viewpoint" | "waterfall" | "peak" | "trailhead" | "toilets" | "landmark";

export type Difficulty = "easiest" | "moderate" | "moderately strenuous" | "strenuous" | "very strenuous";

export type TrailSummary = {
  id: string;
  name: string;
  type: "loop" | "out-and-back" | "point-to-point";
  dest: FeatureKind | null;
  lengthMi: number;
  gainFt: number;
  lossFt: number;
  highFt: number;
  lowFt: number;
  rating: number;
  difficulty: Difficulty;
  difficultySimple: "easy" | "moderate" | "hard";
  hours: number;
  counts: Partial<Record<FeatureKind, number>>;
  via: string[];
  parking: { name: string | null; lon: number; lat: number };
  bbox: [number, number, number, number];
  /** Park, forest or wilderness the hike is in (older data may not have it). */
  area?: string | null;
  /** General camping rules for that land manager. */
  camping?: string | null;
  /** "entrance": park entrance fee; "parking": paid lot; "free": lot marked free; null: not known (usually free). */
  fee?: "entrance" | "parking" | "free" | null;
  /** Free camping along the way or allowed on this land (dispersed, AT shelters). */
  freeCamping?: boolean;
  /** National Park Service unit, for park alerts. */
  parkCode?: string | null;
};

export type ProfilePoint = { mi: number; ft: number; lon: number; lat: number };
/** info: e.g. "Lean-to shelter · free" for campsites and shelters. */
export type TrailFeature = { kind: FeatureKind; name?: string; lon: number; lat: number; mi: number; info?: string };

export type TrailDetail = TrailSummary & {
  profile: ProfilePoint[];
  features: TrailFeature[];
  geometry: [number, number][];
};

export const FEATURE_META: Record<FeatureKind, { label: string; icon: string; color: string }> = {
  parking: { label: "Parking", icon: "P", color: "#3a6ea5" },
  trailhead: { label: "Trailhead", icon: "T", color: "#3a6ea5" },
  campsite: { label: "Campsite", icon: "⛺", color: "#8a5a2b" },
  shelter: { label: "Shelter", icon: "⌂", color: "#8a5a2b" },
  water: { label: "Water", icon: "💧", color: "#1d7fb8" },
  viewpoint: { label: "Viewpoint", icon: "👁", color: "#7a4fa3" },
  waterfall: { label: "Waterfall", icon: "≋", color: "#1d7fb8" },
  peak: { label: "Peak", icon: "▲", color: "#5b4a3a" },
  toilets: { label: "Toilets", icon: "WC", color: "#666" },
  landmark: { label: "Landmark", icon: "★", color: "#b5651d" },
};

export const DIFFICULTY_COLOR: Record<TrailSummary["difficultySimple"], string> = {
  easy: "#3f8f4f",
  moderate: "#d08a1f",
  hard: "#b53a2e",
};
