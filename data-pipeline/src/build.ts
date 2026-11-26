// Build trail data for a region: trails with stats, features along each trail, and a sample report.
// Usage: npx tsx src/build.ts shenandoah
import * as turf from "@turf/turf";
import type { Feature, LineString, Position } from "geojson";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchOsm, type OsmElement } from "./osm.ts";
import { statsFor, round, KM_TO_MI, type RouteType, type Stats } from "./stats.ts";
import { REGIONS, type HikeDef } from "./regions.ts";

export type FeatureKind = "parking" | "campsite" | "shelter" | "water" | "viewpoint" | "waterfall" | "peak" | "trailhead" | "toilets" | "landmark";

type Poi = { id: string; kind: FeatureKind; name?: string; lon: number; lat: number; tags: Record<string, string> };

export type TrailFeature = { id: string; kind: FeatureKind; name?: string; lon: number; lat: number; mi: number; offTrailFt: number };

export type Trail = {
  id: string;
  name: string;
  type: RouteType;
  stats: Omit<Stats, "profile">;
  profile: Stats["profile"];
  features: TrailFeature[];
  parking: TrailFeature[];
  geometry: Position[];
  bbox: number[];
  source: string;
};

function kindOf(t: Record<string, string>): FeatureKind | null {
  if (t.amenity === "parking") return "parking";
  if (t.tourism === "camp_site" || t.tourism === "camp_pitch") return "campsite";
  if (t.tourism === "wilderness_hut" || t.tourism === "alpine_hut" || t.amenity === "shelter") return "shelter";
  if (t.amenity === "drinking_water" || t.natural === "spring" || t.man_made === "water_tap") return "water";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.waterway === "waterfall") return "waterfall";
  if (t.natural === "peak") return "peak";
  if (t.highway === "trailhead") return "trailhead";
  if (t.amenity === "toilets") return "toilets";
  if (t.natural === "cave_entrance" || t.tourism === "information") return "landmark";
  return null;
}

function pois(elements: OsmElement[]): Poi[] {
  const out: Poi[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    const kind = kindOf(t);
    if (!kind) continue;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    out.push({ id: `${e.type[0]}${e.id}`, kind, name: t.name, lon, lat, tags: t });
  }
  return out;
}

type Segment = { name: string; coords: Position[]; osmId: string };

function segments(elements: OsmElement[]): Segment[] {
  return elements
    .filter((e) => e.type === "way" && e.geometry && e.tags?.name && kindOf(e.tags) === null)
    .map((e) => ({ name: e.tags!.name, coords: e.geometry!.map((g) => [g.lon, g.lat]), osmId: `w${e.id}` }));
}

const dist = (a: Position, b: Position) => turf.distance(a, b, { units: "meters" });

/** Chain segments end to end into one continuous line, flipping segments as needed (greedy nearest end). */
function chain(segs: Position[][], start?: Position): Position[] {
  const left = segs.map((s) => [...s]);
  let line: Position[];
  if (start) {
    // Begin with the segment end nearest the given start point.
    let bi = 0, flip = false, bd = Infinity;
    left.forEach((s, i) => {
      const d0 = dist(s[0], start), d1 = dist(s.at(-1)!, start);
      if (d0 < bd) { bd = d0; bi = i; flip = false; }
      if (d1 < bd) { bd = d1; bi = i; flip = true; }
    });
    line = flip ? left[bi].reverse() : left[bi];
    left.splice(bi, 1);
  } else {
    line = left.shift()!;
  }
  while (left.length) {
    const end = line.at(-1)!;
    let bi = 0, flip = false, bd = Infinity;
    left.forEach((s, i) => {
      const d0 = dist(s[0], end), d1 = dist(s.at(-1)!, end);
      if (d0 < bd) { bd = d0; bi = i; flip = false; }
      if (d1 < bd) { bd = d1; bi = i; flip = true; }
    });
    const s = flip ? left[bi].reverse() : left[bi];
    left.splice(bi, 1);
    line.push(...(dist(s[0], end) < 1 ? s.slice(1) : s));
  }
  return line;
}

