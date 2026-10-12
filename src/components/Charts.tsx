import { DayNote, InsulinDose, LabA1c, Reading, fmt, unitLabel, Settings, MMOL } from "../lib/types";
import type { MonthRow } from "../lib/monthly";
import { agpPoints, hourOf, quantile } from "../lib/stats";
import { meterEstimate } from "../lib/labs";

const W = 860, H = 300, L = 46, R = 14, T = 14, B = 30, LANE = 38;
const col = (v: number, lo: number, hi: number) => (v < lo ? "var(--low)" : v > hi ? "var(--high)" : "var(--ok)");

function Frame({ ymax, lo, hi, unit, children, xticks, lane }: { ymax: number; lo: number; hi: number; unit: Settings["unit"]; lane: boolean; children: (y: (v: number) => number) => React.ReactNode; xticks: { x: number; label: string }[] }) {
  const base = H - B - (lane ? LANE : 0);
  const y = (v: number) => T + (1 - v / ymax) * (base - T);
  const ticks = [0, 70, 140, 210, 280, 350].filter((t) => t <= ymax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      <rect x={L} y={y(hi)} width={W - L - R} height={y(lo) - y(hi)} fill="var(--ok)" opacity=".09" />
      {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{unit === "mgdl" ? t : (t / MMOL).toFixed(0)}</text></g>))}
      {[lo, hi].map((t) => <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--ok)" opacity=".5" />)}
      {lane && <g><line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--line)" /><text x={L - 8} y={H - B - 4} textAnchor="end" className="tick" style={{ fill: "var(--ins)" }}>Ins.</text>
        <text x={W - R} y={H - B - LANE + 10} textAnchor="end" className="tick" style={{ fill: "var(--ins)" }}>Insulin doses · bar height = units</text></g>}
      {xticks.map((t, i) => <text key={i} x={t.x} y={H - 8} textAnchor="middle" className="tick">{t.label}</text>)}
      {children(y)}
    </svg>
  );
}

function LaneBars({ doses, x }: { doses: InsulinDose[]; x: (d: InsulinDose) => number | null }) {
  const maxU = Math.max(10, ...doses.map((d) => d.units));
  return <>{doses.map((d) => {
    const px = x(d); if (px == null) return null;
    const h = Math.max(3, (d.units / maxU) * (LANE - 12));
    return <rect key={d.id} x={px - 1.2} y={H - B - h} width={2.4} height={h} rx="1" fill="var(--ins)" opacity=".9"><title>{`${d.ts.replace("T", " ")} · ${d.units} units${d.kind ? " · " + d.kind : ""}`}</title></rect>;
  })}</>;
}

export function TrendChart({ readings, s, doses, notes }: { readings: Reading[]; s: Settings; doses?: InsulinDose[]; notes?: DayNote[] }) {
  const rs = readings.filter((r) => r.flag !== "control");
  if (!rs.length) return <div className="empty">No readings in this period.</div>;
  const t0 = new Date(rs[0].ts).getTime(), t1 = Math.max(new Date(rs[rs.length - 1].ts).getTime(), t0 + 3600e3);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const ymax = Math.max(250, Math.ceil(Math.max(...rs.map((r) => r.mgdl)) / 50) * 50);
  const xt = Array.from({ length: 6 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / 5; return { x: x(t), label: new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }; });
  const ds = (doses ?? []).filter((d) => { const t = new Date(d.ts).getTime(); return t >= t0 && t <= t1; });
  const ns = (notes ?? []).filter((n) => { const t = new Date(n.ts).getTime(); return t >= t0 && t <= t1; });
  return (
    <Frame ymax={ymax} lo={s.low} hi={s.high} unit={s.unit} xticks={xt} lane={ds.length > 0}>
      {(y) => (<>
        {ns.map((n) => { const cx = x(new Date(n.ts).getTime()); return <path key={n.id} d={`M${cx} ${T} l5 6 l-5 6 l-5 -6 z`} fill="var(--accent)" opacity=".85"><title>{`${n.ts.slice(0, 16).replace("T", " ")} · ${n.tags.join(", ")}${n.text ? " · " + n.text : ""}`}</title></path>; })}
        {ds.length > 0 && <LaneBars doses={ds} x={(d) => x(new Date(d.ts).getTime())} />}
        <polyline fill="none" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="1.2" points={rs.map((r) => `${x(new Date(r.ts).getTime())},${y(r.mgdl)}`).join(" ")} />
        {rs.map((r) => <circle key={r.id} cx={x(new Date(r.ts).getTime())} cy={y(r.mgdl)} r="3.4" fill={col(r.mgdl, s.low, s.high)}><title>{`${r.ts.replace("T", " ")} · ${fmt(r.mgdl, s.unit)} ${unitLabel(s.unit)}`}</title></circle>)}
      </>)}
    </Frame>
  );
}

