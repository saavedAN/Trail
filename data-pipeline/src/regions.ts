// Regions, plus hand-made hikes (mostly loops) that the automatic hike finder would not produce.
import type { RouteType } from "./stats.ts";

export type HikeDef = {
  id: string;
  name: string;
  type: Exclude<RouteType, "point-to-point">;
  /** Pattern matched against parking lot names; the matching lot nearest the first waypoint is used. */
  parking: RegExp;
  /** Named features the hike goes to, in order. An out-and-back turns around at the last one. */
  via: string[];
};

/** [west, south, east, north] */
export type Box = [number, number, number, number];

export type Region = {
  name: string;
  /** Geofabrik extracts to merge (paths under download.geofabrik.de). */
  extracts: string[];
  /** Rough coverage box; the area actually covered is this box plus the circles. */
  bbox: Box;
  /** Extra round areas: [lon, lat, radius km]. */
  circles: [number, number, number][];
  hikes: HikeDef[];
};

export const REGIONS: Record<string, Region> = {
  virginia: {
    // The Virginia AT corridor (Damascus to Harpers Ferry) and everything within ~3 hours of Blacksburg.
    // Plus a wide circle around Blacksburg (into WV, NC and TN) and one around Woodbridge (into MD and DC).
    name: "Virginia and neighbors",
    extracts: ["virginia", "west-virginia", "kentucky", "north-carolina", "tennessee", "maryland", "district-of-columbia"].map((s) => `north-america/us/${s}-latest.osm.pbf`),
    bbox: [-83.7, 36.5, -77.6, 39.35],
    circles: [
      [-80.414, 37.229, 265], // Blacksburg: Grandfather Mtn, Linville Gorge, Asheville edge, Dolly Sods, New River Gorge
      [-77.25, 38.658, 110], // Woodbridge: Prince William Forest, Great Falls, C&O Canal, Sugarloaf, Catoctin
    ],
    hikes: [
      { id: "old-rag-loop", name: "Old Rag Loop", type: "loop", parking: /old rag lower lot/i, via: ["Old Rag Mountain"] },
      { id: "stony-man-loop", name: "Stony Man via Appalachian Trail", type: "loop", parking: /stony man/i, via: ["Stony Man"] },
      { id: "mcafee-knob", name: "McAfee Knob", type: "out-and-back", parking: /mcafee/i, via: ["McAfee Knob"] },
      { id: "dragons-tooth", name: "Dragon's Tooth", type: "out-and-back", parking: /dragon/i, via: ["Dragon's Tooth"] },
      { id: "tinker-cliffs", name: "Tinker Cliffs via Andy Layne Trail", type: "out-and-back", parking: /andy layne/i, via: ["Tinker Cliffs"] },
      { id: "bearfence-loop", name: "Bearfence Mountain Loop", type: "loop", parking: /bearfence/i, via: ["Bearfence Mountain"] },
    ],
  },
};
