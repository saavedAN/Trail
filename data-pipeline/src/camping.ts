// Camping details from OSM tags, and land-manager rules for the area a hike is in.
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

/** One line describing a campsite or shelter, e.g. "Lean-to · free" or "Campground · fee · reservations required". */
export function campInfo(t: Record<string, string>): string | undefined {
  const parts: string[] = [];
  if (t.amenity === "shelter") {
    const st = t.shelter_type;
    parts.push(
      st === "lean_to" ? "Lean-to shelter" : st === "picnic_shelter" ? "Picnic shelter (no camping)" : st === "basic_hut" ? "Hut" :
      st === "weather_shelter" ? "Weather shelter" : st === "rock_shelter" ? "Rock shelter" : "Shelter",
    );
  } else if (t.tourism === "wilderness_hut" || t.tourism === "alpine_hut") {
    parts.push(t.tourism === "alpine_hut" ? "Staffed hut / cabin" : "Backcountry hut / cabin");
  } else if (t.tourism === "camp_site" || t.tourism === "camp_pitch") {
    const cs = t.camp_site;
    parts.push(
      t.backcountry === "yes" || cs === "backcountry" ? "Backcountry campsite" : cs === "basic" ? "Primitive campsite" :
      cs === "serviced" || cs === "deluxe" || cs === "standard" ? "Campground" : t.tourism === "camp_pitch" ? "Tent pad" : "Campsite",
    );
  } else return undefined;
  if (t.fee === "no") parts.push("free");
  else if (t.fee && t.fee !== "no") parts.push(t.charge ? `fee (${t.charge})` : "fee");
  if (t.reservation === "required") parts.push("reservations required");
  else if (t.reservation === "yes" || t.reservation === "recommended") parts.push("reservations accepted");
  else if (t.reservation === "no") parts.push("first come, first served");
  if (t.permit === "yes" || t.permit === "required") parts.push("permit required");
  if (t.access === "private" || t.access === "permit") parts.push(t.access === "permit" ? "permit required" : "private");
  if (t.drinking_water === "yes") parts.push("water");
  if (t.toilets === "yes") parts.push("toilet");
  if (t.operator) parts.push(t.operator);
  return parts.join(" · ");
}

export type Area = { name: string; kind: string; shape: Feature<Polygon | MultiPolygon>; area: number; bbox?: number[] };

/** Parks, forests and wilderness areas, from boundary/leisure polygons. */
export function areaFrom(f: Feature, t: Record<string, string>): Area | null {
  if (!t.name || (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon")) return null;
  const isArea = t.boundary === "national_park" || t.boundary === "protected_area" || t.boundary === "national_forest" || t.leisure === "nature_reserve" || t.leisure === "park";
  if (!isArea) return null;
  const shape = f as Feature<Polygon | MultiPolygon>;
  return { name: t.name, kind: t.protect_class ?? t.boundary ?? t.leisure ?? "", shape, area: turf.area(shape) };
}

/** Camping rules by land manager, strictest first: a wilderness inside a national park follows the park's rules. */
const RULES: [RegExp, string][] = [
  [/shenandoah national park/i, "Shenandoah NP: backcountry camping needs a free permit (recreation.gov); camp out of sight of trails, not at viewpoints or day-use areas."],
  [/national park/i, "National park: backcountry camping usually needs a permit."],
  [/blue ridge parkway/i, "Blue Ridge Parkway: camping only in designated campgrounds (fee)."],
  [/state park/i, "State park: camping only in park campgrounds or designated backcountry sites; fee and reservations (reservevaparks.com in VA)."],
  [/state forest/i, "State forest: camping usually by permit or at designated sites only."],
  [/appalachian national scenic trail/i, "Appalachian Trail corridor: camp only at the shelters and designated campsites along the AT; free, first come, first served."],
  [/wildlife management area/i, "Wildlife management area: primitive camping allowed in some WMAs with an access permit; check DWR rules."],
  [/wilderness/i, "Wilderness area (national forest): free dispersed camping; groups of 10 or fewer, no motorized gear."],
  [/national recreation area/i, "National recreation area (national forest): free dispersed camping in most areas; developed campgrounds charge a fee."],
  [/national forest/i, "National forest: free dispersed camping in most areas (stay 200 ft from water and trails, 14-day limit). Developed campgrounds charge a fee."],
];

/** Picks the area name to show and its camping rule, given containing areas smallest first. */
export function landFor(names: string[]): { area: string | null; rule: string | null } {
  for (const [re, rule] of RULES) {
    const hit = names.find((n) => re.test(n));
    if (hit) return { area: hit, rule };
  }
  return { area: names[0] ?? null, rule: null };
}
