// Weather for the week, daylight, and alerts (park closures, fire and storm warnings) at the trailhead.
// Daylight is computed on the phone, so it works offline. Weather and alerts are kept from the last
// time you had signal and shown with their age.
import { useEffect, useState } from "react";
import { sunTimes } from "./sun";
import type { TrailSummary } from "./types";

type Day = { date: string; code: number; hi: number; lo: number; rain: number; wind: number };
type Alert = { title: string; text: string; url?: string; source: "NPS" | "NWS"; severe?: boolean };
type Cached = { at: number; days: Day[]; alerts: Alert[] };

const KEY = (id: string) => `conditions:${id}`;
const NPS_KEY = "DEMO_KEY"; // free public key; enough for a few people

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayName = (iso: string, i: number) => (i === 0 ? "Today" : new Date(`${iso}T12:00`).toLocaleDateString([], { weekday: "short" }));

function load(id: string): Cached | null {
  try { return JSON.parse(localStorage.getItem(KEY(id)) ?? "null"); } catch { return null; }
}

async function fetchAll(t: TrailSummary): Promise<Cached> {
  const { lat, lon } = t.parking;
  const wx = fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`,
  ).then((r) => r.json()).then((j) => j.daily.time.map((date: string, i: number): Day => ({
    date, code: j.daily.weather_code[i], hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i],
    rain: j.daily.precipitation_probability_max[i] ?? 0, wind: j.daily.wind_speed_10m_max[i],
  })));
  const nws = fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: "application/geo+json" } })
    .then((r) => r.json())
    .then((j) => (j.features ?? []).map((f: any): Alert => ({
      title: f.properties.event, text: f.properties.headline ?? f.properties.description ?? "", source: "NWS",
      severe: ["Extreme", "Severe"].includes(f.properties.severity),
    })))
    .catch(() => [] as Alert[]);
  const nps = t.parkCode
    ? fetch(`https://developer.nps.gov/api/v1/alerts?parkCode=${t.parkCode}&limit=20&api_key=${NPS_KEY}`)
        .then((r) => r.json())
        .then((j) => (j.data ?? []).map((a: any): Alert => ({ title: a.title, text: a.description, url: a.url || undefined, source: "NPS", severe: /closure|danger/i.test(a.category ?? "") })))
        .catch(() => [] as Alert[])
    : Promise.resolve([] as Alert[]);
  const [days, a1, a2] = await Promise.all([wx, nws, nps]);
  return { at: Date.now(), days, alerts: [...a1, ...a2] };
}

export function Conditions({ trail }: { trail: TrailSummary }) {
  const [data, setData] = useState<Cached | null>(() => load(trail.id));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(load(trail.id));
    setFailed(false);
    let live = true;
    fetchAll(trail).then((d) => {
      if (!live) return;
      setData(d);
      try { localStorage.setItem(KEY(trail.id), JSON.stringify(d)); } catch { /* storage full or blocked */ }
    }, () => live && setFailed(true));
    return () => { live = false; };
  }, [trail.id]);

  const today = new Date();
  const sun = sunTimes(today, trail.parking.lat, trail.parking.lon);
  // Latest start that still finishes by sunset at the estimated pace.
  const startBy = sun ? new Date(sun.set.getTime() - trail.hours * 3600e3) : null;
  const ageH = data ? (Date.now() - data.at) / 3600e3 : 0;

  return (
    <section className="conditions">
      <h2>Conditions</h2>
      {sun && (
        <div className="daylight">
          <div><span>Sunrise</span><b>{fmtTime(sun.rise)}</b></div>
          <div><span>Sunset</span><b>{fmtTime(sun.set)}</b></div>
          <div><span>Start by</span><b>{startBy && startBy > sun.rise ? fmtTime(startBy) : "—"}</b></div>
        </div>
      )}
      {sun && <p className="muted small">Start by: latest start to finish before sunset at the estimated pace ({Math.round(((sun.set.getTime() - sun.rise.getTime()) / 3600e3) * 10) / 10} h of daylight today).</p>}

      {data?.alerts.length ? (
        <ul className="alerts">
          {data.alerts.map((a, i) => (
            <li key={i} className={a.severe ? "severe" : ""}>
              <details>
                <summary><span className="alert-src">{a.source === "NPS" ? "Park alert" : "Weather alert"}</span> {a.title}</summary>
                <p>{a.text}</p>
                {a.url && <a href={a.url} target="_blank" rel="noreferrer">More from the park</a>}
              </details>
            </li>
          ))}
        </ul>
      ) : data ? <p className="muted small">No park alerts or weather warnings right now.</p> : null}

      {data?.days.length ? (
        <div className="week">
          {data.days.map((d, i) => {
            const s = sunTimes(new Date(`${d.date}T12:00`), trail.parking.lat, trail.parking.lon);
            return (
              <div key={d.date} className="day">
                <span className="dname">{dayName(d.date, i)}</span>
                <span className="wx" title={wxText(d.code)}>{wxIcon(d.code)}</span>
                <b>{Math.round(d.hi)}°</b>
                <span className="muted">{Math.round(d.lo)}°</span>
                <span className="rain">{d.rain >= 10 ? `${d.rain}%` : ""}</span>
                <span className="muted tiny">{s ? fmtTime(s.set).replace(/\s?[AP]M/i, "") : ""}</span>
              </div>
            );
          })}
        </div>
      ) : !data && !failed ? <p className="muted">Loading weather…</p> : null}
      {data?.days.length ? <p className="muted small">Bottom row: sunset. Rain chance shown when 10% or more. Weather at the trailhead from Open-Meteo{ageH > 1 ? `, as of ${Math.round(ageH)} h ago` : ""}.</p> : null}
      {failed && !data && <p className="muted">No signal: weather and alerts will show next time you're online.</p>}
    </section>
  );
}

function wxIcon(c: number) {
  if (c === 0) return "☀️";
  if (c <= 2) return "🌤️";
  if (c === 3) return "☁️";
  if (c <= 48) return "🌫️";
  if (c <= 57) return "🌦️";
  if (c <= 67 || (c >= 80 && c <= 82)) return "🌧️";
  if (c <= 77 || c === 85 || c === 86) return "🌨️";
  return "⛈️";
}
function wxText(c: number) {
  return c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Cloudy" : c <= 48 ? "Fog" : c <= 57 ? "Drizzle" : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : c <= 86 ? "Snow showers" : "Thunderstorms";
}
