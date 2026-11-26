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
};

export type ProfilePoint = { mi: number; ft: number; lon: number; lat: number };
export type TrailFeature = { kind: FeatureKind; name?: string; lon: number; lat: number; mi: number };

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