export function ProfileChart({ readings, s, doses }: { readings: Reading[]; s: Settings; doses?: InsulinDose[] }) {
  const rs = readings.filter((r) => r.flag !== "control");
  if (!rs.length) return <div className="empty">No readings in this period.</div>;
  const x = (h: number) => L + (h / 24) * (W - L - R);
  const ymax = Math.max(250, Math.ceil(Math.max(...rs.map((r) => r.mgdl)) / 50) * 50);
  const bins = Array.from({ length: 24 }, (_, h) => rs.filter((r) => Math.floor(hourOf(r)) === h).map((r) => r.mgdl));
  const pts = bins.map((b, h) => (b.length >= 2 ? { h: h + 0.5, q1: quantile(b, 0.25), med: quantile(b, 0.5), q3: quantile(b, 0.75) } : null)).filter(Boolean) as { h: number; q1: number; med: number; q3: number }[];
  const xt = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({ x: x(h), label: `${String(h % 24).padStart(2, "0")}:00` }));
  const ds = doses ?? [];
  return (
    <Frame ymax={ymax} lo={s.low} hi={s.high} unit={s.unit} xticks={xt} lane={ds.length > 0}>
      {(y) => (<>
        {ds.length > 0 && <g opacity=".6"><LaneBars doses={ds} x={(d) => x(hourOf(d))} /></g>}
        {pts.length > 1 && <polygon fill="var(--accent)" opacity=".16" points={[...pts.map((p) => `${x(p.h)},${y(p.q3)}`), ...[...pts].reverse().map((p) => `${x(p.h)},${y(p.q1)}`)].join(" ")} />}
        {rs.map((r) => <circle key={r.id} cx={x(hourOf(r))} cy={y(r.mgdl)} r="2.4" fill={col(r.mgdl, s.low, s.high)} opacity=".45" />)}
        {pts.length > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinejoin="round" points={pts.map((p) => `${x(p.h)},${y(p.med)}`).join(" ")} />}
      </>)}
    </Frame>
  );
}

export function DoseChart({ doses }: { doses: InsulinDose[] }) {
  if (!doses.length) return <div className="empty">No doses in this period.</div>;
  const byDay = new Map<string, number>();
  for (const d of doses) byDay.set(d.ts.slice(0, 10), (byDay.get(d.ts.slice(0, 10)) ?? 0) + d.units);
  const keys = [...byDay.keys()].sort();
  const t0 = new Date(keys[0] + "T00:00:00").getTime();
  const n = Math.round((new Date(keys[keys.length - 1] + "T00:00:00").getTime() - t0) / 864e5) + 1;
  const ymax = Math.max(10, Math.ceil(Math.max(...byDay.values()) / 10) * 10);
  const bw = (W - L - R) / n, y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(ymax * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{t}</text></g>)}
      {Array.from({ length: Math.min(6, n) }, (_, i) => { const idx = n === 1 ? 0 : Math.round((i * (n - 1)) / (Math.min(6, n) - 1)); const dt = new Date(t0 + idx * 864e5); return <text key={i} x={L + (idx + 0.5) * bw} y={H - 8} textAnchor="middle" className="tick">{dt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>; })}
      {keys.map((k) => { const idx = Math.round((new Date(k + "T00:00:00").getTime() - t0) / 864e5); const v = byDay.get(k)!; return <rect key={k} x={L + idx * bw + bw * 0.12} y={y(v)} width={Math.max(1.5, bw * 0.76)} height={y(0) - y(v)} rx="2" fill="var(--ins)" opacity=".85"><title>{`${k} · ${v} units`}</title></rect>; })}
    </svg>
  );
}

