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

const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
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
  return overpass(name, query(bbox));
}

async function overpass(name: string, q: string): Promise<OsmElement[]> {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")).elements;
  let json: { elements: OsmElement[] } | undefined;
  // Public Overpass servers get busy: try each server, backing off between rounds.
  for (let attempt = 0; attempt < 4 && !json; attempt++) {
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "personal-trail-app/0.1" },
          body: new URLSearchParams({ data: q }),
        });
        if (res.ok) { json = await res.json(); break; }
        console.warn(`${url}: HTTP ${res.status}`);
      } catch (e) {
        console.warn(`${url}: ${(e as Error).message}`);
      }
    }
    if (!json) await new Promise((r) => setTimeout(r, 15000 * 2 ** attempt));
  }
  if (!json) throw new Error("All Overpass servers failed");
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json.elements;
}

/** All walkable ways (trails, tracks, minor roads) in a box, for routing. Box is [west, south, east, north]. */
export async function fetchNetwork(name: string, box: [number, number, number, number]): Promise<OsmElement[]> {
  const [w, s, e, n] = box;
  const q = `[out:json][timeout:120];
way["highway"]["highway"!~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|construction|proposed|raceway)$"](${s},${w},${n},${e});
out tags geom;`;
  return overpass(`net-${name}`, q);
}
