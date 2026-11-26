// Fetch trails and trail features for a bounding box from OpenStreetMap (Overpass API).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type BBox = { south: number; west: number; north: number; east: number };

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
};

const OVERPASS = "https://overpass-api.de/api/interpreter";
const CACHE_DIR = path.resolve(import.meta.dirname, "../.cache/osm");

function query(b: BBox): string {
  const bb = `(${b.south},${b.west},${b.north},${b.east})`;
  return `[out:json][timeout:180];
(
  relation["route"="hiking"]${bb};
  way["highway"~"^(path|footway|track|bridleway)$"]["name"]${bb};
)->.trails;
.trails out tags geom;
(
  nwr["amenity"="parking"]${bb};
  nwr["tourism"~"^(camp_site|camp_pitch|wilderness_hut|alpine_hut|viewpoint)$"]${bb};
  nwr["amenity"~"^(shelter|drinking_water|toilets)$"]${bb};
  nwr["natural"~"^(spring|peak|cave_entrance)$"]${bb};
  nwr["waterway"="waterfall"]${bb};
  nwr["man_made"="water_tap"]${bb};
  nwr["highway"="trailhead"]${bb};
  nwr["tourism"="information"]["information"="board"]${bb};
)->.features;
.features out tags center;`;
}

export async function fetchOsm(name: string, bbox: BBox): Promise<OsmElement[]> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")).elements;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "personal-trail-app/0.1" },
    body: new URLSearchParams({ data: query(bbox) }),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json.elements;
}
