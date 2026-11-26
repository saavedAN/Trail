import { get, set } from "idb-keyval";
import type { TrailDetail, TrailSummary } from "./types";

export const REGION = "virginia";
const DATA = `${import.meta.env.BASE_URL}data/${REGION}`;
export const DATA_CACHE = "trail-data-v1";

export const indexUrl = () => `${DATA}/index.json`;
export const trailUrl = (id: string) => `${DATA}/trails/${id}.json`;

/** Network first, falling back to the offline cache (the service worker also caches these). */
async function getJson<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url);
    if (res.ok) return res.json();
  } catch {
    /* offline */
  }
  const cached = await caches.match(url);
  if (cached) return cached.json();
  throw new Error("Not available offline");
}

let indexPromise: Promise<TrailSummary[]> | null = null;
export function loadIndex(): Promise<TrailSummary[]> {
  indexPromise ??= getJson<{ trails: TrailSummary[] }>(indexUrl()).then((d) => d.trails);
  return indexPromise;
}

export const loadTrail = (id: string) => getJson<TrailDetail>(trailUrl(id));

// ---- Saved trails (kept in IndexedDB so they survive offline) ----

export type Saved = { summary: TrailSummary; savedAt: number; downloaded: boolean; bytes: number };
const KEY = "saved-trails";

export async function getSaved(): Promise<Record<string, Saved>> {
  try {
    return (await get(KEY)) ?? {};
  } catch {
    return {};
  }
}

export async function putSaved(id: string, value: Saved | null) {
  const all = await getSaved();
  if (value) all[id] = value;
  else delete all[id];
  await set(KEY, all);
  window.dispatchEvent(new Event("saved-changed"));
}