export function AgpChart({ readings, s }: { readings: Reading[]; s: Settings }) {
  const pts = agpPoints(readings);
  if (pts.length < 6) return <div className="empty">The 24-hour profile needs about 30 or more readings spread across the day.</div>;
  const x = (h: number) => L + (h / 24) * (W - L - R);
  const ymax = Math.max(250, Math.ceil(Math.max(...pts.map((p) => p.p95)) / 50) * 50);
  const xt = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({ x: x(h), label: `${String(h % 24).padStart(2, "0")}:00` }));
  const band = (y: (v: number) => number, hi: keyof typeof pts[0], lo: keyof typeof pts[0]) =>
    [...pts.map((p) => `${x(p.h)},${y(p[hi] as number)}`), ...[...pts].reverse().map((p) => `${x(p.h)},${y(p[lo] as number)}`)].join(" ");
  return (
    <Frame ymax={ymax} lo={s.low} hi={s.high} unit={s.unit} xticks={xt} lane={false}>
      {(y) => (<>
        <polygon fill="var(--accent)" opacity=".15" points={band(y, "p95", "p5")} />
        <polygon fill="var(--accent)" opacity=".3" points={band(y, "p75", "p25")} />
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2.8" strokeLinejoin="round" points={pts.map((p) => `${x(p.h)},${y(p.p50)}`).join(" ")} />
        <text x={W - R} y={T + 10} textAnchor="end" className="tick">Line = median · dark band = 25–75% · light band = 5–95%</text>
      </>)}
    </Frame>
  );
}

export function LabChart({ labs, readings }: { labs: LabA1c[]; readings: Reading[] }) {
  if (!labs.length) return <div className="empty">No lab results yet.</div>;
  const sorted = [...labs].sort((a, b) => a.date.localeCompare(b.date));
  const est = sorted.map((l) => meterEstimate(readings, l.date));
  const vals = [...sorted.map((l) => l.ngsp), ...est.filter(Boolean).map((e) => e!.a1c)];
  const lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
  const t = (d: string) => new Date(d + "T00:00:00").getTime();
  const t0 = t(sorted[0].date) - 15 * 864e5, t1 = Math.max(t(sorted[sorted.length - 1].date) + 15 * 864e5, t0 + 60 * 864e5);
  const x = (d: string) => L + ((t(d) - t0) / (t1 - t0)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {grid.map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="2 5" /><text x={L - 8} y={y(g) + 4} textAnchor="end" className="tick">{g}%</text></g>)}
      {Array.from({ length: 5 }, (_, i) => { const tt = t0 + ((t1 - t0) * i) / 4; return <text key={i} x={L + ((W - L - R) * i) / 4} y={H - 8} textAnchor="middle" className="tick">{new Date(tt).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</text>; })}
      <text x={W - R} y={T + 10} textAnchor="end" className="tick">Filled = lab result · hollow = meter estimate (90 days before)</text>
      <polyline fill="none" stroke="var(--accent)" strokeOpacity=".5" strokeWidth="1.5" points={sorted.map((l) => `${x(l.date)},${y(l.ngsp)}`).join(" ")} />
      {sorted.map((l, i) => { const e = est[i]; return (<g key={l.id}>
        {e && <line x1={x(l.date)} x2={x(l.date)} y1={y(l.ngsp)} y2={y(e.a1c)} stroke="var(--muted)" strokeDasharray="3 3" />}
        {e && <circle cx={x(l.date)} cy={y(e.a1c)} r="5.5" fill="none" stroke="var(--ins)" strokeWidth="2"><title>{`Meter estimate ${e.a1c.toFixed(1)}% from ${e.n} readings`}</title></circle>}
        <circle cx={x(l.date)} cy={y(l.ngsp)} r="6" fill="var(--accent)"><title>{`${l.date} · lab ${l.ngsp.toFixed(1)}%`}</title></circle>
      </g>); })}
    </svg>
  );
}

