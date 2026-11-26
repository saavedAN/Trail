// Prints a region's extract paths and writes its coverage shape, for the data build workflow.
// Usage: tsx src/region.ts <region> <shape.geojson>
import { writeFile } from "node:fs/promises";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { REGIONS, type Region } from "./regions.ts";

export function regionShape(r: Region): Feature<Polygon | MultiPolygon> {
  let shape: Feature<Polygon | MultiPolygon> = turf.bboxPolygon(r.bbox);
  for (const [lon, lat, km] of r.circles) {
    const c = turf.circle([lon, lat], km, { units: "kilometers", steps: 96 });
    shape = turf.union(turf.featureCollection([shape, c])) ?? shape;
  }
  return shape;
}

if (process.argv[1]?.endsWith("region.ts")) {
  const [id = "virginia", out = "shape.geojson"] = process.argv.slice(2);
  const r = REGIONS[id];
  if (!r) throw new Error(`unknown region ${id}`);
  const shape = regionShape(r);
  await writeFile(out, JSON.stringify(turf.featureCollection([shape])));
  console.log(r.extracts.join("\n"));
  console.error(`bbox ${turf.bbox(shape).map((n) => n.toFixed(2)).join(",")}`);
}
