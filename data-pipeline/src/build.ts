// Build trail data for a region: trails with stats, features along each trail, and a sample report.
// Usage: npx tsx src/build.ts shenandoah
import * as turf from "@turf/turf";
import type { Feature, LineString, Position } from "geojson";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchOsm, fetchNetwork, type OsmElement } from "./osm.ts";
import { Graph } from "./router.ts";
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

const dist = (a: Position, b: Position) => turf.distance(a, b, { units: "meters" });

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

async function buildHike(def: HikeDef, all: Poi[]): Promise<Trail | string> {
  const graph = new Graph(await fetchNetwork(def.id, def.within));
  const here = (p: Poi) => inBox([[p.lon, p.lat]], def.within);

  // Waypoints: a feature name or a point.
  const stops: Position[] = [];
  for (const w of def.via) {
    if (typeof w !== "string") { stops.push(w); continue; }
    const poi = all.find((p) => p.name === w && here(p));
    if (!poi) {
      const names = [...new Set(all.filter((p) => here(p) && p.name && p.kind !== "parking").map((p) => `${p.name} (${p.kind})`))].sort();
      return `no feature named "${w}". Named features in the area: ${names.join("; ")}`;
    }
    stops.push([poi.lon, poi.lat]);
  }

  // Parking: the matching lot nearest the first stop.
  const lots = all.filter((p) => p.kind === "parking" && here(p) && p.name && def.parking.test(p.name));
  if (!lots.length) {
    const names = all.filter((p) => p.kind === "parking" && here(p) && p.name).map((p) => p.name).sort();
    return `no parking lot matching ${def.parking}. Named lots in the area: ${names.join("; ")}`;
  }
  const lot = lots.sort((a, b) => dist([a.lon, a.lat], stops[0]) - dist([b.lon, b.lat], stops[0]))[0];

  // Route lot -> stops (-> lot for a loop). Later legs avoid paths already walked, so loops come back another way.
  const points = [[lot.lon, lot.lat], ...stops, ...(def.type === "loop" ? [[lot.lon, lot.lat]] : [])];
  const nodes = points.map((p) => graph.nearest(p));
  const far = nodes.find((n) => n.meters > 300);
  if (far) return `a waypoint is ${Math.round(far.meters)} m from the nearest mapped path`;
  const used = new Set<number>();
  const path: number[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const leg = graph.route(nodes[i - 1].node, nodes[i].node, used);
    if (!leg) return "no connected path between the parking lot and a waypoint";
    leg.edges.forEach((e) => used.add(e));
    path.push(...(path.length ? leg.path.slice(1) : leg.path));
  }
  const coords = path.map((n) => graph.coords[n]);
  const line = turf.lineString(coords);
  const stats = await statsFor(line, def.type);
  const { profile, ...rest } = stats;
  const features = featuresAlong(line, all, ON_TRAIL, 100);
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    stats: rest,
    profile,
    features,
    parking: [{ id: lot.id, kind: "parking", name: lot.name, lon: lot.lon, lat: lot.lat, mi: 0, offTrailFt: Math.round(nodes[0].meters * 3.28084) }],
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
  console.log(`${all.length} features`);

  const trails: Trail[] = [];
  const problems: string[] = [];
  for (const def of region.hikes) {
    const t = await buildHike(def, all);
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
      `Parking: ${t.parking.length ? t.parking.map((p) => `${p.name ?? p.kind} (start and end)`).join(", ") : "none"}`,
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
