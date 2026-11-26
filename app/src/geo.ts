import { useEffect, useState } from "react";

export type LonLat = { lon: number; lat: number; accuracy?: number };

export function milesBetween(a: LonLat, b: LonLat): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

// One shared GPS watch for the whole app. GPS works with no cell signal.
let last: LonLat | null = null;
const listeners = new Set<(p: LonLat | null) => void>();
let watching = false;

function startWatch() {
  if (watching || !("geolocation" in navigator)) return;
  watching = true;
  navigator.geolocation.watchPosition(
    (p) => {
      last = { lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy };
      listeners.forEach((l) => l(last));
    },
    () => { watching = false; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

/** Current position, or null until the user allows location. */
export function usePosition(enabled = true): LonLat | null {
  const [pos, setPos] = useState<LonLat | null>(last);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setPos);
    startWatch();
    return () => { listeners.delete(setPos); };
  }, [enabled]);
  return pos;
}
