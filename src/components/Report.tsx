import { useMemo, useRef, useState } from "react";
import { DayNote, HypoEvent, InsulinDose, KetoneReading, LabA1c, MMOL, Reading, Settings, fmt, ifccOf, unitLabel } from "../lib/types";
import { ketoneBand } from "../lib/ketone";
import { agpPoints, calcStats, hourOf } from "../lib/stats";
import { meterEstimate } from "../lib/labs";
import { AgpChart, ProfileChart, TrendChart } from "./Charts";
import { CompareTable } from "./Compare";
import { findPatterns } from "../lib/patterns";
import { REPORT_CSS } from "./reportCss";
import { api } from "../lib/api";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const longDate = (k: string) => new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const BANDS: [string, number, number][] = [["Overnight 00:00–06:00", 0, 6], ["Morning 06:00–11:00", 6, 11], ["Midday 11:00–15:00", 11, 15], ["Afternoon 15:00–19:00", 15, 19], ["Evening 19:00–24:00", 19, 24]];
const num = (n: number) => String(Math.round(n * 10) / 10);

interface Props { readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; labs: LabA1c[]; notes: DayNote[]; ketones: KetoneReading[]; s: Settings; set: (p: Partial<Settings>) => void; say: (m: string) => void; }

export default function ReportView({ readings, insulin, hypos, labs, notes, ketones, s, set, say }: Props) {
  const today = iso(new Date());
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [note, setNote] = useState("");
  const [opt, setOpt] = useState({ charts: true, compare: true, patterns: true, bands: true, hypos: true, labs: true, notes: true, daily: true, readingLog: true, insulinLog: true });
  const paper = useRef<HTMLDivElement>(null);
  const u = unitLabel(s.unit);

  const preset = (d: number) => {
    setTo(today);
    if (d) return setFrom(iso(new Date(Date.now() - (d - 1) * 864e5)));
    const firsts = [readings[0]?.ts, insulin[0]?.ts].filter(Boolean).map((t) => t!.slice(0, 10)).sort();
    setFrom(firsts[0] ?? today);
  };
  const inR = (ts: string) => ts.slice(0, 10) >= from && ts.slice(0, 10) <= to;
  const rs = useMemo(() => readings.filter((r) => inR(r.ts)), [readings, from, to]); // eslint-disable-line
  const ds = useMemo(() => insulin.filter((d) => inR(d.ts)), [insulin, from, to]); // eslint-disable-line
  const bg = rs.filter((r) => r.flag !== "control");
  const nCtl = rs.length - bg.length;
  const st = calcStats(rs, s.low, s.high);
  const spanDays = Math.max(1, Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 864e5) + 1);

  const lows = bg.filter((r) => r.mgdl < s.low).length, severe = bg.filter((r) => r.mgdl < 54).length, veryHigh = bg.filter((r) => r.mgdl > 250).length;
  const ifcc = st ? (st.a1c - 2.15) * 10.929 : 0;
  const hy = useMemo(() => hypos.filter((h) => inR(h.ts)), [hypos, from, to]); // eslint-disable-line
  const notesIn = useMemo(() => notes.filter((n) => inR(n.ts)), [notes, from, to]); // eslint-disable-line
  const labsIn = useMemo(() => { const d = new Date(to + "T00:00:00"); d.setFullYear(d.getFullYear() - 1); const y = iso(d); return labs.filter((l) => l.date >= y && l.date <= to); }, [labs, to]);
  const ki = useMemo(() => ketones.filter((k) => inR(k.ts)), [ketones, from, to]); // eslint-disable-line
  const hv = bg.filter((r) => r.hct).map((r) => r.hct!);
  const agpOk = useMemo(() => agpPoints(rs).length >= 6, [rs]);
  const pats = useMemo(() => findPatterns(rs, ds, s), [rs, ds, s]);
  const prevFrom = useMemo(() => { const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() - spanDays); return iso(d); }, [from, spanDays]);
  const prevTo = useMemo(() => { const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() - 1); return iso(d); }, [from]);
  const prevSt = useMemo(() => calcStats(readings.filter((r) => r.ts.slice(0, 10) >= prevFrom && r.ts.slice(0, 10) <= prevTo), s.low, s.high), [readings, prevFrom, prevTo, s.low, s.high]);

  const bands = BANDS.map(([label, a, b]) => {
    const v = bg.filter((r) => { const h = hourOf(r); return h >= a && h < b; });
    const mean = v.length ? v.reduce((x, r) => x + r.mgdl, 0) / v.length : 0;
    return { label, n: v.length, mean, inr: v.length ? (v.filter((r) => r.mgdl >= s.low && r.mgdl <= s.high).length / v.length) * 100 : 0, min: v.length ? Math.min(...v.map((r) => r.mgdl)) : 0, max: v.length ? Math.max(...v.map((r) => r.mgdl)) : 0 };
  });

  const daily = useMemo(() => {
    const m = new Map<string, { n: number; sum: number; min: number; max: number; units: number; doses: number }>();
    const get = (k: string) => { let e = m.get(k); if (!e) { e = { n: 0, sum: 0, min: Infinity, max: -Infinity, units: 0, doses: 0 }; m.set(k, e); } return e; };
    for (const r of bg) { const e = get(r.ts.slice(0, 10)); e.n++; e.sum += r.mgdl; e.min = Math.min(e.min, r.mgdl); e.max = Math.max(e.max, r.mgdl); }
    for (const d of ds) { const e = get(d.ts.slice(0, 10)); e.units += d.units; e.doses++; }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [bg, ds]);

  const insTotal = ds.reduce((a, d) => a + d.units, 0);
  const insDays = new Set(ds.map((d) => d.ts.slice(0, 10))).size || 1;
  const byKind = useMemo(() => {
    const m = new Map<string, { units: number; n: number }>();
    for (const d of ds) { const k = d.kind?.trim() || "Unspecified"; const e = m.get(k) ?? { units: 0, n: 0 }; e.units += d.units; e.n++; m.set(k, e); }
    return [...m.entries()].sort((a, b) => b[1].units - a[1].units);
  }, [ds]);

  const exportHtml = async () => {
    if (!paper.current) return;
    const title = `Glucose report ${from} to ${to}`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;padding:24px;background:#e9eaf0}@media print{body{padding:0;background:#fff}}${REPORT_CSS}</style></head><body><div class="report">${paper.current.innerHTML}</div></body></html>`;
    say("Saved to " + (await api.exportFile(`diabass6-report-${from}_to_${to}.html`, html)) + ". Open it in any browser to print or save as PDF.");
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 30));   // let the button repaint before the (synchronous) PDF build
      const { buildReportPdf } = await import("../lib/pdfReport");
      const bytes = buildReportPdf({ readings, insulin, hypos, labs, notes, ketones, s, from, to, clinicianNote: note, opt });
      const where = await api.savePdf(`diabass6-report-${from}_to_${to}.pdf`, bytes);
      if (where) say("Saved " + where);
    } catch (e) { say("Couldn't create the PDF: " + e); } finally { setPdfBusy(false); }
  };
  const hasData = rs.length > 0 || ds.length > 0;
  const tick = (k: keyof typeof opt, label: string) => <label className="row"><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} />{label}</label>;

  return (<>
    <style>{REPORT_CSS}</style>
    <section className="panel no-print">
      <h2>Report for your GP or healthcare professional</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg">{[["14 d", 14], ["30 d", 30], ["90 d", 90], ["All", 0]].map(([l, d]) => <button key={l as string} onClick={() => preset(d as number)}>{l}</button>)}</div>
        <label className="field">From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <label className="field">Name on report (optional)<input value={s.patient ?? ""} onChange={(e) => set({ patient: e.target.value })} /></label>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>{tick("charts", "Charts")}{tick("compare", "Previous-period comparison")}{tick("patterns", "Observations")}{tick("bands", "Time-of-day table")}{tick("hypos", "Low-glucose events")}{tick("labs", "Lab HbA1c results")}{tick("notes", "Notes & tags")}{tick("daily", "Day-by-day summary")}{tick("readingLog", "Full glucose log")}{tick("insulinLog", "Full insulin log")}</div>
      <label className="field" style={{ marginBottom: 14 }}>Notes for your clinician (optional, printed on the report)
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", font: "inherit", resize: "vertical" }} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={!hasData || pdfBusy} onClick={exportPdf}>{pdfBusy ? "Creating PDF…" : "Save as PDF file"}</button>
        <button className="btn" disabled={!hasData} onClick={() => window.print()}>Print…</button>
        <button className="btn" disabled={!hasData} onClick={exportHtml}>Save as HTML file</button>
      </div>
      <p className="note">The PDF is created directly, with real text and charts, so it doesn't depend on a print dialog. The preview below is what Print… uses.</p>
    </section>

    <div className="report"><div ref={paper}>
      <h1>Glucose &amp; insulin report</h1>
      <div className="sub">{s.patient?.trim() ? s.patient.trim() + " · " : ""}{longDate(from)} to {longDate(to)}</div>
      <div className="meta">
        <div><b>Period</b>{spanDays} days</div>
        <div><b>Meter</b>Glucose Rx HCT</div>
        <div><b>Units</b>{u}</div>
        <div><b>Target range</b>{fmt(s.low, s.unit)}–{fmt(s.high, s.unit)} {u}</div>
        <div><b>Prepared</b>{longDate(today)}</div>
      </div>
      {note.trim() && <><h2>Notes</h2><div className="clin">{note.trim()}</div></>}

      {!hasData && <div className="empty">No readings or insulin doses between these dates.</div>}

      {st && <>
        <h2>Glucose summary</h2>
        <div className="kv">
          <div><b>Readings</b><span>{st.n}</span><small>{st.perDay.toFixed(1)} per day</small></div>
          <div><b>Average</b><span>{fmt(st.mean, s.unit)}</span><small>{u}</small></div>
          <div><b>Standard deviation</b><span>{fmt(st.sd, s.unit)}</span><small>CV {st.cv.toFixed(0)}%</small></div>
          <div><b>Estimated A1c</b><span>{st.a1c.toFixed(1)}%</span><small>{Math.round(ifcc)} mmol/mol</small></div>
          <div><b>Lowest</b><span>{fmt(st.min, s.unit)}</span><small>{u}</small></div>
          <div><b>Highest</b><span>{fmt(st.max, s.unit)}</span><small>{u}</small></div>
          <div><b>Below {fmt(s.low, s.unit)}</b><span>{lows}</span><small>{severe} below {fmt(54, s.unit)}</small></div>
          <div><b>Above {fmt(250, s.unit)}</b><span>{veryHigh}</span><small>readings</small></div>
        </div>
        <div className="block" style={{ marginTop: 10 }}>
          <div className="ribbon"><i style={{ flex: st.low, background: "var(--low)" }} /><i style={{ flex: st.inr, background: "var(--ok)" }} /><i style={{ flex: st.high, background: "var(--high)" }} /></div>
          <div className="legend">
            <span><span className="dot" style={{ background: "var(--low)" }} /><b>{st.low.toFixed(0)}%</b> below range</span>
            <span><span className="dot" style={{ background: "var(--ok)" }} /><b>{st.inr.toFixed(0)}%</b> in range</span>
            <span><span className="dot" style={{ background: "var(--high)" }} /><b>{st.high.toFixed(0)}%</b> above range</span>
          </div>
        </div>
      </>}

      {hv.length > 0 && <div className="note" style={{ marginTop: 8 }}>Haematocrit recorded by the meter alongside glucose: average {Math.round(hv.reduce((a, b) => a + b, 0) / hv.length)}%, range {Math.min(...hv)}–{Math.max(...hv)}% ({hv.length} readings).</div>}

      {st && opt.charts && <>
        <h2>Glucose over time</h2><div className="block"><TrendChart readings={rs} s={s} doses={ds} /></div>
        {agpOk ? <>
          <h2>24-hour glucose profile (AGP style)</h2><div className="block"><AgpChart readings={rs} s={s} /></div>
          <div className="note">Line = median; dark band = middle 50% of readings (25th–75th percentile); light band = 5th–95th percentile.</div>
        </> : <>
          <h2>Typical day (median line, middle half shaded)</h2><div className="block"><ProfileChart readings={rs} s={s} doses={ds} /></div>
        </>}
      </>}

      {st && opt.compare && <>
        <h2>Compared with the previous {spanDays} days ({longDate(prevFrom)} to {longDate(prevTo)})</h2>
        <div className="block"><CompareTable cur={st} prev={prevSt} s={s} curLabel="This period" prevLabel="Previous period" /></div>
      </>}

      {st && opt.patterns && pats.length > 0 && <>
        <h2>Observations from the data</h2>
        <div className="block">{pats.map((p) => <div key={p.title} style={{ marginBottom: 5 }}><b>{p.title}.</b> <span className="sub">{p.detail}</span></div>)}</div>
        <div className="note">Generated automatically from the readings; descriptive only, not medical advice.</div>
      </>}

      {st && opt.bands && <>
        <h2>By time of day</h2>
        <table><thead><tr><th>Period</th><th className="r">Readings</th><th className="r">Average</th><th className="r">Lowest</th><th className="r">Highest</th><th className="r">In range</th></tr></thead><tbody>
          {bands.map((b) => <tr key={b.label}><td>{b.label}</td><td className="r">{b.n}</td><td className="r">{b.n ? fmt(b.mean, s.unit) : "–"}</td><td className="r">{b.n ? fmt(b.min, s.unit) : "–"}</td><td className="r">{b.n ? fmt(b.max, s.unit) : "–"}</td><td className="r">{b.n ? b.inr.toFixed(0) + "%" : "–"}</td></tr>)}
        </tbody></table>
      </>}

      {ds.length > 0 && <>
        <h2>Insulin summary</h2>
        <div className="kv block">
          <div><b>Average daily total</b><span>{num(insTotal / insDays)}</span><small>units</small></div>
          <div><b>Doses per day</b><span>{(ds.length / insDays).toFixed(1)}</span><small>{ds.length} doses</small></div>
          <div><b>Total in period</b><span>{num(insTotal)}</span><small>units</small></div>
          <div><b>Days with doses</b><span>{insDays}</span><small>of {spanDays}</small></div>
        </div>
        <table style={{ marginTop: 8 }}><thead><tr><th>Type</th><th className="r">Doses</th><th className="r">Total units</th><th className="r">Average per dose</th></tr></thead><tbody>
          {byKind.map(([k, e]) => <tr key={k}><td>{k}</td><td className="r">{e.n}</td><td className="r">{num(e.units)}</td><td className="r">{num(e.units / e.n)}</td></tr>)}
        </tbody></table>
      </>}

      {opt.hypos && hy.length > 0 && <>
        <h2>Low-glucose events ({hy.length})</h2>
        <table><thead><tr><th>Date &amp; time</th><th className="r">Glucose ({u})</th><th>Symptoms</th><th>Treatment</th><th>Recovery</th><th>Help needed</th></tr></thead><tbody>
          {[...hy].reverse().map((h) => <tr key={h.id}><td>{h.ts.slice(0, 16).replace("T", "  ")}</td><td className="r" style={{ fontWeight: 600, color: "var(--low)" }}>{h.mgdl ? fmt(h.mgdl, s.unit) : "–"}</td><td>{h.symptoms.join(", ") || "–"}</td><td>{h.treatment || "–"}</td><td>{h.recoveryMgdl ? `${fmt(h.recoveryMgdl, s.unit)}${h.recoveryMins ? ` after ${h.recoveryMins} min` : ""}` : "–"}</td><td>{h.assisted ? "Yes" : "No"}</td></tr>)}
        </tbody></table>
        <div className="note">{hy.filter((h) => h.assisted).length} of {hy.length} events needed help from another person.</div>
      </>}

      {ki.length > 0 && <>
        <h2>Ketones ({ki.length})</h2>
        <div className="block">{ki.length} readings; highest {Math.max(...ki.map((k) => k.mmol)).toFixed(1)} mmol/L; {ki.filter((k) => k.mmol >= 0.6).length} at 0.6 mmol/L or above (commonly used guideline: below 0.6 is normal).</div>
        <table><thead><tr><th>Date &amp; time</th><th className="r">mmol/L</th><th>Band</th></tr></thead><tbody>
          {[...ki].reverse().slice(0, 40).map((k) => { const b = ketoneBand(k.mmol); return <tr key={k.id}><td>{k.ts.slice(0, 16).replace("T", "  ")}</td><td className="r" style={{ fontWeight: 600 }}>{k.mmol.toFixed(1)}</td><td>{b.label}</td></tr>; })}
        </tbody></table>
      </>}

      {opt.labs && labsIn.length > 0 && <>
        <h2>Laboratory HbA1c (last 12 months)</h2>
        <table><thead><tr><th>Date</th><th className="r">Lab result</th><th className="r">Meter estimate (90 days before)</th><th>Note</th></tr></thead><tbody>
          {[...labsIn].reverse().map((l) => { const e = meterEstimate(readings, l.date); return <tr key={l.id}><td>{l.date}</td><td className="r" style={{ fontWeight: 600 }}>{l.ngsp.toFixed(1)}% ({Math.round(ifccOf(l.ngsp))} mmol/mol)</td><td className="r">{e ? `${e.a1c.toFixed(1)}% (${e.n} readings)` : "not enough readings"}</td><td>{l.note ?? ""}</td></tr>; })}
        </tbody></table>
      </>}

      {opt.notes && notesIn.length > 0 && <>
        <h2>Notes and tagged events ({notesIn.length})</h2>
        <table><thead><tr><th>Date &amp; time</th><th>Tags</th><th>Note</th></tr></thead><tbody>
          {[...notesIn].reverse().map((n) => <tr key={n.id}><td>{n.ts.slice(0, 16).replace("T", "  ")}</td><td>{n.tags.join(", ")}</td><td>{n.text}</td></tr>)}
        </tbody></table>
      </>}

      {opt.daily && daily.length > 0 && <>
        <h2>Day by day</h2>
        <table><thead><tr><th>Date</th><th className="r">Tests</th><th className="r">Average</th><th className="r">Lowest</th><th className="r">Highest</th>{ds.length > 0 && <><th className="r">Insulin (units)</th><th className="r">Doses</th></>}</tr></thead><tbody>
          {daily.map(([k, e]) => <tr key={k}><td>{longDate(k)}</td><td className="r">{e.n || "–"}</td><td className="r">{e.n ? fmt(e.sum / e.n, s.unit) : "–"}</td><td className="r">{e.n ? fmt(e.min, s.unit) : "–"}</td><td className="r">{e.n ? fmt(e.max, s.unit) : "–"}</td>{ds.length > 0 && <><td className="r">{e.doses ? num(e.units) : "–"}</td><td className="r">{e.doses || "–"}</td></>}</tr>)}
        </tbody></table>
      </>}

      {opt.readingLog && rs.length > 0 && <>
        <h2>Glucose log ({rs.length} entries)</h2>
        <table><thead><tr><th>Date &amp; time</th><th className="r">Result ({u})</th><th>Meal</th><th>Type</th></tr></thead><tbody>
          {[...rs].reverse().map((r) => <tr key={r.id}><td>{r.ts.slice(0, 16).replace("T", "  ")}</td><td className="r" style={{ fontWeight: 600, color: r.flag === "control" ? "var(--muted)" : r.mgdl < s.low ? "var(--low)" : r.mgdl > s.high ? "var(--high)" : "var(--ok)" }}>{fmt(r.mgdl, s.unit)}</td><td>{r.meal || ""}</td><td>{r.flag === "control" ? "Control solution" : "Blood"}</td></tr>)}
        </tbody></table>
      </>}

      {opt.insulinLog && ds.length > 0 && <>
        <h2>Insulin log ({ds.length} doses)</h2>
        <table><thead><tr><th>Date &amp; time</th><th className="r">Units</th><th>Type</th><th>Note</th></tr></thead><tbody>
          {[...ds].reverse().map((d) => <tr key={d.id}><td>{d.ts.slice(0, 16).replace("T", "  ")}</td><td className="r" style={{ fontWeight: 600 }}>{d.units}</td><td>{d.kind ?? ""}</td><td>{d.note ?? ""}</td></tr>)}
        </tbody></table>
      </>}

      <div className="foot">
        Generated by DIABASS 6 from meter downloads and manually entered or imported insulin doses.
        {nCtl > 0 && ` ${nCtl} control-solution test${nCtl === 1 ? "" : "s"} in this period ${nCtl === 1 ? "is" : "are"} excluded from all statistics.`}{" "}
        Estimated A1c is calculated from the average meter glucose (eAG formula) and is not a laboratory HbA1c result.
        Conversion used: 1 mmol/L = {MMOL} mg/dL.
      </div>
    </div></div>
  </>);
}