const MON = (m: string) => new Date(m + "-01T12:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

/** Stacked 100% bars per month: below range, in range, above range. */
export function MonthlyChart({ rows }: { rows: MonthRow[] }) {
  if (!rows.length) return <div className="empty">No readings yet.</div>;
  const n = rows.length, bw = (W - L - R) / n, y = (p: number) => T + (1 - p / 100) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {[0, 25, 50, 75, 100].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{t}%</text></g>)}
      {rows.map((r, i) => {
        const x = L + i * bw + bw * 0.14, w = bw * 0.72; let acc = 0;
        const seg = [[r.low, "var(--low)"], [r.tir, "var(--ok)"], [r.high, "var(--high)"]] as [number, string][];
        return (<g key={r.month}>
          {seg.map(([p, c], j) => { const y0 = y(acc + p), h = y(acc) - y0; acc += p; return <rect key={j} x={x} y={y0} width={w} height={Math.max(0, h)} fill={c} opacity=".9"><title>{`${MON(r.month)} · ${p.toFixed(0)}%`}</title></rect>; })}
          {r.tir >= 12 && <text x={x + w / 2} y={y(r.low + r.tir / 2) + 4} textAnchor="middle" style={{ fontSize: 12, fill: "var(--bg)", fontWeight: 700 }}>{r.tir.toFixed(0)}%</text>}
          <text x={x + w / 2} y={H - 8} textAnchor="middle" className="tick">{MON(r.month)}</text>
        </g>);
      })}
    </svg>
  );
}

/** A value over time with optional coloured bands (for ketones and haematocrit). */
export function ValueChart({ points, bands, yMin, yMax, fmtY }: { points: { ts: string; v: number }[]; bands?: { from: number; to: number; color: string }[]; yMin?: number; yMax?: number; fmtY?: (v: number) => string }) {
  if (!points.length) return <div className="empty">Nothing recorded yet.</div>;
  const t0 = new Date(points[0].ts).getTime(), t1 = Math.max(new Date(points[points.length - 1].ts).getTime(), t0 + 3600e3);
  const vals = points.map((p) => p.v), lo = yMin ?? Math.floor(Math.min(...vals) - 1), hi = yMax ?? Math.ceil(Math.max(...vals) + 1), span = Math.max(1e-6, hi - lo);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const f = fmtY ?? ((v: number) => String(Math.round(v * 10) / 10)), colour = (v: number) => bands?.find((b) => v >= b.from && v < b.to)?.color ?? "var(--accent)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
      {bands?.map((b, i) => { const a = Math.max(lo, b.from), z = Math.min(hi, b.to); return z > a ? <rect key={i} x={L} y={y(z)} width={W - L - R} height={y(a) - y(z)} fill={b.color} opacity=".09" /> : null; })}
      {Array.from({ length: 5 }, (_, i) => lo + (span * i) / 4).map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="2 5" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{f(t)}</text></g>)}
      {Array.from({ length: 5 }, (_, i) => { const t = t0 + ((t1 - t0) * i) / 4; return <text key={i} x={x(t)} y={H - 8} textAnchor="middle" className="tick">{new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>; })}
      <polyline fill="none" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="1.2" points={points.map((p) => `${x(new Date(p.ts).getTime())},${y(p.v)}`).join(" ")} />
      {points.map((p, i) => <circle key={i} cx={x(new Date(p.ts).getTime())} cy={y(p.v)} r="3.6" fill={colour(p.v)}><title>{`${p.ts.slice(0, 16).replace("T", " ")} · ${f(p.v)}`}</title></circle>)}
    </svg>
  );
}
