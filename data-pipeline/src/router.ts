// Shortest-path routing over the OSM path/road network, so hikes can start and end at parking lots.
import * as turf from "@turf/turf";
import type { Position } from "geojson";
import type { OsmElement } from "./osm.ts";

type Edge = { to: number; w: number; len: number; id: number };

const ROAD = /^(residential|service|tertiary|unclassified|secondary|living_street)$/;

export class Graph {
  coords: Position[] = [];
  adj: Edge[][] = [];
  private index = new Map<string, number>();
  private edgeCount = 0;

  constructor(ways: OsmElement[]) {
    for (const w of ways) {
      if (w.type !== "way" || !w.geometry) continue;
      const t = w.tags ?? {};
      if (t.access === "private" || t.foot === "no") continue;
      // Prefer trails: roads cost a little more, so routes only use them when needed (e.g. the walk from a lot).
      const factor = ROAD.test(t.highway ?? "") ? 1.5 : 1;
      for (let i = 1; i < w.geometry.length; i++) {
        const a = this.node(w.geometry[i - 1]), b = this.node(w.geometry[i]);
        const len = turf.distance(this.coords[a], this.coords[b], { units: "meters" });
        const id = this.edgeCount++;
        this.adj[a].push({ to: b, w: len * factor, len, id });
        this.adj[b].push({ to: a, w: len * factor, len, id });
      }
    }
  }

  private node(g: { lat: number; lon: number }): number {
    const key = `${g.lon.toFixed(7)},${g.lat.toFixed(7)}`;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.coords.length;
      this.index.set(key, i);
      this.coords.push([g.lon, g.lat]);
      this.adj.push([]);
    }
    return i;
  }

  nearest(p: Position): { node: number; meters: number } {
    let best = -1, bd = Infinity;
    this.coords.forEach((c, i) => {
      if (!this.adj[i].length) return;
      const d = turf.distance(c, p, { units: "meters" });
      if (d < bd) { bd = d; best = i; }
    });
    return { node: best, meters: bd };
  }

  /** Dijkstra. Edges in `used` cost `penalty` times more (to make loops come back a different way). */
  route(from: number, to: number, used = new Set<number>(), penalty = 4): { path: number[]; edges: number[] } | null {
    const dist = new Float64Array(this.coords.length).fill(Infinity);
    const prev = new Int32Array(this.coords.length).fill(-1);
    const prevEdge = new Int32Array(this.coords.length).fill(-1);
    const heap = new Heap();
    dist[from] = 0;
    heap.push(from, 0);
    while (heap.size) {
      const [u, d] = heap.pop();
      if (d > dist[u]) continue;
      if (u === to) break;
      for (const e of this.adj[u]) {
        const nd = d + e.w * (used.has(e.id) ? penalty : 1);
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; prevEdge[e.to] = e.id; heap.push(e.to, nd); }
      }
    }
    if (dist[to] === Infinity) return null;
    const path: number[] = [], edges: number[] = [];
    for (let v = to; v !== -1; v = prev[v]) { path.push(v); if (prevEdge[v] >= 0) edges.push(prevEdge[v]); }
    return { path: path.reverse(), edges };
  }
}

class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(v: number, p: number) {
    const a = this.items; a.push([v, p]);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][1] <= a[i][1]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop(): [number, number] {
    const a = this.items, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
