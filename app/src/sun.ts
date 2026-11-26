// Sunrise and sunset from the NOAA solar equations, so daylight works offline.
const rad = Math.PI / 180;

/** Sunrise and sunset for a date at a place, or null for polar day/night. */
export function sunTimes(date: Date, lat: number, lon: number): { rise: Date; set: Date } | null {
  // Day of year at local noon (UTC date math, good to a minute or two).
  const noon = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const n = (noon - Date.UTC(date.getFullYear(), 0, 0)) / 864e5;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / rad;
  const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const at = (min: number) => new Date(midnight + min * 60000);
  return { rise: at(720 - 4 * (lon + ha) - eqTime), set: at(720 - 4 * (lon - ha) - eqTime) };
}
