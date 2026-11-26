import { useEffect, useState } from "react";
import { getSaved, putSaved, type Saved } from "./data";
import { mb, storageUsed } from "./offline";
import { TrailCard } from "./ui";

export function SavedPage() {
  const [saved, setSaved] = useState<Record<string, Saved>>({});
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    const refresh = () => { getSaved().then(setSaved); storageUsed().then(setUsage); };
    refresh();
    window.addEventListener("saved-changed", refresh);
    return () => window.removeEventListener("saved-changed", refresh);
  }, []);

  const list = Object.values(saved).sort((a, b) => b.savedAt - a.savedAt);
  return (
    <div className="page">
      <h1>Saved</h1>
      {usage && <p className="muted">Offline storage used: {mb(usage.used)}</p>}
      {!list.length && <p className="muted">Trails you save show up here. Tap “Download for offline” on a trail before you lose signal.</p>}
      <div className="list">
        {list.map((s) => (
          <div key={s.summary.id} className="saved-row">
            <TrailCard t={s.summary} badge={s.downloaded ? `Offline · ${mb(s.bytes)}` : "Not downloaded"} />
            <button className="link" onClick={() => putSaved(s.summary.id, null)}>Remove</button>
          </div>
        ))}
      </div>
      <p className="fine">
        Removing a trail keeps its map tiles cached (they're shared with nearby trails). iPhone keeps this storage as long as the app stays on your home screen.
      </p>
    </div>
  );
}
