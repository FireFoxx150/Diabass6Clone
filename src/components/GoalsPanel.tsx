import { useState } from "react";
import { Goals, Reading, Settings } from "../lib/types";
import { goalRows } from "../lib/goals";

export default function GoalsPanel({ readings, s, set }: { readings: Reading[]; s: Settings; set: (p: Partial<Settings>) => void }) {
  const [edit, setEdit] = useState(false), g = s.goals ?? {};
  const [d, setD] = useState({ t: String(g.testsPerDay ?? ""), r: String(g.tir ?? ""), l: String(g.maxLows ?? "") });
  const rows = goalRows(readings, s.goals, s.low, s.high, Date.now());
  const save = () => {
    const n = (x: string) => (x.trim() !== "" && isFinite(+x) && +x >= 0 ? +x : undefined);
    const goals: Goals = { testsPerDay: n(d.t), tir: n(d.r) && n(d.r)! <= 100 ? n(d.r) : undefined, maxLows: n(d.l) };
    set({ goals: goals.testsPerDay || goals.tir || goals.maxLows !== undefined ? goals : undefined }); setEdit(false);
  };
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}><h2 style={{ margin: 0 }}>My goals, last 14 days</h2><button className="btn sm" onClick={() => setEdit(!edit)}>{edit ? "Cancel" : rows.length ? "Edit goals" : "Set goals"}</button></div>
      {edit && <div className="row" style={{ marginBottom: 12 }}>
        <label className="field">Tests per day, at least<input size={5} inputMode="decimal" value={d.t} onChange={(e) => setD({ ...d, t: e.target.value })} /></label>
        <label className="field">Time in range %, at least<input size={5} inputMode="decimal" value={d.r} onChange={(e) => setD({ ...d, r: e.target.value })} /></label>
        <label className="field">Readings below range, at most<input size={5} inputMode="numeric" value={d.l} onChange={(e) => setD({ ...d, l: e.target.value })} /></label>
        <button className="btn primary" style={{ alignSelf: "end" }} onClick={save}>Save</button>
      </div>}
      {!rows.length && !edit && <p className="note" style={{ margin: 0 }}>Set a few targets of your own, such as testing four times a day, and see how the last two weeks compare. Pick goals with your clinician.</p>}
      {rows.map((r) => (
        <div key={r.key} style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}><span>{r.label}: <b>{r.actual}</b> <span className="note">(goal {r.target})</span></span><span style={{ color: r.ok ? "var(--ok)" : "var(--low)" }}>{r.ok ? "On track" : "Not yet"}</span></div>
          <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${r.pct}%`, background: r.ok ? "var(--ok)" : "var(--low)" }} /></div>
        </div>
      ))}
    </section>
  );
}
