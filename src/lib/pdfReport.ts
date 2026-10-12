// Builds the clinician report as a real PDF (selectable text, vector charts) without needing a print dialog.
import { jsPDF } from "jspdf";
import autoTable, { CellHookData } from "jspdf-autotable";
import { DayNote, HypoEvent, InsulinDose, KetoneReading, LabA1c, MMOL, Reading, Settings, fmt, ifccOf, unitLabel } from "./types";
import { ketoneBand } from "./ketone";
import { agpPoints, calcStats, hourOf, quantile } from "./stats";
import { findPatterns } from "./patterns";
import { meterEstimate } from "./labs";
import { compareRows } from "./compare";

export interface ReportOptions { charts: boolean; compare: boolean; patterns: boolean; bands: boolean; hypos: boolean; labs: boolean; notes: boolean; daily: boolean; readingLog: boolean; insulinLog: boolean; }
export interface PdfInput { readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; labs: LabA1c[]; notes: DayNote[]; ketones?: KetoneReading[]; s: Settings; from: string; to: string; clinicianNote: string; opt: ReportOptions; mode?: "full" | "summary"; password?: string; }

type RGB = [number, number, number];
const INK: RGB = [20, 22, 29], MUTED: RGB = [91, 96, 112], LINE: RGB = [207, 210, 220], OK: RGB = [11, 143, 107], LOW: RGB = [184, 106, 0], HIGH: RGB = [192, 38, 61], ACC: RGB = [59, 75, 214], INS: RGB = [27, 111, 179];
const PW = 210, PH = 297, M = 14, CW = PW - 2 * M;

