// Download everything a trail needs to work with no signal: its data, the map tiles around it,
// the elevation tiles (for hillshade, contours) and the map's fonts and icons.
import { DATA_CACHE, putSaved, trailUrl } from "./data";
import { DEM_MAXZOOM, DEM_URL, SAT_MAXZOOM, SAT_URL, STYLE_URL, VECTOR_MAXZOOM } from "./mapStyle";
import type { TrailDetail } from "./types";

export const TILE_CACHE = "trail-tiles-v1";
const MIN_Z = 8;
const PAD_DEG = 0.012; // ~1 km around the trail

function tilesFor(bbox: number[], z: number): [number, number][] {
  const [w, s, e, n] = [bbox[0] - PAD_DEG, bbox[1] - PAD_DEG, bbox[2] + PAD_DEG, bbox[3] + PAD_DEG];
  const x = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  const out: [number, number][] = [];
  for (let tx = x(w); tx <= x(e); tx++) for (let ty = y(n); ty <= y(s); ty++) out.push([tx, ty]);
  return out;
}

async function styleAssets(): Promise<{ urls: string[]; vectorTemplate: string | null }> {
  const style = await (await fetch(STYLE_URL)).json();
  const urls = [STYLE_URL];
  let vectorTemplate: string | null = null;
  for (const src of Object.values<any>(style.sources)) {
    if (src.type !== "vector" || !src.url) continue;
    urls.push(src.url);
    const tj = await (await fetch(src.url)).json();
    vectorTemplate = tj.tiles?.[0] ?? null;
  }
  if (style.sprite) {
    const sprites: string[] = typeof style.sprite === "string" ? [style.sprite] : style.sprite.map((s: any) => s.url);
    for (const s of sprites) for (const suf of [".json", ".png", "@2x.json", "@2x.png"]) urls.push(s + suf);
  }
  if (style.glyphs) {
    const fonts = new Set<string>(["Noto Sans Regular"]);
    for (const l of style.layers) {
      const f = l.layout?.["text-font"];
      if (Array.isArray(f) && f.every((x: unknown) => typeof x === "string")) fonts.add(f.join(","));
    }
    for (const f of fonts) for (const r of ["0-255", "256-511", "8192-8447"]) urls.push(style.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r));
  }
  return { urls, vectorTemplate };
}

export async function downloadTrail(trail: TrailDetail, onProgress: (done: number, total: number) => void): Promise<number> {
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  const tiles = await caches.open(TILE_CACHE);
  const data = await caches.open(DATA_CACHE);
  const { urls, vectorTemplate } = await styleAssets();
  for (let z = MIN_Z; z <= DEM_MAXZOOM; z++)
    for (const [x, y] of tilesFor(trail.bbox, z)) urls.push(DEM_URL.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`));
  // Satellite from zoom 11 up (wider views are just a blur of green and not worth the space).
  for (let z = 11; z <= SAT_MAXZOOM; z++)
    for (const [x, y] of tilesFor(trail.bbox, z)) urls.push(SAT_URL.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`));
  if (vectorTemplate)
    for (let z = MIN_Z; z <= VECTOR_MAXZOOM; z++)
      for (const [x, y] of tilesFor(trail.bbox, z)) urls.push(vectorTemplate.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`));

  let done = 0, bytes = 0;
  const total = urls.length + 1;
  const one = async (url: string, cache: Cache) => {
    if (!(await cache.match(url))) {
      try {
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) {
          const buf = await res.clone().arrayBuffer();
          bytes += buf.byteLength;
          await cache.put(url, res);
        }
      } catch { /* skip a tile that fails; the rest still work */ }
    }
    onProgress(++done, total);
  };
  await one(trailUrl(trail.id), data);
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < urls.length) await one(urls[i++], tiles); }));
  const { profile: _p, features: _f, geometry: _g, ...summary } = trail;
  await putSaved(trail.id, { summary, savedAt: Date.now(), downloaded: true, bytes });
  return bytes;
}

export async function storageUsed(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export const mb = (b: number) => `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
