// Build all hikes for a region from an osmium GeoJSON-sequence export.
// Usage: tsx src/build.ts <region> <export.geojsonseq>
//
// Hikes come from two places:
//  1. Automatic: for every named waterfall, peak, viewpoint or landmark reachable on trails, the route from the
//     nearest parking lot (by walking distance), out and back. This is how most AllTrails-style hikes look.
//  2. Hand-made: loops listed in regions.ts.
import * as turf from "@turf/turf";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Network, edgeKey, haversine } from "./network.ts";
import { REGIONS, type HikeDef, type Box, type Region } from "./regions.ts";
import { regionShape } from "./region.ts";
import { areaFrom, campInfo, landFor, npsPark, type Area } from "./camping.ts";
import { statsFor, round, KM_TO_MI, type RouteType } from "./stats.ts";

export type FeatureKind = "parking" | "campsite" | "shelter" | "water" | "viewpoint" | "waterfall" | "peak" | "trailhead" | "toilets" | "landmark";

type Poi = { id: string; kind: FeatureKind; name?: string; lon: number; lat: number; info?: string; fee?: string };
export type TrailFeature = { kind: FeatureKind; name?: string; lon: number; lat: number; mi: number; info?: string };

const MAX_ONE_WAY_M = 13000; // ~8 miles each way
const MIN_ONE_WAY_M = 400; // shorter than this is a roadside stop, not a hike
const DEST_KINDS: FeatureKind[] = ["waterfall", "peak", "viewpoint", "landmark"];
const ON_TRAIL: FeatureKind[] = ["campsite", "shelter", "water", "viewpoint", "waterfall", "peak", "toilets", "landmark"];

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
  if (t.name && (t.natural === "cliff" || t.natural === "rock" || t.natural === "cave_entrance" || t.natural === "arch" || t.tourism === "attraction")) return "landmark";
  return null;
}

const inBox = (lon: number, lat: number, b: Box) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

async function load(file: string, region: Region) {
  const shape = regionShape(region);
  const inRegion = (lon: number, lat: number) => inBox(lon, lat, region.bbox) || turf.booleanPointInPolygon([lon, lat], shape);
  const net = new Network();
  const pois: Poi[] = [];
  const areas: Area[] = [];
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, "").trim();
    if (!line) continue;
    const f = JSON.parse(line);
    const t: Record<string, string> = f.properties ?? {};
    const g = f.geometry;
    if (!g) continue;
    const area = areaFrom(f, t);
    if (area) areas.push(area);
    const kind = kindOf(t);
    if (kind) {
      const c: number[] = g.type === "Point" ? g.coordinates : turf.centroid(f).geometry.coordinates;
      if (inRegion(c[0], c[1])) pois.push({ id: `${String(t["@type"] ?? "x")[0]}${t["@id"] ?? pois.length}`, kind, name: t.name, lon: c[0], lat: c[1], info: campInfo(t), fee: t.fee });
    }
    if (t.highway && g.type === "LineString" && kind === null) net.addWay(g.coordinates, t);
  }
  net.finish();
  return { net, pois, areas };
}

class PoiIndex {
  private grid = new Map<string, Poi[]>();
  constructor(pois: Poi[]) {
    for (const p of pois) {
      const k = `${Math.floor(p.lon / 0.01)},${Math.floor(p.lat / 0.01)}`;
      let c = this.grid.get(k);
      if (!c) { c = []; this.grid.set(k, c); }
      c.push(p);
    }
  }
  near(lon: number, lat: number): Poi[] {
    const cx = Math.floor(lon / 0.01), cy = Math.floor(lat / 0.01), out: Poi[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(this.grid.get(`${cx + dx},${cy + dy}`) ?? []));
    return out;
  }
}

type Route = { coords: number[][]; trailM: number; roadM: number; viaNames: string[] };

function toRoute(net: Network, path: number[], edges: number[]): Route {
  let trailM = 0, roadM = 0;
  const names: string[] = [];
  for (const k of edges) {
    if (net.trail[k]) trailM += net.len[k]; else roadM += net.len[k];
    const n = net.names[net.edgeName[k]];
    if (n && net.trail[k] && names.at(-1) !== n) names.push(n);
  }
  return { coords: path.map((i) => [net.lon[i], net.lat[i]]), trailM, roadM, viaNames: [...new Set(names)] };
}

