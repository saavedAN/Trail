// Compact routable graph for a whole region (millions of nodes), built from osmium's GeoJSON export.
// Nodes are merged by exact coordinate, which is how OSM ways share nodes.

const BUSY = /^(residential|secondary|primary|secondary_link|primary_link)$/;

export const TRAIL_HW = new Set(["path", "footway", "track", "bridleway", "steps", "cycleway"]);

export class Network {
  lon: Float64Array = new Float64Array(1 << 20);
  lat: Float64Array = new Float64Array(1 << 20);
  nodeCount = 0;
  // Coordinate -> node id. A single Map tops out at ~16.7M entries, so it is split into shards
  // with numeric keys (lon and lat in 1e-7 degrees, packed into 53 bits).
  private index: Map<number, number>[] = Array.from({ length: 1024 }, () => new Map());
  // Edge list while building.
  private ea: number[] = [];
  private eb: number[] = [];
  private elen: number[] = [];
  private etrail: number[] = [];
  private ename: number[] = [];
  private efactor: number[] = [];
  names: string[] = [""];
  private nameIndex = new Map<string, number>([["", 0]]);
  // CSR adjacency after finish().
  off!: Int32Array;
  to!: Int32Array;
  w!: Float32Array;
  len!: Float32Array;
  trail!: Uint8Array;
  edgeName!: Int32Array;
  private grid = new Map<string, number[]>();

  addWay(coords: number[][], tags: Record<string, string>) {
    if (tags.access === "private" || tags.access === "no" || tags.foot === "no") return;
    if (tags.highway === "service" && /^(driveway|parking_aisle|drive-through|alley)$/.test(tags.service ?? "")) return;
    const isTrail = TRAIL_HW.has(tags.highway) ? 1 : 0;
    // Trails cost their length; small roads a bit more; busy roads a lot more (walk them only to reach a trail).
    const factor = isTrail ? 1 : BUSY.test(tags.highway) ? 3 : 1.5;
    const nm = this.nameId(tags.name ?? (tags.ref ? tags.ref : ""));
    let prev = this.node(coords[0]);
    for (let i = 1; i < coords.length; i++) {
      const cur = this.node(coords[i]);
      if (cur !== prev) {
        this.ea.push(prev); this.eb.push(cur);
        this.elen.push(haversine(this.lon[prev], this.lat[prev], this.lon[cur], this.lat[cur]));
        this.etrail.push(isTrail); this.ename.push(nm); this.efactor.push(factor);
      }
      prev = cur;
    }
  }

  private nameId(n: string) {
    let i = this.nameIndex.get(n);
    if (i === undefined) { i = this.names.length; this.names.push(n); this.nameIndex.set(n, i); }
    return i;
  }

  private node(c: number[]): number {
    const x = Math.round(c[0] * 1e7) + 1_800_000_000; // 0 .. 3.6e9
    const y = Math.round(c[1] * 1e7) + 900_000_000; // 0 .. 1.8e9 (< 2^31)
    const shard = this.index[x % 1024];
    const key = Math.floor(x / 1024) * 2 ** 31 + y;
    let i = shard.get(key);
    if (i === undefined) {
      i = this.nodeCount++;
      if (i >= this.lon.length) {
        const grow = (a: Float64Array) => { const b = new Float64Array(a.length * 2); b.set(a); return b; };
        this.lon = grow(this.lon); this.lat = grow(this.lat);
      }
      this.lon[i] = c[0]; this.lat[i] = c[1];
      shard.set(key, i);
    }
    return i;
  }