/** The built-in PDF fonts only cover Latin-1, so swap anything outside it. */
const clean = (t: string) => t.replace(/[\u2212\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x09\x0a\x20-\xff]/g, "?");
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const longDate = (k: string) => new Date(k + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const num = (n: number) => String(Math.round(n * 10) / 10);
const tone = (v: number, lo: number, hi: number): RGB => (v < lo ? LOW : v > hi ? HIGH : OK);
const BANDS: [string, number, number][] = [["Overnight 00:00-06:00", 0, 6], ["Morning 06:00-11:00", 6, 11], ["Midday 11:00-15:00", 11, 15], ["Afternoon 15:00-19:00", 15, 19], ["Evening 19:00-24:00", 19, 24]];

/** The summary is one page by design: if a first attempt spills over, it is rebuilt more tightly (smaller chart, fewer observations,
 *  a shorter note) instead of being cut off. `level` is how many times it had to tighten. */
export function buildReportPdfInfo(inp: PdfInput): { bytes: Uint8Array; pages: number; level: number } {
  if (inp.mode !== "summary") { const r = buildOnce(inp, 0); return { ...r, level: 0 }; }
  let last = buildOnce(inp, 0);
  for (let level = 0; level <= 3; level++) { last = buildOnce(inp, level); if (last.pages === 1) return { ...last, level }; }
  return { ...last, level: 3 };
}
export function buildReportPdf(inp: PdfInput): Uint8Array { return buildReportPdfInfo(inp).bytes; }

function buildOnce(inp: PdfInput, level: number): { bytes: Uint8Array; pages: number } {
  const { readings, insulin, hypos, labs, notes, s, from, to, clinicianNote, opt: fullOpt, mode, password } = inp;
  const ketones = inp.ketones ?? [];
  const summary = mode === "summary";   // one compact page: key numbers, the 24-hour profile and a few lines of text
  const opt = summary ? { charts: true, compare: true, patterns: true, bands: false, hypos: true, labs: true, notes: false, daily: false, readingLog: false, insulinLog: false } : fullOpt;
  const u = unitLabel(s.unit), inR = (ts: string) => ts.slice(0, 10) >= from && ts.slice(0, 10) <= to;
  const rs = readings.filter((r) => inR(r.ts)), ds = insulin.filter((d) => inR(d.ts)), hy = hypos.filter((h) => inR(h.ts)), notesIn = notes.filter((n) => inR(n.ts));
  const bg = rs.filter((r) => r.flag !== "control"), nCtl = rs.length - bg.length, st = calcStats(rs, s.low, s.high);
  const spanDays = Math.max(1, Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 864e5) + 1);
  const today = iso(new Date());

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, ...(password ? { encryption: { userPassword: password, ownerPassword: password + "\u00b7owner", userPermissions: ["print", "copy"] as ("print" | "copy")[] } } : {}) });
  doc.setProperties({ title: `Glucose and insulin report ${from} to ${to}`, subject: "Glucose meter report", creator: "DIABASS 6" });
  let y = M;
  const col = (c: RGB, kind: "text" | "fill" | "draw" = "text") => (kind === "text" ? doc.setTextColor(...c) : kind === "fill" ? doc.setFillColor(...c) : doc.setDrawColor(...c));
  const font = (size: number, bold = false, c: RGB = INK) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); col(c); };
  const ensure = (h: number) => { if (y + h > PH - 16) { doc.addPage(); y = M; } };
  const h2 = (t: string) => { ensure(18); y += 4; font(11, true); doc.text(clean(t), M, y); col(INK, "draw"); doc.setLineWidth(0.4); doc.line(M, y + 1.6, PW - M, y + 1.6); y += 6; };
  const h3 = (t: string) => { ensure(10); y += 2.5; font(9.5, true); doc.text(clean(t), M, y); y += 4.2; };   // compact heading for the one-page summary
  const hh = (t: string) => (summary ? h3(t) : h2(t));
  const para = (t: string, size = 8.5, c: RGB = MUTED) => { font(size, false, c); const lines = doc.splitTextToSize(clean(t), CW) as string[]; ensure(lines.length * (size * 0.43) + 2); doc.text(lines, M, y + 3); y += lines.length * (size * 0.43) + 3; };
  const table = (head: string[], body: (string | { content: string; color?: RGB; bold?: boolean })[][], right: number[] = []) => {
    if (!body.length) return;
    ensure(24);
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, bottom: 16 }, head: [head], theme: "grid",
      body: body.map((r) => r.map((c) => (typeof c === "string" ? clean(c) : { content: clean(c.content), styles: { ...(c.color ? { textColor: c.color } : {}), ...(c.bold ? { fontStyle: "bold" as const } : {}) } }))),
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.3, lineColor: [226, 229, 237], lineWidth: 0.1, textColor: INK },
      headStyles: { fillColor: [241, 242, 246], textColor: [40, 44, 60], fontStyle: "bold" },
      columnStyles: Object.fromEntries(right.map((i) => [i, { halign: "right" as const }])),
      didParseCell: (d: CellHookData) => { if (d.section === "head" && right.includes(d.column.index)) d.cell.styles.halign = "right"; },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  };

  /* ---------- header ---------- */
  font(20, true); doc.text("Glucose & insulin report", M, y + 6); y += 11;
  font(10, false, MUTED); doc.text(clean(`${s.patient?.trim() ? s.patient.trim() + "  |  " : ""}${longDate(from)} to ${longDate(to)}`), M, y); y += 7;
  const meta: [string, string][] = [["Period", `${spanDays} days`], ["Meter", "Glucose Rx HCT"], ["Units", u], ["Target range", `${fmt(s.low, s.unit)}-${fmt(s.high, s.unit)} ${u}`], ["Prepared", longDate(today)]];
  meta.forEach(([k, v], i) => { const x = M + i * (CW / 5); font(7.5, false, MUTED); doc.text(k, x, y); font(9.5, true); doc.text(clean(v), x, y + 4.2); }); y += 9;
  if (clinicianNote.trim()) { hh("Notes"); font(9); let l = doc.splitTextToSize(clean(clinicianNote.trim()), CW - 6) as string[];
    const maxLines = summary ? [8, 5, 4, 3][level] : 999;
    if (l.length > maxLines) l = [...l.slice(0, maxLines - 1), l[maxLines - 1].slice(0, 70) + "... (shortened here; the full report has all of it)"]; ensure(l.length * 4 + 6); col(LINE, "draw"); doc.setLineWidth(0.2); doc.roundedRect(M, y, CW, l.length * 4 + 4, 1.5, 1.5); doc.text(l, M + 3, y + 5); y += l.length * 4 + 7; }
  if (!rs.length && !ds.length) { y += 6; para("No readings or insulin doses between these dates."); }

  /* ---------- glucose summary ---------- */
  if (st) {
    h2("Glucose summary");
    const ifcc = (st.a1c - 2.15) * 10.929;
    const lows = bg.filter((r) => r.mgdl < s.low).length, severe = bg.filter((r) => r.mgdl < 54).length, veryHigh = bg.filter((r) => r.mgdl > 250).length;
    const items: [string, string, string][] = [
      ["Readings", String(st.n), `${st.perDay.toFixed(1)} per day`], ["Average", fmt(st.mean, s.unit), u], ["Standard deviation", fmt(st.sd, s.unit), `CV ${st.cv.toFixed(0)}%`], ["Estimated A1c", `${st.a1c.toFixed(1)}%`, `${Math.round(ifcc)} mmol/mol`],
      ["Lowest", fmt(st.min, s.unit), u], ["Highest", fmt(st.max, s.unit), u], [`Below ${fmt(s.low, s.unit)}`, String(lows), `${severe} below ${fmt(54, s.unit)}`], [`Above ${fmt(250, s.unit)}`, String(veryHigh), "readings"],
    ];
    const bw = (CW - 9) / 4;
    ensure(summary ? 20 : 34);
    (summary ? items.slice(0, 4) : items).forEach(([k, v, sub], i) => { const x = M + (i % 4) * (bw + 3), yy = y + Math.floor(i / 4) * 15.5; col(LINE, "draw"); doc.setLineWidth(0.2); doc.roundedRect(x, yy, bw, 13.5, 1.2, 1.2); font(7, false, MUTED); doc.text(clean(k), x + 2, yy + 3.8); font(13, true); const wv = doc.getTextWidth(clean(v)); doc.text(clean(v), x + 2, yy + 9.6); font(7, false, MUTED); doc.text(clean(sub), x + 2 + wv + 1.5, yy + 9.6); });
    y += summary ? 17 : 33;
    if (summary) para(`Lowest ${fmt(st.min, s.unit)}, highest ${fmt(st.max, s.unit)} ${u}. Readings below ${fmt(s.low, s.unit)}: ${lows} (${severe} below ${fmt(54, s.unit)}). Above ${fmt(250, s.unit)}: ${veryHigh}.`, 9, INK);
    // time in range bar
    const seg: [number, RGB][] = [[st.low, LOW], [st.inr, OK], [st.high, HIGH]]; let x = M;
    seg.forEach(([p, c]) => { const w = Math.max(0.6, (p / 100) * CW); col(c, "fill"); doc.roundedRect(x, y, w, 3.4, 0.8, 0.8, "F"); x += w + 0.4; });
    y += 7.5; font(8.5, false, MUTED);
    [[`${st.low.toFixed(0)}% below range`, LOW], [`${st.inr.toFixed(0)}% in range`, OK], [`${st.high.toFixed(0)}% above range`, HIGH]].forEach(([t, c], i) => { const xx = M + i * 52; col(c as RGB, "fill"); doc.circle(xx + 1.2, y - 1, 1, "F"); font(8.5, true); doc.text(String(t), xx + 4, y); });
    y += 6;
    const hv = bg.filter((r) => r.hct).map((r) => r.hct!);
    if (hv.length) para(`Haematocrit recorded by the meter alongside glucose: average ${Math.round(hv.reduce((a, b) => a + b, 0) / hv.length)}%, range ${Math.min(...hv)}-${Math.max(...hv)}% (${hv.length} readings).`, 9, INK);
  }

  /* ---------- charts ---------- */
  const chart = (title: string, h: number, draw: (b: { x0: number; x1: number; top: number; bottom: number; Y: (v: number) => number }) => void, ymax: number, lane = 0, xticks: [number, string][]) => {
    ensure(h + (summary ? 10 : 16)); hh(title);
    const x0 = M + 10, x1 = PW - M - 1, top = y + 1, bottom = y + h - 6 - lane;
    const Y = (v: number) => top + (1 - v / ymax) * (bottom - top);
    col([226, 243, 238], "fill"); doc.rect(x0, Y(s.high), x1 - x0, Y(s.low) - Y(s.high), "F");
    doc.setLineWidth(0.1); col([228, 230, 236], "draw"); font(7, false, MUTED);
    for (let t = 0; t <= ymax; t += 70) { doc.line(x0, Y(t), x1, Y(t)); doc.text(s.unit === "mgdl" ? String(t) : String(Math.round(t / MMOL)), x0 - 1.5, Y(t) + 1, { align: "right" }); }
    col(OK, "draw"); doc.setLineWidth(0.2); doc.line(x0, Y(s.low), x1, Y(s.low)); doc.line(x0, Y(s.high), x1, Y(s.high));
    xticks.forEach(([f, label]) => { font(7, false, MUTED); doc.text(label, x0 + f * (x1 - x0), y + h - 1.5 - 0, { align: "center" }); });
    draw({ x0, x1, top, bottom, Y });
    if (lane) { col(LINE, "draw"); doc.line(x0, bottom, x1, bottom); }
    y += h + 2;
  };
  if (st && opt.charts) {
    const ymax = Math.max(250, Math.ceil(Math.max(...bg.map((r) => r.mgdl)) / 70) * 70);
    const t0 = new Date(bg[0].ts).getTime(), t1 = Math.max(new Date(bg[bg.length - 1].ts).getTime(), t0 + 3600e3);
    const dsIn = ds.filter((d) => { const t = new Date(d.ts).getTime(); return t >= t0 && t <= t1; }), LANE = dsIn.length ? 9 : 0;
    if (!summary) chart("Glucose over time", 62 + LANE, ({ x0, x1, bottom, Y }) => {
      const X = (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
      if (dsIn.length) { const mx = Math.max(10, ...dsIn.map((d) => d.units)); col(INS, "fill"); dsIn.forEach((d) => { const hh = Math.max(0.8, (d.units / mx) * (LANE - 2)); doc.rect(X(new Date(d.ts).getTime()) - 0.25, bottom + LANE - hh, 0.5, hh, "F"); }); font(6.5, false, INS); doc.text("Insulin doses (bar height = units)", x1, bottom + 2.6, { align: "right" }); }
      col(ACC, "draw"); doc.setLineWidth(0.1); for (let i = 1; i < bg.length; i++) doc.line(X(new Date(bg[i - 1].ts).getTime()), Y(bg[i - 1].mgdl), X(new Date(bg[i].ts).getTime()), Y(bg[i].mgdl));
      bg.forEach((r) => { col(tone(r.mgdl, s.low, s.high), "fill"); doc.circle(X(new Date(r.ts).getTime()), Y(r.mgdl), 0.7, "F"); });
    }, ymax, LANE, Array.from({ length: 6 }, (_, i) => [i / 5, new Date(t0 + ((t1 - t0) * i) / 5).toLocaleDateString("en-GB", { day: "numeric", month: "short" })] as [number, string]));

    const agp = agpPoints(rs), hours: [number, string][] = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => [h / 24, `${String(h % 24).padStart(2, "0")}:00`]);
    if (agp.length >= 6) {
      const ymaxA = Math.max(250, Math.ceil(Math.max(...agp.map((p) => p.p95)) / 70) * 70);
      chart("24-hour glucose profile (AGP style)", summary ? [46, 42, 38, 34][level] : 62, ({ x0, x1, Y }) => {
        const X = (h: number) => x0 + (h / 24) * (x1 - x0);
        const band = (hi: "p95" | "p75", lo: "p5" | "p25", c: RGB) => { const top = agp.map((p) => [X(p.h), Y(p[hi])]), bot = [...agp].reverse().map((p) => [X(p.h), Y(p[lo])]), all = [...top, ...bot]; col(c, "fill"); doc.lines(all.slice(1).map((p, i) => [p[0] - all[i][0], p[1] - all[i][1]]), all[0][0], all[0][1], [1, 1], "F", true); };
        band("p95", "p5", [226, 228, 248]); band("p75", "p25", [190, 196, 242]);
        col(ACC, "draw"); doc.setLineWidth(0.8); for (let i = 1; i < agp.length; i++) doc.line(X(agp[i - 1].h), Y(agp[i - 1].p50), X(agp[i].h), Y(agp[i].p50));
        font(7, false, MUTED); doc.text("Line = median | dark band = 25th-75th percentile | light band = 5th-95th percentile", x1, Y(ymaxA) + 3, { align: "right" });
      }, ymaxA, 0, hours);
    } else {
      chart("Typical day (median line, middle half shaded)", summary ? [46, 42, 38, 34][level] : 62, ({ x0, x1, Y }) => {
        const X = (h: number) => x0 + (h / 24) * (x1 - x0);
        bg.forEach((r) => { col(tone(r.mgdl, s.low, s.high), "fill"); doc.circle(X(hourOf(r)), Y(r.mgdl), 0.55, "F"); });
        const pts = Array.from({ length: 24 }, (_, h) => bg.filter((r) => Math.floor(hourOf(r)) === h).map((r) => r.mgdl)).map((b, h) => (b.length >= 2 ? { h: h + 0.5, m: quantile(b, 0.5) } : null)).filter(Boolean) as { h: number; m: number }[];
        col(ACC, "draw"); doc.setLineWidth(0.7); for (let i = 1; i < pts.length; i++) doc.line(X(pts[i - 1].h), Y(pts[i - 1].m), X(pts[i].h), Y(pts[i].m));
      }, ymax, 0, hours);
    }
  }

  /* ---------- comparison, observations, time of day ---------- */
  if (st && opt.compare) {
    const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() - spanDays); const prevFrom = iso(d); const e = new Date(from + "T00:00:00"); e.setDate(e.getDate() - 1); const prevTo = iso(e);
    const prev = calcStats(readings.filter((r) => r.ts.slice(0, 10) >= prevFrom && r.ts.slice(0, 10) <= prevTo), s.low, s.high);
    hh(`Compared with the previous ${spanDays} days (${longDate(prevFrom)} to ${longDate(prevTo)})`);
    if (!prev) para("No readings in the previous period to compare with."); else if (summary) { const rows = compareRows(st, prev, s), pick = (k: string) => rows.find((r) => r.k === k)!; para(`Average ${pick("Average").cur} ${u} (was ${pick("Average").prev}); time in range ${pick("Time in range").cur} (was ${pick("Time in range").prev}); below range ${pick("Below range").cur} (was ${pick("Below range").prev}); variability ${pick("Variability (CV)").cur} (was ${pick("Variability (CV)").prev}).`, 9, INK); } else table(["Measure", "This period", "Previous period", "Change"], compareRows(st, prev, s).map((r) => [r.k, { content: r.cur, bold: true }, r.prev, { content: r.change, bold: true, color: r.tone === "ok" ? OK : r.tone === "bad" ? HIGH : MUTED }]), [1, 2, 3]);
  }
  if (st && opt.patterns) {
    const pats = findPatterns(rs, ds, s).slice(0, summary ? [3, 2, 1, 1][level] : 6);
    if (pats.length) { hh("Observations from the data"); pats.forEach((p) => { font(9, true); const t1 = doc.splitTextToSize(clean(p.title + "."), CW) as string[]; ensure(t1.length * 4 + 8); doc.text(t1, M, y + 3); y += t1.length * 3.9 + 0.5; para(p.detail, 8.5); }); if (!summary) para("Generated automatically from the readings; descriptive only, not medical advice.", 7.5); }
  }
  if (st && opt.bands) {
    h2("By time of day");
    table(["Period", "Readings", "Average", "Lowest", "Highest", "In range"], BANDS.map(([label, a, b]) => {
      const v = bg.filter((r) => { const h = hourOf(r); return h >= a && h < b; }).map((r) => r.mgdl);
      return v.length ? [label, String(v.length), fmt(v.reduce((x, z) => x + z, 0) / v.length, s.unit), fmt(Math.min(...v), s.unit), fmt(Math.max(...v), s.unit), `${Math.round((v.filter((z) => z >= s.low && z <= s.high).length / v.length) * 100)}%`] : [label, "0", "-", "-", "-", "-"];
    }), [1, 2, 3, 4, 5]);
  }

  /* ---------- insulin, events, labs, notes ---------- */
  if (ds.length) {
    const tot = ds.reduce((a, d) => a + d.units, 0), days = new Set(ds.map((d) => d.ts.slice(0, 10))).size || 1;
    hh("Insulin summary");
    para(`Average daily total ${num(tot / days)} units  |  ${(ds.length / days).toFixed(1)} doses per day (${ds.length} doses)  |  ${num(tot)} units in the period  |  ${days} of ${spanDays} days with doses`, 9, INK);
    const by = new Map<string, { units: number; n: number }>(); ds.forEach((d) => { const k = d.kind?.trim() || "Unspecified", e = by.get(k) ?? { units: 0, n: 0 }; e.units += d.units; e.n++; by.set(k, e); });
    if (!summary) table(["Type", "Doses", "Total units", "Average per dose"], [...by.entries()].sort((a, b) => b[1].units - a[1].units).map(([k, e]) => [k, String(e.n), num(e.units), num(e.units / e.n)]), [1, 2, 3]);
  }
  if (opt.hypos && hy.length) {
    hh(`Low-glucose events (${hy.length})`);
    if (!summary) table(["Date & time", `Glucose (${u})`, "Symptoms", "Treatment", "Recovery", "Help needed"], [...hy].reverse().map((h) => [h.ts.slice(0, 16).replace("T", "  "), { content: h.mgdl ? fmt(h.mgdl, s.unit) : "-", color: LOW, bold: true }, h.symptoms.join(", ") || "-", h.treatment || "-", h.recoveryMgdl ? `${fmt(h.recoveryMgdl, s.unit)}${h.recoveryMins ? ` after ${h.recoveryMins} min` : ""}` : "-", h.assisted ? "Yes" : "No"]), [1]);
    para(`${hy.filter((h) => h.assisted).length} of ${hy.length} events needed help from another person.`, 8);
  }
  if (opt.labs) {
    const d = new Date(to + "T00:00:00"); d.setFullYear(d.getFullYear() - 1); const y0 = iso(d), li = labs.filter((l) => l.date >= y0 && l.date <= to);
    if (li.length && summary) { const l = li[li.length - 1], e = meterEstimate(readings, l.date); hh("Laboratory HbA1c"); para(`${l.date}: ${l.ngsp.toFixed(1)}% (${Math.round(ifccOf(l.ngsp))} mmol/mol)${e ? `; meter-based estimate ${e.a1c.toFixed(1)}%` : ""}.`, 9, INK); }
    else if (li.length) { h2("Laboratory HbA1c (last 12 months)"); table(["Date", "Lab result", "Meter estimate (90 days before)", "Note"], [...(summary ? li.slice(-1) : li)].reverse().map((l) => { const e = meterEstimate(readings, l.date); return [l.date, { content: `${l.ngsp.toFixed(1)}% (${Math.round(ifccOf(l.ngsp))} mmol/mol)`, bold: true }, e ? `${e.a1c.toFixed(1)}% (${e.n} readings)` : "not enough readings", l.note ?? ""]; }), [1, 2]); }
  }
  const ki = ketones.filter((k) => inR(k.ts));
  if (ki.length) {
    hh(`Ketones (${ki.length})`);
    para(`${ki.length} readings; highest ${Math.max(...ki.map((k) => k.mmol)).toFixed(1)} mmol/L; ${ki.filter((k) => k.mmol >= 0.6).length} at 0.6 mmol/L or above (commonly used guideline: below 0.6 normal).`, 9, INK);
    if (!summary) table(["Date & time", "mmol/L", "Band"], [...ki].reverse().slice(0, 60).map((k) => { const b = ketoneBand(k.mmol); return [k.ts.slice(0, 16).replace("T", "  "), { content: k.mmol.toFixed(1), bold: true, color: b.tone === "ok" ? OK : b.tone === "warn" ? LOW : HIGH }, b.label]; }), [1]);
  }
  if (opt.notes && notesIn.length) { h2(`Notes and tagged events (${notesIn.length})`); table(["Date & time", "Tags", "Note"], [...notesIn].reverse().map((n) => [n.ts.slice(0, 16).replace("T", "  "), n.tags.join(", "), n.text])); }

  /* ---------- day by day and full logs ---------- */
  if (opt.daily) {
    const m = new Map<string, { n: number; sum: number; min: number; max: number; units: number; doses: number }>();
    const get = (k: string) => { let e = m.get(k); if (!e) { e = { n: 0, sum: 0, min: Infinity, max: -Infinity, units: 0, doses: 0 }; m.set(k, e); } return e; };
    bg.forEach((r) => { const e = get(r.ts.slice(0, 10)); e.n++; e.sum += r.mgdl; e.min = Math.min(e.min, r.mgdl); e.max = Math.max(e.max, r.mgdl); });
    ds.forEach((d) => { const e = get(d.ts.slice(0, 10)); e.units += d.units; e.doses++; });
    const rows = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (rows.length) {
      h2("Day by day"); const withIns = ds.length > 0;
      table(["Date", "Tests", "Average", "Lowest", "Highest", ...(withIns ? ["Insulin (units)", "Doses"] : [])], rows.map(([k, e]) => [longDate(k), e.n ? String(e.n) : "-", e.n ? fmt(e.sum / e.n, s.unit) : "-", e.n ? fmt(e.min, s.unit) : "-", e.n ? fmt(e.max, s.unit) : "-", ...(withIns ? [e.doses ? num(e.units) : "-", e.doses ? String(e.doses) : "-"] : [])]), withIns ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4]);
    }
  }
  if (opt.readingLog && rs.length) { h2(`Glucose log (${rs.length} entries)`); table(["Date & time", `Result (${u})`, "Meal", "Type"], [...rs].reverse().map((r) => [r.ts.slice(0, 16).replace("T", "  "), { content: fmt(r.mgdl, s.unit), bold: true, color: r.flag === "control" ? MUTED : tone(r.mgdl, s.low, s.high) }, r.meal ?? "", r.flag === "control" ? "Control solution" : "Blood"]), [1]); }
  if (opt.insulinLog && ds.length) { h2(`Insulin log (${ds.length} doses)`); table(["Date & time", "Units", "Type", "Note"], [...ds].reverse().map((d) => [d.ts.slice(0, 16).replace("T", "  "), { content: String(d.units), bold: true }, d.kind ?? "", d.note ?? ""]), [1]); }

  ensure(summary ? 12 : 22); y += summary ? 1 : 4; col(LINE, "draw"); doc.setLineWidth(0.2); doc.line(M, y, PW - M, y); y += 1;
  if (summary) para(`Generated by DIABASS 6.${nCtl ? ` ${nCtl} control-solution test${nCtl === 1 ? " is" : "s are"} excluded.` : ""} Estimated A1c is calculated from average meter glucose and is not a laboratory result. Observations are automatic and descriptive, not medical advice.`, 7);
  else para(`Generated by DIABASS 6 from meter downloads and manually entered or imported insulin doses.${nCtl ? ` ${nCtl} control-solution test${nCtl === 1 ? " is" : "s are"} in this period and excluded from all statistics.` : ""} Estimated A1c is calculated from the average meter glucose (eAG formula) and is not a laboratory HbA1c result. Conversion used: 1 mmol/L = ${MMOL} mg/dL.`, 7.5);

  const pagesBefore = doc.getNumberOfPages();
  if (summary && level >= 3) { const n = doc.getNumberOfPages(); if (n > 1) for (let i = n; i > 1; i--) doc.deletePage(i); }   // last resort only
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); font(7.5, false, MUTED); doc.text(clean(`DIABASS 6  |  Glucose & insulin report  |  ${from} to ${to}`), M, PH - 8); doc.text(`Page ${i} of ${pages}`, PW - M, PH - 8, { align: "right" }); }
  return { bytes: new Uint8Array(doc.output("arraybuffer")), pages: pagesBefore };
}