function featuresAlong(coords: number[][], idx: PoiIndex, maxM: number): TrailFeature[] {
  const line = turf.lineString(coords);
  const seen = new Map<string, TrailFeature>();
  const cand = new Map<string, Poi>();
  for (let i = 0; i < coords.length; i += 5) for (const p of idx.near(coords[i][0], coords[i][1])) cand.set(p.id, p);
  for (const p of idx.near(coords.at(-1)![0], coords.at(-1)![1])) cand.set(p.id, p);
  for (const p of cand.values()) {
    if (!ON_TRAIL.includes(p.kind)) continue;
    const near = turf.nearestPointOnLine(line, [p.lon, p.lat], { units: "kilometers" });
    if ((near.properties.dist ?? 1) * 1000 > maxM) continue;
    const key = `${p.kind}:${p.name ?? `${round(p.lon, 3)},${round(p.lat, 3)}`}`;
    if (!seen.has(key)) seen.set(key, { kind: p.kind, name: p.name, lon: round(p.lon, 6), lat: round(p.lat, 6), mi: round((near.properties.location ?? 0) * KM_TO_MI, 2), ...(p.info ? { info: p.info } : {}) });
  }
  return [...seen.values()].sort((a, b) => a.mi - b.mi);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

type Hike = {
  id: string; name: string; type: RouteType; dest?: FeatureKind; route: Route;
  parking: { name?: string; lon: number; lat: number; fee?: string };
};

async function main() {
  const [regionId = "virginia", file] = process.argv.slice(2);
  const region = REGIONS[regionId];
  if (!region || !file) throw new Error("usage: build.ts <region> <export.geojsonseq>");
  console.time("load");
  const { net, pois, areas } = await load(file, region);
  console.log(`${areas.length} parks and forests`);
  const forests = [...new Set(areas.map((a) => a.name).filter((n) => /national (forest|park|scenic)|wilderness/i.test(n)))];
  console.log(`  federal lands: ${forests.join("; ")}`);
  // All named areas containing a point, smallest first.
  const areasAt = (lon: number, lat: number) => {
    const hits: Area[] = [];
    for (const a of areas) {
      const [w, s, e, n] = a.bbox ??= turf.bbox(a.shape);
      if (lon < w || lon > e || lat < s || lat > n) continue;
      if (turf.booleanPointInPolygon([lon, lat], a.shape)) hits.push(a);
    }
    return hits.sort((x, y) => x.area - y.area);
  };
  let noArea = 0;

  console.timeEnd("load");
  console.log(`${net.nodeCount} nodes, ${pois.length} features`);
  const idx = new PoiIndex(pois);

  // Snap parking lots to the network.
  const lotAt = new Map<number, Poi>();
  for (const p of pois) {
    if (p.kind !== "parking") continue;
    const s = net.nearest(p.lon, p.lat, 200);
    if (s && (!lotAt.has(s.node) || (!lotAt.get(s.node)!.name && p.name))) lotAt.set(s.node, p);
  }
  console.log(`${lotAt.size} parking lots on the network`);

  const hikes: Hike[] = [];
  const problems: string[] = [];

  // 1. Hand-made hikes.
  const curatedDest = new Set<string>();
  for (const def of region.hikes) {
    const h = curated(def, net, pois, lotAt);
    if (typeof h === "string") { problems.push(`${def.name}: ${h}`); continue; }
    hikes.push(h);
    def.via.forEach((v) => curatedDest.add(v));
  }

  // 2. Automatic hikes: nearest lot (by walking) to each named destination.
  const prio: Record<string, number> = { waterfall: 0, peak: 1, landmark: 2, viewpoint: 3 };
  const dests = pois
    .filter((p) => DEST_KINDS.includes(p.kind) && p.name && !curatedDest.has(p.name))
    .sort((a, b) => prio[a.kind] - prio[b.kind]);
  console.log(`${dests.length} named destinations`);
  // Trailheads without a mapped lot: snapped trailhead nodes, then any trail/road junction.
  const trailheadAt = new Map<number, Poi>();
  for (const p of pois) {
    if (p.kind !== "trailhead") continue;
    const s = net.nearest(p.lon, p.lat, 150);
    if (s) trailheadAt.set(s.node, p);
  }
  const auto: Hike[] = [];
  const skip: Record<string, number> = {};
  const watch = /mcafee|dragon|tinker|sentinel|angel|cascade|old rag|whiteoak|dark hollow|humpback|crabtree/i;
  const why = (d: Poi, r: string) => { skip[r] = (skip[r] ?? 0) + 1; if (watch.test(d.name!)) console.log(`  skip ${d.name}: ${r}`); };
  for (const d of dests) {
    const s = net.nearest(d.lon, d.lat, 150, true);
    if (!s) { why(d, "not near a trail"); continue; }
    // Nearest place to start by walking: a lot, a mapped trailhead, or where the trail meets a road.
    let r = net.search(s.node, (n) => lotAt.has(n) || trailheadAt.has(n) || net.isJunction(n), MAX_ONE_WAY_M);
    if (!r) { why(d, "no road or lot within 8 miles"); continue; }
    if (!lotAt.has(r.node)) {
      // Prefer a real lot when one is only a little further.
      const lotRoute = net.search(s.node, (n) => lotAt.has(n), r.cost + 800);
      if (lotRoute) r = lotRoute;
    }
    const route = toRoute(net, [...r.path].reverse(), [...r.edges].reverse());
    const m = route.trailM + route.roadM;
    if (m < (d.kind === "waterfall" ? 150 : MIN_ONE_WAY_M)) { why(d, "roadside (too short)"); continue; }
    if (route.trailM < m * 0.6) { why(d, "mostly road walking"); continue; }
    const lot = lotAt.get(r.node) ?? trailheadAt.get(r.node);
    const parking = lot
      ? { name: lot.name, lon: lot.lon, lat: lot.lat, fee: lot.fee }
      : { name: net.roadName(r.node) ? `Roadside parking, ${net.roadName(r.node)}` : "Roadside parking", lon: net.lon[r.node], lat: net.lat[r.node] };
    auto.push({ id: "", name: d.name!, type: "out-and-back", dest: d.kind, route, parking });
    if (watch.test(d.name!)) console.log(`  built ${d.name}: ${(m / 1609.34).toFixed(1)} mi one way from ${parking.name}`);
  }
  console.log("Skipped destinations:", JSON.stringify(skip));

  // Drop a destination that sits on another hike from the same lot (it becomes a feature of that hike instead).
  // Waterfalls and peaks win over viewpoints; longer routes win over shorter ones.
  auto.sort((a, b) => prio[a.dest!] - prio[b.dest!] || (b.route.trailM - a.route.trailM));
  const kept: Hike[] = [];
  for (const h of auto) {
    const end = h.route.coords.at(-1)!;
    // Only viewpoints get folded into another hike; named falls, peaks and landmarks keep their own entry.
    const covered = h.dest === "viewpoint" && kept.some((k) => k.parking.lon === h.parking.lon && k.parking.lat === h.parking.lat &&
      k.route.coords.some((c, i) => i % 3 === 0 && haversine(c[0], c[1], end[0], end[1]) < 120));
    if (covered && watch.test(h.name)) console.log(`  ${h.name} is on another hike from the same lot`);
    const dupName = kept.some((k) => k.name === h.name && haversine(k.route.coords.at(-1)![0], k.route.coords.at(-1)![1], end[0], end[1]) < 2000);
    if (!covered && !dupName) kept.push(h);
  }
  hikes.push(...kept);
  console.log(`${kept.length} automatic hikes, ${hikes.length} total`);

  // 3. Named trails no hike walks yet (e.g. Billy Goat Trail): from the nearest lot to the far end, or around if it loops.
  const named = namedTrailHikes(net, lotAt, trailheadAt, hikes);
  hikes.push(...named);
  console.log(`${named.length} named-trail hikes, ${hikes.length} total`);
  for (const p of pois) if (p.name && DEBUG.test(p.name)) console.log(`  poi ${p.kind} "${p.name}" ${p.lon.toFixed(4)},${p.lat.toFixed(4)}`);

  // Stats, features, output.
  const outDir = path.resolve(import.meta.dirname, `../../data/${regionId}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, "trails"), { recursive: true });
  const ids = new Set<string>();
  const index: Summary[] = [];
  let done = 0;
  const work = hikes.map((h) => async () => {
    let id = slug(h.name) || "hike";
    for (let n = 2; ids.has(id); n++) id = `${slug(h.name)}-${n}`;
    ids.add(id);
    h.id = id;
    const coords = h.route.coords;
    const line = turf.lineString(coords);
    const stats = await statsFor(line, h.type);
    const { profile, ...rest } = stats;
    const features = featuresAlong(coords, idx, 100);
    const counts: Record<string, number> = {};
    features.forEach((f) => (counts[f.kind] = (counts[f.kind] ?? 0) + 1));
    const geometry = turf.cleanCoords(turf.simplify(line, { tolerance: 0.00002 })).geometry.coordinates.map(([x, y]: number[]) => [round(x, 6), round(y, 6)]);
    // Sample a few spots along the way (start, quarter points, turnaround) and pool the areas they fall in.
    const pooled = new Map<string, Area>();
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const c = coords[Math.floor((coords.length - 1) * f)];
      for (const a of areasAt(c[0], c[1])) pooled.set(a.name, a);
    }
    const inside = [...pooled.values()].sort((x, y) => x.area - y.area);
    if (!inside.length) noArea++;
    const names = inside.map((a) => a.name);
    const land = landFor(names, h.route.viaNames.some((v) => /^appalachian (national scenic )?trail$/i.test(v)));
    const park = npsPark(names);
    const lotFee = h.parking.fee;
    const fee = park?.entranceFee ? "entrance" : lotFee && lotFee !== "no" ? "parking" : lotFee === "no" ? "free" : null;
    const freeCamping = /\bfree\b/i.test(land.rule ?? "") || features.some((f) => (f.kind === "campsite" || f.kind === "shelter") && /\bfree\b/.test(f.info ?? ""));
    const summary: Summary = {
      id, name: h.name, type: h.type, dest: h.dest ?? null, area: land.area, camping: land.rule, fee, freeCamping, parkCode: park?.code ?? null,
      ...rest, counts, via: h.route.viaNames.slice(0, 4),
      parking: { name: h.parking.name ?? null, lon: round(h.parking.lon, 5), lat: round(h.parking.lat, 5) },
      bbox: turf.bbox(line).map((n) => round(n, 5)),
    };
    index.push(summary);
    await writeFile(path.join(outDir, "trails", `${id}.json`), JSON.stringify({ ...summary, profile, features, geometry }));
    if (++done % 250 === 0) console.log(`  ${done}/${hikes.length}`);
  });
  await pool(work, 8);
  index.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path.join(outDir, "index.json"), JSON.stringify({ region: region.name, generated: new Date().toISOString(), trails: index }));
  await writeFile(path.join(outDir, "SAMPLE.md"), report(region.name, index, problems));
  console.log(`Wrote ${index.length} hikes to ${outDir}`);
  console.log(`${noArea} hikes are outside any mapped park or forest`);
  if (problems.length) console.log("Problems:\n  " + problems.join("\n  "));
}

const DEBUG = /grandfather|calloway|mary.?s rock|bear rocks|billy goat|seneca rocks|mcafee/i;

/** Hikes along named trails that no other hike covers. */
function namedTrailHikes(net: Network, lotAt: Map<number, Poi>, trailheadAt: Map<number, Poi>, existing: Hike[]): Hike[] {
  const key = (lon: number, lat: number) => `${lon.toFixed(6)},${lat.toFixed(6)}`;
  const covered = new Set<string>();
  for (const h of existing) for (const c of h.route.coords) covered.add(key(c[0], c[1]));
  // Group trail edges by name, then into connected pieces (the same name is reused in many places).
  const byName = new Map<number, number[]>(); // name id -> node list (pairs)
  for (let u = 0; u < net.nodeCount; u++) {
    for (let k = net.off[u]; k < net.off[u + 1]; k++) {
      const v = net.to[k];
      if (v < u || !net.trail[k] || !net.edgeName[k]) continue;
      const nm = net.edgeName[k];
      const nmText = net.names[nm];
      if (/^appalachian (national scenic )?trail$/i.test(nmText)) continue;
      // Real trails only: skip named farm lanes, fire roads and streets that happen to be tracks.
      if (!/trail|loop|path|greenway|walk|\btr\b/i.test(nmText)) continue;
      let a = byName.get(nm);
      if (!a) byName.set(nm, (a = []));
      a.push(u, v, k);
    }
  }
  const out: Hike[] = [];
  const parent = new Map<number, number>();
  const find = (x: number): number => { let r = x; while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const skipped = { short: 0, covered: 0, noStart: 0, noRoute: 0, road: 0 };
  for (const [nm, list] of byName) {
    parent.clear();
    for (let i = 0; i < list.length; i += 3) {
      const a = find(list[i]), b = find(list[i + 1]);
      if (!parent.has(a)) parent.set(a, a);
      if (a !== b) parent.set(b, a);
    }
    const comps = new Map<number, { nodes: Map<number, number>; len: number }>();
    for (let i = 0; i < list.length; i += 3) {
      const r = find(list[i]);
      let c = comps.get(r);
      if (!c) comps.set(r, (c = { nodes: new Map(), len: 0 }));
      c.len += net.len[list[i + 2]];
      for (const n of [list[i], list[i + 1]]) c.nodes.set(n, (c.nodes.get(n) ?? 0) + 1);
    }
    for (const c of comps.values()) {
      if (c.len < 1500 || c.len > 30000) { skipped.short++; continue; }
      let cov = 0;
      for (const n of c.nodes.keys()) if (covered.has(key(net.lon[n], net.lat[n]))) cov++;
      if (cov > c.nodes.size * 0.4) { skipped.covered++; continue; }
      const nodes = [...c.nodes.keys()];
      const ends = nodes.filter((n) => c.nodes.get(n) === 1);
      // Start: nearest lot or trailhead to any point of the trail (search from one end, or any node for a loop).
      const from = ends[0] ?? nodes[0];
      let r = net.search(from, (n) => lotAt.has(n), 3000) ?? net.search(from, (n) => trailheadAt.has(n), 3000) ?? net.search(from, (n) => net.isJunction(n), 2000);
      if (!r) { skipped.noStart++; continue; }
      const start = r.node;
      const isLoop = ends.length === 0;
      const far = (isLoop ? nodes : ends).reduce((b, n) => haversine(net.lon[n], net.lat[n], net.lon[start], net.lat[start]) > haversine(net.lon[b], net.lat[b], net.lon[start], net.lat[start]) ? n : b, nodes[0]);
      const go = net.search(start, (n) => n === far, MAX_ONE_WAY_M);
      if (!go) { skipped.noRoute++; continue; }
      let path = go.path, edges = go.edges;
      let type: Hike["type"] = "out-and-back";
      if (isLoop) {
        const avoid = new Set<number>();
        for (let j = 1; j < go.path.length; j++) avoid.add(edgeKey(go.path[j - 1], go.path[j]));
        const back = net.search(far, (n) => n === start, MAX_ONE_WAY_M, avoid);
        if (back) { path = [...go.path, ...back.path.slice(1)]; edges = [...go.edges, ...back.edges]; type = "loop"; }
      }
      const route = toRoute(net, path, edges);
      const m = route.trailM + route.roadM;
      if (route.trailM < m * 0.6) { skipped.road++; continue; }
      const lot = lotAt.get(start) ?? trailheadAt.get(start);
      const parking = lot
        ? { name: lot.name, lon: lot.lon, lat: lot.lat, fee: lot.fee }
        : { name: net.roadName(start) ? `Roadside parking, ${net.roadName(start)}` : "Roadside parking", lon: net.lon[start], lat: net.lat[start] };
      out.push({ id: "", name: net.names[nm], type, route, parking });
      for (const p of path) covered.add(key(net.lon[p], net.lat[p]));
    }
  }
  console.log("Named trails skipped:", JSON.stringify(skipped));
  return out;
}

function curated(def: HikeDef, net: Network, pois: Poi[], lotAt: Map<number, Poi>): Hike | string {
  const stops = def.via.map((v) => pois.find((p) => p.name === v && p.kind !== "parking"));
  const missing = def.via.find((_, i) => !stops[i]);
  if (missing) return `no feature named "${missing}"`;
  const first = stops[0]!;
  const lots = [...lotAt.entries()].filter(([, p]) => p.name && def.parking.test(p.name) && haversine(p.lon, p.lat, first.lon, first.lat) < 15000);
  if (!lots.length) return `no parking lot matching ${def.parking}`;
  const [lotNode, lot] = lots.sort((a, b) => haversine(a[1].lon, a[1].lat, first.lon, first.lat) - haversine(b[1].lon, b[1].lat, first.lon, first.lat))[0];
  const nodes = [lotNode];
  for (const s of stops) {
    const n = net.nearest(s!.lon, s!.lat, 200, true);
    if (!n) return `"${s!.name}" is not near a trail`;
    nodes.push(n.node);
  }
  if (def.type === "loop") nodes.push(lotNode);
  const avoid = new Set<number>();
  const path: number[] = [], edges: number[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const target = nodes[i];
    const r = net.search(nodes[i - 1], (n) => n === target, MAX_ONE_WAY_M * 2, avoid);
    if (!r) return "no connected path";
    for (let j = 1; j < r.path.length; j++) avoid.add(edgeKey(r.path[j - 1], r.path[j]));
    path.push(...(path.length ? r.path.slice(1) : r.path));
    edges.push(...r.edges);
  }
  return { id: def.id, name: def.name, type: def.type, route: toRoute(net, path, edges), parking: { name: lot.name, lon: lot.lon, lat: lot.lat, fee: lot.fee } };
}

async function pool(jobs: (() => Promise<void>)[], n: number) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) await jobs[i++](); }));
}

type Summary = {
  id: string; name: string; type: string; dest: string | null; area: string | null; camping: string | null;
  fee: "entrance" | "parking" | "free" | null; freeCamping: boolean; parkCode: string | null; lengthMi: number; gainFt: number; lossFt: number; highFt: number; lowFt: number;
  rating: number; difficulty: string; difficultySimple: string; hours: number; counts: Record<string, number>; via: string[];
  parking: { name: string | null; lon: number; lat: number }; bbox: number[];
};

function report(name: string, trails: Summary[], problems: string[]): string {
  const watch = ["old rag loop", "stony man via appalachian trail", "upper whiteoak falls", "dark hollow falls", "mcafee knob", "dragons tooth", "dragon's tooth", "tinker cliffs", "sentinel point", "the cascades", "cascade falls", "mount rogers", "hawksbill", "humpback rocks", "crabtree falls", "angels rest"];
  const pick = trails.filter((t) => watch.includes(t.name.toLowerCase()));
  const by: Record<string, number> = {};
  trails.forEach((t) => (by[t.difficulty] = (by[t.difficulty] ?? 0) + 1));
  return [
    `# ${name}: generated hikes`,
    "",
    `${trails.length} hikes. By difficulty: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
    "",
    "| Hike | Type | Miles | Gain (ft) | High (ft) | Difficulty | Hours | Parking | Features |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...pick.map((t) => `| ${t.name} | ${t.type} | ${t.lengthMi} | ${t.gainFt} | ${t.highFt} | ${t.difficulty} | ${t.hours} | ${t.parking.name ?? "unnamed lot"} | ${Object.entries(t.counts).map(([k, v]) => `${v} ${k}`).join(", ")} |`),
    "",
    problems.length ? "## Problems\n\n" + problems.map((p) => `- ${p}`).join("\n") : "",
    "",
  ].join("\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