  finish() {
    for (const m of this.index) m.clear();
    const n = this.nodeCount, m = this.ea.length;
    const deg = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) { deg[this.ea[e]]++; deg[this.eb[e]]++; }
    this.off = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.off[i + 1] = this.off[i] + deg[i];
    const fill = this.off.slice(0, n);
    this.to = new Int32Array(2 * m); this.w = new Float32Array(2 * m); this.len = new Float32Array(2 * m);
    this.trail = new Uint8Array(2 * m); this.edgeName = new Int32Array(2 * m);
    for (let e = 0; e < m; e++) {
      const a = this.ea[e], b = this.eb[e], l = this.elen[e], t = this.etrail[e];
      const wt = l * this.efactor[e];
      for (const [u, v] of [[a, b], [b, a]]) {
        const k = fill[u]++;
        this.to[k] = v; this.w[k] = wt; this.len[k] = l; this.trail[k] = t; this.edgeName[k] = this.ename[e];
      }
    }
    this.ea = []; this.eb = []; this.elen = []; this.etrail = []; this.ename = []; this.efactor = [];
    for (let i = 0; i < n; i++) {
      if (this.off[i + 1] === this.off[i]) continue;
      const k = cellKey(this.lon[i], this.lat[i]);
      let c = this.grid.get(k);
      if (!c) { c = []; this.grid.set(k, c); }
      c.push(i);
    }
  }

  /** Nearest routable node within maxM meters; onlyTrail restricts to nodes touching a trail. */
  nearest(lon: number, lat: number, maxM: number, onlyTrail = false): { node: number; m: number } | null {
    let best = -1, bd = maxM;
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (onlyTrail && !this.touchesTrail(i)) continue;
        const d = haversine(lon, lat, this.lon[i], this.lat[i]);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best < 0 ? null : { node: best, m: bd };
  }

  /** A node where a trail meets a road: a trailhead even when no parking lot is mapped. */
  isJunction(i: number) {
    let trail = false, road = false;
    for (let k = this.off[i]; k < this.off[i + 1]; k++) { if (this.trail[k]) trail = true; else road = true; }
    return trail && road;
  }

  /** Name of the first road at a node. */
  roadName(i: number) {
    for (let k = this.off[i]; k < this.off[i + 1]; k++) if (!this.trail[k] && this.names[this.edgeName[k]]) return this.names[this.edgeName[k]];
    return "";
  }

  touchesTrail(i: number) {
    for (let k = this.off[i]; k < this.off[i + 1]; k++) if (this.trail[k]) return true;
    return false;
  }

  /**
   * Dijkstra from `src` until a node in `targets` is reached (or `maxM` of cost is exceeded).
   * Edges in `avoid` cost `penalty` times more (used to make loops return a different way).
   */
  search(src: number, isTarget: (n: number) => boolean, maxM: number, avoid?: Set<number>, penalty = 4): { node: number; cost: number; path: number[]; edges: number[] } | null {
    const dist = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, number>();
    const prevEdge = new Map<number, number>();
    const heap = new Heap();
    heap.push(src, 0);
    while (heap.size) {
      const [u, d] = heap.pop();
      if (d > (dist.get(u) ?? Infinity)) continue;
      if (u !== src && isTarget(u)) {
        const path = [u], edges: number[] = [];
        for (let v = u; v !== src;) { edges.push(prevEdge.get(v)!); v = prev.get(v)!; path.push(v); }
        return { node: u, cost: d, path: path.reverse(), edges: edges.reverse() };
      }
      if (d > maxM) break;
      for (let k = this.off[u]; k < this.off[u + 1]; k++) {
        const v = this.to[k];
        const nd = d + this.w[k] * (avoid?.has(edgeKey(u, v)) ? penalty : 1);
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); prevEdge.set(v, k); heap.push(v, nd); }
      }
    }
    return null;
  }
}

export const edgeKey = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

const CELL = 0.005;
const cellKey = (lon: number, lat: number) => `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;

export function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class Heap {
  private v: number[] = [];
  private p: number[] = [];
  get size() { return this.v.length; }
  push(v: number, p: number) {
    const V = this.v, P = this.p; V.push(v); P.push(p);
    let i = V.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (P[j] <= P[i]) break;
      [V[i], V[j]] = [V[j], V[i]]; [P[i], P[j]] = [P[j], P[i]]; i = j;
    }
  }
  pop(): [number, number] {
    const V = this.v, P = this.p;
    const top: [number, number] = [V[0], P[0]];
    const lv = V.pop()!, lp = P.pop()!;
    if (V.length) {
      V[0] = lv; P[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < V.length && P[l] < P[m]) m = l;
        if (r < V.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [V[i], V[m]] = [V[m], V[i]]; [P[i], P[m]] = [P[m], P[i]]; i = m;
      }
    }
    return top;
  }
}
