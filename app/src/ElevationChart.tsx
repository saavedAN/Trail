import { useMemo, useRef } from "react";
import type { ProfilePoint } from "./types";

type Props = {
  profile: ProfilePoint[];
  /** Index of the point being inspected (drag), or null. */
  active: number | null;
  onActive: (i: number | null) => void;
  /** Where you are right now, in miles along the trail. */
  youMi?: number | null;
};

const W = 360, H = 150, L = 40, R = 8, T = 10, B = 22;

/** Elevation profile. Drag a finger along it to see that spot on the map. */
export function ElevationChart({ profile, active, onActive, youMi }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const { path, area, x, y, ticksY, ticksX, maxMi } = useMemo(() => {
    const maxMi = profile.at(-1)?.mi ?? 1;
    const lo = Math.min(...profile.map((p) => p.ft)), hi = Math.max(...profile.map((p) => p.ft));
    const step = niceStep((hi - lo) / 3 || 100);
    const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step || y0 + step;
    const x = (mi: number) => L + (mi / maxMi) * (W - L - R);
    const y = (ft: number) => T + (1 - (ft - y0) / (y1 - y0)) * (H - T - B);
    const path = profile.map((p, i) => `${i ? "L" : "M"}${x(p.mi).toFixed(1)},${y(p.ft).toFixed(1)}`).join("");
    const area = `${path}L${x(maxMi)},${H - B}L${x(0)},${H - B}Z`;
    const ticksY: number[] = [];
    for (let v = y0; v <= y1; v += step) ticksY.push(v);
    const xs = niceStep(maxMi / 4);
    const ticksX: number[] = [];
    for (let v = 0; v <= maxMi + 1e-9; v += xs) ticksX.push(+v.toFixed(2));
    return { path, area, x, y, ticksY, ticksX, maxMi };
  }, [profile]);

  const pick = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const mi = (((clientX - box.left) / box.width) * W - L) / (W - L - R) * maxMi;
    let best = 0;
    profile.forEach((p, i) => { if (Math.abs(p.mi - mi) < Math.abs(profile[best].mi - mi)) best = i; });
    onActive(best);
  };

  const a = active != null ? profile[active] : null;
  const you = youMi != null ? profile.reduce((b, p) => (Math.abs(p.mi - youMi) < Math.abs(b.mi - youMi) ? p : b), profile[0]) : null;

  return (
    <div className="chart">
      <div className="chart-readout">
        {a ? <>Mile <b>{a.mi.toFixed(2)}</b> · <b>{Math.round(a.ft).toLocaleString()} ft</b></> : <span className="muted">Drag along the chart to find a spot on the map</span>}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Elevation profile"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") onActive(null); }}
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 4} y={y(v) + 3} textAnchor="end" className="tick">{v.toLocaleString()}</text>
          </g>
        ))}
        {ticksX.map((v) => (
          <text key={v} x={x(v)} y={H - 6} textAnchor="middle" className="tick">{v} mi</text>
        ))}
        <path d={area} className="area" />
        <path d={path} className="line" />
        {you && <circle cx={x(you.mi)} cy={y(you.ft)} r={5} className="you" />}
        {a && (
          <g>
            <line x1={x(a.mi)} x2={x(a.mi)} y1={T} y2={H - B} className="cursor" />
            <circle cx={x(a.mi)} cy={y(a.ft)} r={5} className="dot" />
          </g>
        )}
      </svg>
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
