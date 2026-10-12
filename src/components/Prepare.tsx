import { useMemo, useState } from "react";
import { DayNote, HypoEvent, InsulinDose, KetoneReading, LabA1c, Reading, Settings } from "../lib/types";
import { api } from "../lib/api";
import { localIso } from "../lib/stats";

const iso = (d: Date) => localIso(d.getTime()).slice(0, 10);
const ago = (n: number) => iso(new Date(Date.now() - n * 864e5));
type Mode = "lab" | "appt" | "90" | "30" | "custom";

export default function PrepareView({ readings, insulin, hypos, labs, notes, ketones, s, set, say }: { readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; labs: LabA1c[]; notes: DayNote[]; ketones: KetoneReading[]; s: Settings; set: (p: Partial<Settings>) => void; say: (m: string) => void }) {
  const today = iso(new Date());
  const lastLab = labs.map((l) => l.date).filter((d) => d <= today).sort().pop();
  const [appt, setAppt] = useState(today), [mode, setMode] = useState<Mode>(lastLab ? "lab" : s.lastAppointment ? "appt" : "90");
  const [cFrom, setCFrom] = useState(ago(89)), [note, setNote] = useState(""), [pw, setPw] = useState(""), [logs, setLogs] = useState(false), [remember, setRemember] = useState(true), [busy, setBusy] = useState<"" | "summary" | "full">("");
  const to = appt < today ? appt : today;
  let from = mode === "lab" && lastLab ? lastLab : mode === "appt" && s.lastAppointment ? s.lastAppointment : mode === "30" ? ago(29) : mode === "custom" ? cFrom : ago(89);
  if (from > to) from = to;
  const counts = useMemo(() => ({ n: readings.filter((r) => r.flag !== "control" && r.ts.slice(0, 10) >= from && r.ts.slice(0, 10) <= to).length, d: insulin.filter((x) => x.ts.slice(0, 10) >= from && x.ts.slice(0, 10) <= to).length }), [readings, insulin, from, to]);
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) + 1);

  const build = async (kind: "summary" | "full") => {
    setBusy(kind);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const { buildReportPdf } = await import("../lib/pdfReport");
      const bytes = buildReportPdf({ readings, insulin, hypos, labs, notes, ketones, s, from, to, clinicianNote: note, mode: kind, password: pw || undefined,
        opt: { charts: true, compare: true, patterns: true, bands: true, hypos: true, labs: true, notes: true, daily: true, readingLog: logs, insulinLog: logs } });
      const where = await api.savePdf(`diabass6-${kind === "summary" ? "summary" : "report"}-${from}_to_${to}.pdf`, bytes);
      if (where) { say("Saved " + where); if (remember) set({ lastAppointment: appt }); }
    } catch (e) { say("Couldn't create the PDF: " + e); } finally { setBusy(""); }
  };
  const opt = (m: Mode, label: string, off?: boolean) => <label className="row" style={{ opacity: off ? 0.5 : 1 }}><input type="radio" name="period" checked={mode === m} disabled={off} onChange={() => setMode(m)} />{label}</label>;

  return (<>
    <section className="panel">
      <h2>Prepare for an appointment</h2>
      <div className="row" style={{ marginBottom: 14 }}>
        <label className="field">Appointment date<input type="date" value={appt} onChange={(e) => e.target.value && setAppt(e.target.value)} /></label>
        <span className="note" style={{ alignSelf: "end" }}>Covers {from} to {to} ({days} days): {counts.n} readings{counts.d ? `, ${counts.d} insulin doses` : ""}.</span>
      </div>
      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {opt("lab", lastLab ? `Since my last lab result (${lastLab})` : "Since my last lab result (none logged)", !lastLab)}
        {opt("appt", s.lastAppointment ? `Since my last appointment (${s.lastAppointment})` : "Since my last appointment (none saved yet)", !s.lastAppointment)}
        {opt("30", "The last 30 days")}{opt("90", "The last 90 days")}
        <span className="row">{opt("custom", "From")}<input type="date" value={cFrom} max={to} onChange={(e) => { setCFrom(e.target.value); setMode("custom"); }} /></span>
      </div>
      <label className="field" style={{ marginBottom: 12 }}>Notes for your clinician (printed on the report)
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", font: "inherit", resize: "vertical" }} /></label>
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field">Password for the PDF (optional)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <label className="row"><input type="checkbox" checked={logs} onChange={(e) => setLogs(e.target.checked)} />Include full readings and insulin logs in the full report</label>
        <label className="row"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this as my last appointment</label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!!busy || !counts.n} onClick={() => build("summary")}>{busy === "summary" ? "Creating…" : "One-page summary (PDF)"}</button>
        <button className="btn" disabled={!!busy || !counts.n} onClick={() => build("full")}>{busy === "full" ? "Creating…" : "Full report (PDF)"}</button>
      </div>
      <p className="note">The one-page summary has the key numbers, your 24-hour profile and the main observations, and is quick to read in a consultation. The full report adds charts, tables and the day-by-day detail. A PDF password keeps casual readers out of a file you email, but it is not strong encryption. Send the password by a different route from the file.</p>
    </section>
  </>);
}
