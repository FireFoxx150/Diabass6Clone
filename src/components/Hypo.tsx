import { useMemo, useState } from "react";
import { HypoEvent, MMOL, Reading, Settings, fmt, unitLabel } from "../lib/types";
import { newId } from "../lib/parse";
import { localIso } from "../lib/stats";

const SYMPTOMS = ["Shaky", "Sweating", "Hungry", "Dizzy", "Confused", "Headache", "Irritable", "Palpitations", "No symptoms (found by test)"];
interface Draft { id?: string; ts: string; val: string; readingId?: string; symptoms: string[]; treatment: string; recVal: string; recMins: string; assisted: boolean; note: string; }
const blank = (): Draft => ({ ts: localIso(Date.now()).slice(0, 16), val: "", symptoms: [], treatment: "", recVal: "", recMins: "", assisted: false, note: "" });

export default function HypoView({ hypos, readings, s, set, commitH, say }: { hypos: HypoEvent[]; readings: Reading[]; s: Settings; set: (p: Partial<Settings>) => void; commitH: (h: HypoEvent[], m?: string) => void; say: (m: string) => void }) {
  const [form, setForm] = useState<Draft | null>(null);
  const u = unitLabel(s.unit);
  const toMg = (v: string) => { const n = parseFloat(v.replace(",", ".")); return isFinite(n) && n > 0 ? (s.unit === "mgdl" ? n : n * MMOL) : undefined; };

  const unlogged = useMemo(() => {
    const cut = localIso(Date.now() - 30 * 864e5), gone = new Set(s.hypoDismissed ?? []);
    return [...readings].reverse().filter((r) => r.flag !== "control" && r.mgdl < s.low && r.ts >= cut && !gone.has(r.id)
      && !hypos.some((h) => h.readingId === r.id || Math.abs(new Date(h.ts).getTime() - new Date(r.ts).getTime()) < 30 * 60e3)).slice(0, 8);
  }, [readings, hypos, s.low, s.hypoDismissed]);

  const save = () => {
    if (!form) return;
    const mg = toMg(form.val);
    if (!form.ts || (!mg && !form.symptoms.length)) { say("Add a glucose value or at least one symptom."); return; }
    const ev: HypoEvent = { id: form.id ?? newId(), ts: form.ts.length === 16 ? form.ts + ":00" : form.ts, mgdl: mg, readingId: form.readingId, symptoms: form.symptoms, treatment: form.treatment.trim(), recoveryMgdl: toMg(form.recVal), recoveryMins: form.recMins ? parseInt(form.recMins, 10) || undefined : undefined, assisted: form.assisted, note: form.note.trim() || undefined };
    commitH([...hypos.filter((h) => h.id !== ev.id), ev].sort((a, b) => a.ts.localeCompare(b.ts)), form.id ? "Event updated" : "Low-glucose event logged");
    setForm(null);
  };
  const edit = (h: HypoEvent) => setForm({ id: h.id, ts: h.ts.slice(0, 16), val: h.mgdl ? fmt(h.mgdl, s.unit) : "", readingId: h.readingId, symptoms: h.symptoms, treatment: h.treatment, recVal: h.recoveryMgdl ? fmt(h.recoveryMgdl, s.unit) : "", recMins: h.recoveryMins ? String(h.recoveryMins) : "", assisted: h.assisted, note: h.note ?? "" });
  const cut90 = localIso(Date.now() - 90 * 864e5), recent = hypos.filter((h) => h.ts >= cut90);
  const mins = recent.map((h) => h.recoveryMins).filter((x): x is number => !!x);

  return (<>
    <div className="tiles">
      <div className="tile"><div className="k">Events, last 90 days</div><div className="v">{recent.length}</div></div>
      <div className="tile"><div className="k">Needed another person's help</div><div className="v">{recent.filter((h) => h.assisted).length}</div></div>
      <div className="tile"><div className="k">Average time to recover</div><div className="v">{mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : "–"}<span className="u">{mins.length ? "min" : ""}</span></div></div>
    </div>

    {unlogged.length > 0 && !form && <section className="panel">
      <h2>Lows from your meter that aren't logged yet (last 30 days)</h2>
      <table><tbody>{unlogged.map((r) => (
        <tr key={r.id}><td>{r.ts.slice(0, 16).replace("T", "  ")}</td><td className="val" style={{ color: "var(--low)" }}>{fmt(r.mgdl, s.unit)} {u}</td>
          <td className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn sm primary" onClick={() => setForm({ ...blank(), ts: r.ts.slice(0, 16), val: fmt(r.mgdl, s.unit), readingId: r.id })}>Add details</button>
            <button className="btn sm" onClick={() => set({ hypoDismissed: [...(s.hypoDismissed ?? []), r.id] })}>Skip</button></td></tr>))}</tbody></table>
    </section>}

    {form ? (
      <section className="panel">
        <h2>{form.id ? "Edit event" : "Log a low-glucose event"}</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field">Date & time<input type="datetime-local" value={form.ts} onChange={(e) => setForm({ ...form, ts: e.target.value })} /></label>
          <label className="field">Glucose ({u})<input size={6} inputMode="decimal" value={form.val} onChange={(e) => setForm({ ...form, val: e.target.value })} /></label>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>Symptoms
          <div className="chips">{SYMPTOMS.map((x) => <button key={x} className={form.symptoms.includes(x) ? "on" : ""} onClick={() => setForm({ ...form, symptoms: form.symptoms.includes(x) ? form.symptoms.filter((y) => y !== x) : [...form.symptoms, x] })}>{x}</button>)}</div>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field" style={{ flex: 1, minWidth: 240 }}>What you took to treat it
            <input list="treat" value={form.treatment} onChange={(e) => setForm({ ...form, treatment: e.target.value })} placeholder="e.g. 15 g glucose tablets" />
            <datalist id="treat"><option value="15 g fast-acting carbohydrate" /><option value="Glucose tablets" /><option value="Fruit juice" /><option value="Glucagon" /><option value="Meal or snack" /></datalist></label>
          <label className="field">Recovery reading ({u})<input size={6} inputMode="decimal" value={form.recVal} onChange={(e) => setForm({ ...form, recVal: e.target.value })} /></label>
          <label className="field">…after (minutes)<input size={5} inputMode="numeric" value={form.recMins} onChange={(e) => setForm({ ...form, recMins: e.target.value })} /></label>
        </div>
        <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={form.assisted} onChange={(e) => setForm({ ...form, assisted: e.target.checked })} />I needed another person's help to recover</label>
        <label className="field" style={{ marginBottom: 14 }}>Notes<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="What you were doing, last meal, exercise…" /></label>
        <div className="row"><button className="btn primary" onClick={save}>Save event</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div>
      </section>
    ) : <div style={{ marginBottom: 18 }}><button className="btn primary" onClick={() => setForm(blank())}>Log a low-glucose event</button></div>}

    <section className="panel">
      <h2>Event log ({hypos.length})</h2>
      {!hypos.length ? <div className="empty">No events logged yet. They appear in your doctor report.</div> : (
        <table><thead><tr><th>Date & time</th><th>Glucose</th><th>Symptoms</th><th>Treatment</th><th>Recovery</th><th /></tr></thead><tbody>
          {[...hypos].reverse().map((h) => (
            <tr key={h.id}>
              <td>{h.ts.slice(0, 16).replace("T", "  ")}{h.assisted && <span className="chip ctl" style={{ marginLeft: 8 }}>help needed</span>}</td>
              <td className="val" style={{ color: "var(--low)" }}>{h.mgdl ? fmt(h.mgdl, s.unit) : "–"}</td>
              <td className="note">{h.symptoms.join(", ") || "–"}</td><td>{h.treatment || "–"}</td>
              <td>{h.recoveryMgdl ? `${fmt(h.recoveryMgdl, s.unit)}${h.recoveryMins ? ` after ${h.recoveryMins} min` : ""}` : "–"}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}><button className="btn sm" onClick={() => edit(h)}>Edit</button><button className="btn sm danger" onClick={() => commitH(hypos.filter((x) => x.id !== h.id), "Event deleted")}>Delete</button></td>
            </tr>))}
        </tbody></table>)}
    </section>
  </>);
}
