// Elevation lookup from the free AWS "Terrain Tiles" (terrarium encoding).
// Source data in the US is USGS 3DEP. At zoom 14 a pixel is ~9.5 m at 38°N.
import { PNG } from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ZOOM = 14;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const CACHE_DIR = path.resolve(import.meta.dirname, "../.cache/terrarium");

const memo = new Map<string, Promise<PNG>>();

async function loadTile(x: number, y: number): Promise<PNG> {
  const key = `${ZOOM}/${x}/${y}`;
  let p = memo.get(key);
  if (!p) {
    p = (async () => {
      const file = path.join(CACHE_DIR, `${ZOOM}-${x}-${y}.png`);
      let buf: Buffer;
      if (existsSync(file)) {
        buf = await readFile(file);
      } else {
        const res = await fetch(TILE_URL(ZOOM, x, y));
        if (!res.ok) throw new Error(`elevation tile ${key}: HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, buf);
      }
      return PNG.sync.read(buf);
    })();
    memo.set(key, p);
  }
  return p;
}

/** Elevation in meters at a lon/lat, bilinear-interpolated. */
export async function elevationAt(lon: number, lat: number): Promise<number> {
  const n = 2 ** ZOOM;
  const latRad = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n * 256;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256;
  const px = Math.floor(fx - 0.5), py = Math.floor(fy - 0.5);
  const tx = fx - 0.5 - px, ty = fy - 0.5 - py;
  const sample = async (gx: number, gy: number) => {
    const tile = await loadTile(Math.floor(gx / 256), Math.floor(gy / 256));
    const ix = ((gx % 256) + 256) % 256, iy = ((gy % 256) + 256) % 256;
    const i = (iy * 256 + ix) * 4;
    const d = tile.data;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  };
  const [a, b, c, e] = await Promise.all([
    sample(px, py), sample(px + 1, py), sample(px, py + 1), sample(px + 1, py + 1),
  ]);
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
}
