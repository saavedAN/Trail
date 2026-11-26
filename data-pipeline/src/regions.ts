// Regions and hand-picked "hikes" (named routes made of one or more OSM trail segments).
import type { Position } from "geojson";
import type { BBox } from "./osm.ts";
import type { RouteType } from "./stats.ts";

export type HikeDef = {
  id: string;
  name: string;
  type: RouteType;
  /** OSM trail names, in walking order. */
  segments: string[];
  /** Only use segments that touch this box: [west, south, east, north]. */
  within?: [number, number, number, number];
  /** Where the hike starts (usually the parking lot), [lon, lat]. */
  start?: Position;
  /** Start at the higher end (for hikes that begin at Skyline Drive). */
  startHigh?: boolean;
  /** Trim the route to start / end at a named feature (e.g. a waterfall). */
  startAt?: string;
  endAt?: string;
};

export type Region = { name: string; bbox: BBox; hikes: HikeDef[] };

export const REGIONS: Record<string, Region> = {
  shenandoah: {
    name: "Shenandoah National Park",
    bbox: { south: 38.03, west: -78.98, north: 38.95, east: -78.1 },
    hikes: [
      {
        id: "old-rag-loop", name: "Old Rag Loop", type: "loop",
        segments: ["Ridge Trail", "Saddle Trail", "Weakley Hollow Fire Road"],
        within: [-78.36, 38.53, -78.27, 38.59], start: [-78.2866, 38.5705],
      },
      {
        id: "whiteoak-canyon", name: "Whiteoak Canyon Upper Falls", type: "out-and-back",
        segments: ["Whiteoak Canyon Trail"],
        within: [-78.4, 38.53, -78.3, 38.6], startHigh: true, endAt: "Upper Whiteoak Falls",
      },
      {
        id: "dark-hollow-falls", name: "Dark Hollow Falls", type: "out-and-back",
        segments: ["Dark Hollow Falls Trail"],
        within: [-78.45, 38.5, -78.4, 38.54], startHigh: true, endAt: "Dark Hollow Falls",
      },
      {
        id: "hawksbill-lower", name: "Hawksbill Summit (Lower Hawksbill Trail)", type: "out-and-back",
        segments: ["Lower Hawksbill Trail"],
        within: [-78.42, 38.54, -78.37, 38.57], start: [-78.3815, 38.5472],
      },
      {
        id: "stony-man", name: "Stony Man", type: "out-and-back",
        segments: ["Stony Man Trail"],
        within: [-78.4, 38.58, -78.36, 38.61],
      },
      {
        id: "bearfence-mountain", name: "Bearfence Mountain", type: "out-and-back",
        segments: ["Bearfence Mountain Trail"],
        within: [-78.49, 38.43, -78.45, 38.46],
      },
      {
        id: "doyles-river-falls", name: "Doyles River Falls", type: "out-and-back",
        segments: ["Doyles River Trail"],
        within: [-78.7, 38.22, -78.64, 38.28], startHigh: true, endAt: "Lower Doyles River Falls",
      },
    ],
  },
};
