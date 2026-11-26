// Trail statistics: length, elevation profile, gain, difficulty, time estimate.
import * as turf from "@turf/turf";
import type { Feature, LineString } from "geojson";
import { elevationAt } from "./elevation.ts";

export const M_TO_FT = 3.28084;
export const KM_TO_MI = 0.621371;
const SAMPLE_M = 25;

export type ProfilePoint = { mi: number; ft: number; lon: number; lat: number };

export type RouteType = "loop" | "out-and-back" | "point-to-point";

export type Stats = {
  lengthMi: number;
  gainFt: number;
  lossFt: number;
  highFt: number;
  lowFt: number;
  rating: number;
  difficulty: Difficulty;
  difficultySimple: "easy" | "moderate" | "hard";
  hours: number;
  profile: ProfilePoint[];
};

export type Difficulty = "easiest" | "moderate" | "moderately strenuous" | "strenuous" | "very strenuous";

/** Elevation profile sampled every 25 m along a line (one-way). */
export async function profileOf(line: Feature<LineString>): Promise<ProfilePoint[]> {
  const km = turf.length(line, { units: "kilometers" });
  const steps = Math.max(2, Math.ceil((km * 1000) / SAMPLE_M) + 1);
  const pts: ProfilePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const d = Math.min(km, (i * km) / (steps - 1));
    const [lon, lat] = turf.along(line, d, { units: "kilometers" }).geometry.coordinates;
    pts.push({ mi: d * KM_TO_MI, ft: 0, lon, lat });
  }
  const elev = await Promise.all(pts.map((p) => elevationAt(p.lon, p.lat)));
  // Light smoothing (5-point moving average) removes DEM pixel noise before gain is summed.
  for (let i = 0; i < pts.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) { s += elev[j]; n++; }
    pts[i].ft = (s / n) * M_TO_FT;
  }
  return pts;
}

/** Sum climbs and descents, ignoring wiggles under 10 ft (hysteresis). */
function gainLoss(ft: number[]): { gain: number; loss: number } {
  const T = 10;
  let gain = 0, loss = 0, ref = ft[0];
  for (const h of ft) {
    if (h - ref >= T) { gain += h - ref; ref = h; }
    else if (ref - h >= T) { loss += ref - h; ref = h; }
  }
  return { gain, loss };
}

/** Shenandoah NP hiking rating: sqrt(2 × gain_ft × miles). */
export function rate(gainFt: number, miles: number): { rating: number; difficulty: Difficulty; simple: Stats["difficultySimple"] } {
  const rating = Math.sqrt(2 * gainFt * miles);
  const difficulty: Difficulty =
    rating < 50 ? "easiest" : rating < 100 ? "moderate" : rating < 150 ? "moderately strenuous" : rating < 200 ? "strenuous" : "very strenuous";
  const simple = rating < 50 ? "easy" : rating < 150 ? "moderate" : "hard";
  return { rating, difficulty, simple };
}

/** 30 min per mile + 30 min per 1,000 ft of climb. */
export function hoursFor(miles: number, gainFt: number): number {
  return miles / 2 + gainFt / 2000;
}

export async function statsFor(line: Feature<LineString>, type: RouteType): Promise<Stats> {
  const profile = await profileOf(line);
  const ft = profile.map((p) => p.ft);
  let { gain, loss } = gainLoss(ft);
  let lengthMi = profile.at(-1)!.mi;
  let fullProfile = profile;
  if (type === "out-and-back") {
    // Walk it there and back: the descents become climbs on the return.
    const g = gain + loss;
    gain = g; loss = g;
    const back = profile.slice(0, -1).reverse().map((p) => ({ ...p, mi: 2 * lengthMi - p.mi }));
    fullProfile = [...profile, ...back];
    lengthMi *= 2;
  }
  const { rating, difficulty, simple } = rate(gain, lengthMi);
  return {
    lengthMi: round(lengthMi, 2),
    gainFt: Math.round(gain),
    lossFt: Math.round(loss),
    highFt: Math.round(Math.max(...ft)),
    lowFt: Math.round(Math.min(...ft)),
    rating: Math.round(rating),
    difficulty,
    difficultySimple: simple,
    hours: round(hoursFor(lengthMi, gain), 1),
    profile: thin(fullProfile, 200).map((p) => ({ mi: round(p.mi, 3), ft: Math.round(p.ft), lon: round(p.lon, 6), lat: round(p.lat, 6) })),
  };
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]);
  return out;
}

export const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
