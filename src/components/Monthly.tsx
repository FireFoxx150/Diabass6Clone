import { useMemo } from "react";
import { InsulinDose, Reading, Settings, fmt, unitLabel } from "../lib/types";
import { monthlyStats } from "../lib/monthly";
import { localIso } from "../lib/stats";
import { MonthlyChart } from "./Charts";

export default function MonthlyView({ readings, insulin, s }: { readings: Reading[]; insulin: InsulinDose[]; s: Settings }) {
  const rows = useMemo(() => monthlyStats(readings, insulin, s.low, s.high, localIso(Date.now()).slice(0, 10)), [readings, insulin, s.low, s.high]);
  const withIns = rows.some((r) => r.insulinPerDay !== undefined);
  if (!rows.length) return <div className="panel empty">No readings yet.</div>;
  const name = (m: string) => new Date(m + "-01T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const desc = [...rows].reverse();
  return (<>
    <section className="panel">
      <h2>Time in range by month</h2>
      <MonthlyChart rows={rows} />
      <div className="legend" style={{ marginTop: 10 }}>
        <span><span className="dot" style={{ background: "var(--low)" }} />below {fmt(s.low, s.unit)}</span><span><span className="dot" style={{ background: "var(--ok)" }} />in range</span><span><span className="dot" style={{ background: "var(--high)" }} />above {fmt(s.high, s.unit)} {unitLabel(s.unit)}</span>
      </div>
    </section>
    <section className="panel">
      <h2>Month by month</h2>
      <table><thead><tr><th>Month</th><th className="r">Tests</th><th className="r">Per day</th><th className="r">Average</th><th className="r">In range</th><th className="r">Below</th><th className="r">Above</th><th className="r">Est. A1c</th>{withIns && <th className="r">Insulin / day</th>}</tr></thead><tbody>
        {desc.map((r, i) => {
          const prev = desc[i + 1], d = prev ? r.tir - prev.tir : 0;
          return <tr key={r.month}><td>{name(r.month)}</td><td className="r">{r.n}</td><td className="r">{r.perDay.toFixed(1)}</td><td className="r val">{fmt(r.mean, s.unit)}</td>
            <td className="r">{r.tir.toFixed(0)}%{prev && Math.abs(d) >= 1 && <span style={{ color: d > 0 ? "var(--ok)" : "var(--high)", marginLeft: 6 }}>{d > 0 ? "▲" : "▼"}{Math.abs(d).toFixed(0)}</span>}</td>
            <td className="r">{r.low.toFixed(0)}% <span className="note">({r.lows})</span></td><td className="r">{r.high.toFixed(0)}%</td><td className="r">{r.a1c.toFixed(1)}%</td>{withIns && <td className="r">{r.insulinPerDay !== undefined ? r.insulinPerDay.toFixed(1) : "–"}</td>}</tr>;
        })}
      </tbody></table>
      <p className="note">Arrows compare time in range with the month before. "Per day" counts tests across the days the month had data for. The current month is partial. Control-solution tests are excluded.</p>
    </section>
  </>);
}
