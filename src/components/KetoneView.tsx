import { useState } from "react";
import { KetoneReading, KindRule, Reading } from "../lib/types";
import { UnknownKind } from "../lib/kinds";
import { KETONE_NOTE, ketoneBand } from "../lib/ketone";
import { newId } from "../lib/parse";
import { localIso } from "../lib/stats";
import { ValueChart } from "./Charts";

const sel: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", color: "var(--text)" };
const tone = { ok: "var(--ok)", warn: "var(--low)", bad: "var(--high)" } as const;

function KindRow({ k, assign }: { k: UnknownKind; assign: (key: string, rule: KindRule) => void }) {
  const [as, setAs] = useState<"ketone" | "ignore">("ketone"), [div, setDiv] = useState("10");
  const d = parseFloat(div), preview = as === "ketone" && d > 0 ? k.samples.map((s) => (s.value / d).toFixed(1)).join(", ") : "";
  return (
    <div className="card" style={{ display: "block" }}>
      <div><b>Record kind {k.key}</b> <span className="note">· {k.count} records</span></div>
      <div className="note" style={{ margin: "4px 0 8px" }}>Examples: {k.samples.map((s) => `${s.ts.slice(0, 10)} raw ${s.value}`).join(" · ")}</div>
      <div className="row">
        <label className="field">These are<select value={as} onChange={(e) => setAs(e.target.value as "ketone" | "ignore")} style={sel}><option value="ketone">Ketone readings (mmol/L)</option><option value="ignore">Something else: ignore them</option></select></label>
        {as === "ketone" && <label className="field">Raw value divided by<input size={5} value={div} onChange={(e) => setDiv(e.target.value)} /></label>}
        <button className="btn primary" style={{ alignSelf: "end" }} disabled={as === "ketone" && !(d > 0)} onClick={() => assign(k.key, { as, divisor: as === "ketone" ? d : 1 })}>Save choice</button>
      </div>
      {preview && <div className="note" style={{ marginTop: 6 }}>That would read as {preview} mmol/L. Ketone readings are normally between 0 and about 6. If these look wrong, ignore them or change the divisor.</div>}
    </div>
  );
}

export default function KetoneView({ ketones, readings, unknown, assign, commitK, say }: { ketones: KetoneReading[]; readings: Reading[]; unknown: UnknownKind[]; assign: (key: string, rule: KindRule) => void; commitK: (k: KetoneReading[], m?: string) => void; say: (m: string) => void }) {
  const [ts, setTs] = useState(localIso(Date.now()).slice(0, 16)), [val, setVal] = useState("");
  const hct = readings.filter((r) => r.hct && r.flag !== "control").map((r) => ({ ts: r.ts, v: r.hct! }));
  const hv = hct.map((p) => p.v), kv = ketones.map((k) => k.mmol);
  const add = () => { const v = parseFloat(val.replace(",", ".")); if (!isFinite(v) || v < 0 || v > 20) { say("Enter a ketone value between 0 and 20 mmol/L."); return; } commitK([...ketones, { id: newId(), ts: ts + ":00", mmol: Math.round(v * 10) / 10 }].sort((a, b) => a.ts.localeCompare(b.ts)), "Ketone reading added"); setVal(""); };
  return (<>
    {unknown.length > 0 && <section className="panel">
      <h2>The meter stored records I don't recognise</h2>
      <p className="note" style={{ marginTop: 0 }}>Your meter also keeps results of other kinds, possibly ketones. Rather than guess, tell me what each kind is. Check the examples against what your meter showed for those tests.</p>
      {unknown.map((k) => <KindRow key={k.key} k={k} assign={assign} />)}
    </section>}

    <section className="panel">
      <h2>Ketones</h2>
      {ketones.length ? <>
        <ValueChart points={ketones.map((k) => ({ ts: k.ts, v: k.mmol }))} yMin={0} yMax={Math.max(3.5, Math.ceil(Math.max(...kv)))} bands={[{ from: 0, to: 0.6, color: "var(--ok)" }, { from: 0.6, to: 1.6, color: "var(--low)" }, { from: 1.6, to: 99, color: "var(--high)" }]} fmtY={(v) => v.toFixed(1)} />
        <div className="tiles" style={{ marginTop: 12 }}>
          <div className="tile"><div className="k">Readings</div><div className="v">{ketones.length}</div></div>
          <div className="tile"><div className="k">Latest</div><div className="v">{ketones[ketones.length - 1].mmol.toFixed(1)}<span className="u">mmol/L · {ketoneBand(ketones[ketones.length - 1].mmol).label}</span></div></div>
          <div className="tile"><div className="k">Highest</div><div className="v">{Math.max(...kv).toFixed(1)}<span className="u">mmol/L</span></div></div>
          <div className="tile"><div className="k">At 0.6 or above</div><div className="v">{kv.filter((v) => v >= 0.6).length}</div></div>
        </div>
      </> : <div className="empty">No ketone readings yet. Add one below, or assign a meter record kind above if your meter stores them.</div>}
      <p className="note">{KETONE_NOTE}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field">Date & time<input type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} /></label>
        <label className="field">mmol/L<input size={5} inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
        <button className="btn primary" style={{ alignSelf: "end" }} onClick={add}>Add ketone reading</button>
      </div>
      {ketones.length > 0 && <table style={{ marginTop: 14 }}><thead><tr><th>Date & time</th><th className="r">mmol/L</th><th>Band</th><th /></tr></thead><tbody>
        {[...ketones].reverse().slice(0, 100).map((k) => { const b = ketoneBand(k.mmol); return <tr key={k.id}><td>{k.ts.slice(0, 16).replace("T", "  ")}</td><td className="r val" style={{ color: tone[b.tone] }}>{k.mmol.toFixed(1)}</td><td>{b.label}</td><td className="r"><button className="btn sm danger" onClick={() => commitK(ketones.filter((x) => x.id !== k.id), "Ketone reading deleted")}>Delete</button></td></tr>; })}
      </tbody></table>}
    </section>

    <section className="panel">
      <h2>Haematocrit</h2>
      {hct.length ? <>
        <ValueChart points={hct} fmtY={(v) => Math.round(v) + "%"} />
        <div className="tiles" style={{ marginTop: 12 }}>
          <div className="tile"><div className="k">Readings</div><div className="v">{hct.length}</div></div>
          <div className="tile"><div className="k">Average</div><div className="v">{(hv.reduce((a, b) => a + b, 0) / hv.length).toFixed(0)}<span className="u">%</span></div></div>
          <div className="tile"><div className="k">Range</div><div className="v">{Math.min(...hv)}–{Math.max(...hv)}<span className="u">%</span></div></div>
          <div className="tile"><div className="k">Latest</div><div className="v">{hct[hct.length - 1].v}<span className="u">%</span></div></div>
        </div>
      </> : <div className="empty">No haematocrit values yet. They are stored by the meter next to each glucose reading, and arrive with a download.</div>}
      <p className="note">The meter measures haematocrit (the share of blood that is red cells) to correct its glucose result. Unusual values are worth mentioning to your clinician.</p>
    </section>
  </>);
}
