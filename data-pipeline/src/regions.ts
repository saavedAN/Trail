// Regions and hand-picked hikes. A hike starts and ends at a parking lot and passes through waypoints;
// the route between them is found on the OSM path network.
import type { Position } from "geojson";
import type { BBox } from "./osm.ts";
import type { RouteType } from "./stats.ts";

/** A feature name (exact, e.g. "Dark Hollow Falls") or a [lon, lat] point. */
export type Waypoint = string | Position;

export type HikeDef = {
  id: string;
  name: string;
  type: Exclude<RouteType, "point-to-point">;
  /** Pattern matched against parking lot names; the matching lot nearest the first waypoint is used. */
  parking: RegExp;
  /** Places the hike goes to, in order. An out-and-back turns around at the last one. */
  via: Waypoint[];
  /** Area to load the path network from: [west, south, east, north]. */
  within: [number, number, number, number];
};

export type Region = { name: string; bbox: BBox; hikes: HikeDef[] };

export const REGIONS: Record<string, Region> = {
  shenandoah: {
    name: "Shenandoah National Park",
    bbox: { south: 38.03, west: -78.98, north: 38.95, east: -78.1 },
    hikes: [
      {
        id: "old-rag-loop", name: "Old Rag Loop", type: "loop",
        parking: /old rag/i, via: ["Old Rag Mountain"],
        within: [-78.36, 38.53, -78.25, 38.6],
      },
      {
        id: "whiteoak-canyon", name: "Whiteoak Canyon Upper Falls", type: "out-and-back",
        parking: /white ?oak.*lower|white ?oak/i, via: ["Upper Whiteoak Falls"],
        within: [-78.4, 38.52, -78.28, 38.6],
      },
      {
        id: "dark-hollow-falls", name: "Dark Hollow Falls", type: "out-and-back",
        parking: /dark hollow/i, via: ["Dark Hollow Falls"],
        within: [-78.45, 38.5, -78.4, 38.54],
      },
      {
        id: "hawksbill-lower", name: "Hawksbill Summit (Lower Hawksbill Trail)", type: "out-and-back",
        parking: /hawksbill gap/i, via: ["Hawksbill"],
        within: [-78.42, 38.54, -78.37, 38.57],
      },
      {
        id: "stony-man", name: "Stony Man via Appalachian Trail", type: "loop",
        parking: /stony man/i, via: ["Stony Man"],
        within: [-78.4, 38.58, -78.36, 38.61],
      },
      {
        id: "bearfence-mountain", name: "Bearfence Mountain", type: "loop",
        parking: /bearfence/i, via: ["Bearfence Mountain"],
        within: [-78.49, 38.43, -78.45, 38.46],
      },
      {
        id: "doyles-river-falls", name: "Doyles River Falls", type: "out-and-back",
        parking: /doyles/i, via: ["Lower Doyles River Falls"],
        within: [-78.7, 38.22, -78.64, 38.28],
      },
    ],
  },
};
