import { useMemo, useState } from "react";
import { DayNote, HypoEvent, InsulinDose, Reading, Settings, fmt, unitLabel } from "../lib/types";
import { localIso } from "../lib/stats";
import { NoteForm } from "./Notes";

type Metric = "avg" | "tir" | "low";
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${Math.round(pct)}%, var(--surface))`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function CalendarView({ readings, insulin, hypos, notes, s, commitN }: { readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; notes: DayNote[]; s: Settings; commitN: (n: DayNote[], m?: string) => void }) {
  const todayK = localIso(Date.now()).slice(0, 10);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [metric, setMetric] = useState<Metric>("avg");
  const [sel, setSel] = useState<string>(todayK);
  const u = unitLabel(s.unit);

  const byDay = useMemo(() => {
    const m = new Map<string, { n: number; mean: number; tir: number; min: number }>();
    const g = new Map<string, number[]>();
    for (const r of readings) if (r.flag !== "control") { const k = r.ts.slice(0, 10); (g.get(k) ?? g.set(k, []).get(k)!).push(r.mgdl); }
    g.forEach((v, k) => m.set(k, { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, tir: (v.filter((x) => x >= s.low && x <= s.high).length / v.length) * 100, min: Math.min(...v) }));
    return m;
  }, [readings, s.low, s.high]);
  const hypoDays = useMemo(() => new Set(hypos.map((h) => h.ts.slice(0, 10))), [hypos]);
  const noteDays = useMemo(() => new Set(notes.map((n) => n.ts.slice(0, 10))), [notes]);

  const y = month.getFullYear(), mo = month.getMonth();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];

  const color = (d?: { mean: number; tir: number; min: number }) => {
    if (!d) return "var(--bg)";
    if (metric === "avg") return d.mean < s.low ? mix("var(--low)", 62) : d.mean > s.high ? mix("var(--high)", Math.min(75, 40 + (d.mean - s.high) / 2)) : mix("var(--ok)", 48);
    if (metric === "tir") return d.tir >= 70 ? mix("var(--ok)", 38 + (d.tir - 70) * 0.9) : d.tir >= 40 ? mix("var(--low)", 55) : mix("var(--high)", 62);
    return d.min < 54 ? mix("var(--high)", 68) : d.min < s.low ? mix("var(--low)", 62) : mix("var(--ok)", 48);
  };
  const val = (d?: { mean: number; tir: number; min: number }) => (!d ? "" : metric === "avg" ? fmt(d.mean, s.unit) : metric === "tir" ? Math.round(d.tir) + "%" : fmt(d.min, s.unit));

  const dayReadings = readings.filter((r) => r.ts.slice(0, 10) === sel), dayIns = insulin.filter((d) => d.ts.slice(0, 10) === sel);
  const dayHypo = hypos.filter((h) => h.ts.slice(0, 10) === sel), dayNotes = notes.filter((n) => n.ts.slice(0, 10) === sel);
  const tagsInUse = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))], [notes]);
  const label = (k: string) => new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (<>
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="row">
          <button className="btn" aria-label="Previous month" onClick={() => setMonth(new Date(y, mo - 1, 1))}>‹</button>
          <h2 style={{ margin: 0, minWidth: 150, textAlign: "center" }}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
          <button className="btn" aria-label="Next month" onClick={() => setMonth(new Date(y, mo + 1, 1))}>›</button>
          <button className="btn sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(todayK); }}>Today</button>
        </div>
        <div className="seg" role="group" aria-label="Colour by">{([["avg", "Average"], ["tir", "Time in range"], ["low", "Lowest"]] as [Metric, string][]).map(([m, l]) => <button key={m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>{l}</button>)}</div>
      </div>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={"b" + i} className="day blank" />;
          const k = key(y, mo, d), info = byDay.get(k);
          return (
            <button key={k} className={"day" + (sel === k ? " sel" : "")} style={{ background: color(info) }} onClick={() => setSel(k)}
              aria-label={`${label(k)}${info ? `, average ${fmt(info.mean, s.unit)} ${u}, ${info.n} tests` : ", no readings"}`}>
              <span className="n">{d}</span><span className="mk">{hypoDays.has(k) ? "▽" : ""}{noteDays.has(k) ? " ✎" : ""}</span>
              <span className="v">{val(info)}</span><span className="t">{info ? `${info.n} test${info.n === 1 ? "" : "s"}` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="legend" style={{ marginTop: 14 }}>
        <span><span className="sw" style={{ background: mix("var(--ok)", 55) }} />in range</span><span><span className="sw" style={{ background: mix("var(--low)", 62) }} />low / needs a look</span><span><span className="sw" style={{ background: mix("var(--high)", 62) }} />high / very low</span>
        <span>▽ low-glucose event · ✎ note</span>
      </div>
    </section>

    <section className="panel">
      <h2>{label(sel)}</h2>
      {!dayReadings.length && !dayIns.length && !dayHypo.length && !dayNotes.length && <p className="note">Nothing recorded for this day.</p>}
      {dayReadings.length > 0 && <table><thead><tr><th>Time</th><th>Result ({u})</th><th>Type</th></tr></thead><tbody>{dayReadings.map((r) => <tr key={r.id}><td>{r.ts.slice(11, 16)}</td><td className="val" style={{ color: r.flag === "control" ? "var(--muted)" : r.mgdl < s.low ? "var(--low)" : r.mgdl > s.high ? "var(--high)" : "var(--ok)" }}>{fmt(r.mgdl, s.unit)}</td><td>{r.flag === "control" ? <span className="chip ctl">Control</span> : <span className="chip">Blood</span>}</td></tr>)}</tbody></table>}
      {dayIns.length > 0 && <p style={{ marginBottom: 6 }}><b>Insulin:</b> {dayIns.map((d) => `${d.ts.slice(11, 16)} ${d.units} u${d.kind ? ` (${d.kind})` : ""}`).join(" · ")} <span className="note">total {Math.round(dayIns.reduce((a, d) => a + d.units, 0) * 10) / 10} units</span></p>}
      {dayHypo.map((h) => <p key={h.id} style={{ margin: "4px 0" }}><b>Low-glucose event</b> at {h.ts.slice(11, 16)}{h.mgdl ? `, ${fmt(h.mgdl, s.unit)} ${u}` : ""}{h.treatment ? `, treated with ${h.treatment}` : ""}{h.assisted ? " (needed help)" : ""}</p>)}
      {dayNotes.map((n) => <div key={n.id} className="card" style={{ marginTop: 8 }}><div><div className="note">{n.ts.slice(11, 16)}</div><div>{n.text}</div><div className="chips" style={{ marginTop: 5 }}>{n.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div></div><button className="btn sm danger" onClick={() => commitN(notes.filter((x) => x.id !== n.id), "Note deleted")}>Delete</button></div>)}
      <h2 style={{ marginTop: 18 }}>Add a note for this day</h2>
      <NoteForm key={sel} defaultTs={sel === todayK ? localIso(Date.now()) : sel + "T12:00:00"} tagsInUse={tagsInUse} onSave={(n) => commitN([...notes, n].sort((a, b) => a.ts.localeCompare(b.ts)), "Note added")} />
    </section>
  </>);
}