function featuresAlong(line: Feature<LineString>, all: Poi[], kinds: FeatureKind[], maxM: number): TrailFeature[] {
  const bbox = turf.bbox(turf.buffer(line, maxM / 1000, { units: "kilometers" })!);
  const out: TrailFeature[] = [];
  for (const p of all) {
    if (!kinds.includes(p.kind)) continue;
    if (p.lon < bbox[0] || p.lon > bbox[2] || p.lat < bbox[1] || p.lat > bbox[3]) continue;
    const near = turf.nearestPointOnLine(line, [p.lon, p.lat], { units: "kilometers" });
    const off = (near.properties.dist ?? 0) * 1000;
    if (off > maxM) continue;
    out.push({ id: p.id, kind: p.kind, name: p.name, lon: p.lon, lat: p.lat, mi: round((near.properties.location ?? 0) * KM_TO_MI, 2), offTrailFt: Math.round(off * 3.28084) });
  }
  // One entry per named thing (OSM sometimes maps a viewpoint twice).
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.mi - b.mi)
    .filter((f) => {
      const k = `${f.kind}:${f.name ?? f.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const ON_TRAIL: FeatureKind[] = ["campsite", "shelter", "water", "viewpoint", "waterfall", "peak", "toilets", "landmark"];

async function buildHike(def: HikeDef, segs: Segment[], all: Poi[]): Promise<Trail | string> {
  const parts: Position[][] = [];
  for (const want of def.segments) {
    const hits = segs.filter((s) => s.name === want && inBox(s.coords, def.within));
    if (!hits.length) {
      const nearby = [...new Set(segs.filter((s) => inBox(s.coords, def.within)).map((s) => s.name))].sort();
      return `no OSM segment named "${want}" in the area. Names nearby: ${nearby.join("; ")}`;
    }
    parts.push(chain(hits.map((h) => h.coords)));
  }
  const coords = chain(parts, def.start);
  const line = turf.lineString(coords);
  const stats = await statsFor(line, def.type);
  const { profile, ...rest } = stats;
  const features = featuresAlong(line, all, ON_TRAIL, 150);
  const ends = turf.lineString([coords[0], coords.at(-1)!]);
  const parking = featuresAlong(ends, all, ["parking", "trailhead"], 500).map((p) => ({ ...p, mi: 0 }));
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    stats: rest,
    profile,
    features,
    parking,
    geometry: turf.cleanCoords(turf.simplify(line, { tolerance: 0.00002 })).geometry.coordinates.map(([x, y]: Position) => [round(x, 6), round(y, 6)]),
    bbox: turf.bbox(line).map((n) => round(n, 5)),
    source: "OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP)",
  };
}

function inBox(coords: Position[], box?: [number, number, number, number]) {
  if (!box) return true;
  return coords.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]);
}

async function main() {
  const regionId = process.argv[2] ?? "shenandoah";
  const region = REGIONS[regionId];
  if (!region) throw new Error(`unknown region ${regionId}`);
  console.log(`Fetching OSM data for ${region.name}…`);
  const elements = await fetchOsm(regionId, region.bbox);
  const all = pois(elements);
  const segs = segments(elements);
  console.log(`${segs.length} named trail segments, ${all.length} features`);

  const trails: Trail[] = [];
  const problems: string[] = [];
  for (const def of region.hikes) {
    const t = await buildHike(def, segs, all);
    if (typeof t === "string") { problems.push(`${def.name}: ${t}`); continue; }
    trails.push(t);
    console.log(`  ${t.name}: ${t.stats.lengthMi} mi, +${t.stats.gainFt} ft, ${t.stats.difficulty}, ${t.features.length} features`);
  }

  const outDir = path.resolve(import.meta.dirname, `../../data/${regionId}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "trails.json"), JSON.stringify({ region: region.name, generated: new Date().toISOString(), trails }));
  await writeFile(path.join(outDir, "features.geojson"), JSON.stringify(turf.featureCollection(all.map((p) => turf.point([p.lon, p.lat], { id: p.id, kind: p.kind, name: p.name ?? null })))));
  await writeFile(path.join(outDir, "SAMPLE.md"), report(region.name, trails, problems, all));
  console.log(`Wrote ${trails.length} trails to ${outDir}`);
  if (problems.length) console.log("Problems:\n  " + problems.join("\n  "));
}

function report(name: string, trails: Trail[], problems: string[], all: Poi[]): string {
  const count = (k: FeatureKind) => all.filter((p) => p.kind === k).length;
  const lines = [
    `# ${name}: sample trail data`,
    "",
    `Features found in the park area: ${count("parking")} parking, ${count("campsite")} campsites, ${count("shelter")} shelters, ${count("water")} water sources, ${count("viewpoint")} viewpoints, ${count("waterfall")} waterfalls, ${count("peak")} peaks.`,
    "",
    "| Trail | Type | Length (mi) | Gain (ft) | High point (ft) | Difficulty (rating) | Est. time (h) | Features on trail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...trails.map((t) => {
      const f = summarize(t.features);
      return `| ${t.name} | ${t.type} | ${t.stats.lengthMi} | ${t.stats.gainFt} | ${t.stats.highFt} | ${t.stats.difficulty} (${t.stats.rating}) | ${t.stats.hours} | ${f} |`;
    }),
    "",
    ...trails.flatMap((t) => [
      `## ${t.name}`,
      "",
      `Parking: ${t.parking.length ? t.parking.map((p) => `${p.name ?? p.kind} (${p.offTrailFt} ft from trail end)`).join(", ") : "none found within 500 m of the ends"}`,
      "",
      ...t.features.map((f) => `- mile ${f.mi.toFixed(1)}: ${f.kind}${f.name ? ` — ${f.name}` : ""}`),
      "",
    ]),
    problems.length ? "## Not built\n\n" + problems.map((p) => `- ${p}`).join("\n") + "\n" : "",
  ];
  return lines.join("\n");
}

function summarize(fs: TrailFeature[]): string {
  const c: Record<string, number> = {};
  fs.forEach((f) => (c[f.kind] = (c[f.kind] ?? 0) + 1));
  return Object.entries(c).map(([k, n]) => `${n} ${k}`).join(", ") || "none";
}

main().catch((e) => { console.error(e); process.exit(1); });
