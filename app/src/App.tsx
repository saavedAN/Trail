import { useEffect, useMemo, useState } from "react";
import { loadIndex } from "./data";
import { Explore } from "./Explore";
import { defaultFilters, type Filters } from "./filters";
import { usePosition } from "./geo";
import { SavedPage } from "./SavedPage";
import { Search } from "./Search";
import { TrailPage } from "./TrailPage";
import type { TrailSummary } from "./types";
import { go } from "./ui";

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [trails, setTrails] = useState<TrailSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [online, setOnline] = useState(navigator.onLine);
  const me = usePosition();

  useEffect(() => {
    loadIndex().then(setTrails, (e) => setError(String(e.message ?? e)));
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  const activeFilters = useMemo(
    () => filters.difficulty.size + filters.has.size + (filters.maxLength ? 1 : 0) + (filters.maxGain ? 1 : 0) + (filters.type !== "any" ? 1 : 0) + (filters.maxDrive ? 1 : 0),
    [filters],
  );

  const route = hash.slice(1);
  const trailId = route.startsWith("/trail/") ? decodeURIComponent(route.slice(7)) : null;
  const tab = trailId ? "trail" : route.startsWith("/search") ? "search" : route.startsWith("/saved") ? "saved" : "explore";

  let body: React.ReactNode;
  if (trailId) body = <TrailPage id={trailId} />;
  else if (tab === "saved") body = <SavedPage />;
  else if (error) body = <div className="page"><p className="error">Couldn't load trails: {error}</p><p className="muted">If you're offline, open a saved trail from the Saved tab.</p></div>;
  else if (!trails) body = <div className="page"><p className="muted">Loading trails…</p></div>;
  else if (tab === "search") body = <Search trails={trails} filters={filters} setFilters={setFilters} me={me} />;
  else body = <Explore trails={trails} filters={filters} me={me} activeFilters={activeFilters} />;

  return (
    <div className="app">
      {!online && <div className="offline-banner">Offline · saved trails and downloaded maps still work</div>}
      <main>{body}</main>
      <nav className="tabs">
        <button className={tab === "explore" ? "on" : ""} onClick={() => go("#/")}><span>🗺</span>Explore</button>
        <button className={tab === "search" ? "on" : ""} onClick={() => go("#/search")}><span>🔍</span>Search</button>
        <button className={tab === "saved" ? "on" : ""} onClick={() => go("#/saved")}><span>★</span>Saved</button>
      </nav>
    </div>
  );
}
