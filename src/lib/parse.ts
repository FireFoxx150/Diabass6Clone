import { DayNote, InsulinDose, LabA1c, MMOL, Reading, Settings, Supply } from "./types";
import { localIso } from "./stats";

const pad = (n: number) => String(n).padStart(2, "0");
let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Tolerant line parser: finds a date, a time and a glucose number in each line of meter output. */
export function parseMeterText(text: string, dateOrder: Settings["dateOrder"]): Reading[] {
  const out: Reading[] = [];
  for (const raw of text.split(/\r?\n|\r/)) {
    let line = raw.replace(/[^\x20-\x7e]/g, " ").trim();
    if (!line) continue;

    let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, haveDate = false, haveTime = false;

    let m = line.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; haveDate = true; line = line.replace(m[0], " "); }
    else if ((m = line.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
      const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (dateOrder === "dmy") { d = a; mo = b; } else { mo = a; d = b; }
      if (mo > 12 && d <= 12) [mo, d] = [d, mo];
      haveDate = true; line = line.replace(m[0], " ");
    }
    m = line.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (m) {
      h = +m[1]; mi = +m[2]; s = m[3] ? +m[3] : 0;
      if (m[4]) { const pm = m[4].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      haveTime = true; line = line.replace(m[0], " ");
    }
    if (!haveDate || !haveTime || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) continue;

    const isControl = /ctrl|control|\bCS\b|\bQC\b/i.test(raw);
    const nums = [...line.matchAll(/\d+(?:\.\d+)?/g)].map((x) => x[0]);
    let mg: number | null = null;
    for (const n of nums) {
      const v = parseFloat(n);
      if (n.includes(".") && v >= 1 && v <= 50) { mg = v * MMOL; break; }       // mmol/L
      if (!n.includes(".") && v >= 10 && v <= 900) { mg = v; break; }            // mg/dL
    }
    if (mg == null) continue;
    const hct = raw.match(/hct\s*(\d{1,3})\s*%/i);
    const meal = /before.?meal|pre.?meal/i.test(raw) ? "before" : /after.?meal|post.?meal/i.test(raw) ? "after" : undefined;
    out.push({
      id: newId(),
      ts: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`,
      mgdl: Math.round(mg * 10) / 10,
      flag: isControl ? "control" : "none",
      ...(meal ? { meal } : {}),
      ...(hct ? { hct: +hct[1] } : {}),
    });
  }
  return out;
}

/** Merge new readings into existing ones, skipping duplicates (same minute + value). */
export function mergeReadings(existing: Reading[], incoming: Reading[]) {
  const key = (r: Reading) => `${r.ts.slice(0, 16)}|${Math.round(r.mgdl)}`;
  const seen = new Set(existing.map(key));
  const added: Reading[] = [];
  for (const r of incoming) { const k = key(r); if (!seen.has(k)) { seen.add(k); added.push(r); } }
  const all = [...existing, ...added].sort((a, b) => a.ts.localeCompare(b.ts));
  return { all, added: added.length, dupes: incoming.length - added.length };
}

export function toCsv(rs: Reading[]) {
  const rows = rs.map((r) => [r.ts.replace("T", " "), Math.round(r.mgdl), (r.mgdl / MMOL).toFixed(1), r.flag, r.meal ?? "", (r.note ?? "").replace(/[",\n]/g, " ")].join(","));
  return ["timestamp,mg_dl,mmol_l,flag,meal,note", ...rows].join("\n");
}

/* ---------------- Insulin CSV ---------------- */
export function splitCsvLine(line: string, d: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Finds a date (and optional time) anywhere in a string. Date-only values get 00:00. */
export function findDateTime(str: string, order: Settings["dateOrder"]): { ts: string; rest: string } | null {
  let rest = str, y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  let m = rest.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; rest = rest.replace(m[0], " "); }
  else if ((m = rest.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) {
    const a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (order === "dmy") { d = a; mo = b; } else { mo = a; d = b; }
    if (mo > 12 && d <= 12) [mo, d] = [d, mo];
    rest = rest.replace(m[0], " ");
  } else return null;
  const t = rest.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (t) {
    h = +t[1]; mi = +t[2]; s = t[3] ? +t[3] : 0;
    if (t[4]) { const pm = t[4].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    rest = rest.replace(t[0], " ");
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || new Date(y, mo - 1, d).getMonth() !== mo - 1) return null;
  return { ts: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`, rest };
}

const unitsFrom = (txt: string): number | null => {
  const m = txt.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return v > 0 && v <= 500 ? Math.round(v * 100) / 100 : null;
};

export interface InsulinParse { doses: InsulinDose[]; skipped: string[]; rows: number; assumptions: string[]; primes: InsulinDose[]; }

/** Parses an insulin-dose CSV. Works with or without a header row; comma, semicolon or tab separated.
 *  A column simply called "Value" (as in insulin-pen exports) is ambiguous, so it is read with stated assumptions:
 *  values above 100 that are all multiples of 5 are tenths of a unit, and small records shortly before a larger dose
 *  are priming ("air") shots, which are not insulin taken and are returned separately in `primes`. */
export function parseInsulinCsv(text: string, order: Settings["dateOrder"]): InsulinParse {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const doses: InsulinDose[] = []; const skipped: string[] = []; const assumptions: string[] = []; let primes: InsulinDose[] = [];
  if (!lines.length) return { doses, skipped: ["The file is empty."], rows: 0, assumptions, primes };

  const seps = [",", ";", "\t"];
  const counts = seps.map((d) => lines[0].split(d).length);
  const delim = seps[counts.indexOf(Math.max(...counts))];
  const first = splitCsvLine(lines[0], delim);
  const hasHeader = first.some((c) => /date|time|unit|dose|insulin|stamp|amount|type/i.test(c)) && !first.some((c) => findDateTime(c, order));

  let dtCols: number[] = [], iU = -1, iK = -1, iN = -1, iS = -1, ambiguous = false;
  if (hasHeader) {
    const H = first.map((c) => c.toLowerCase());
    dtCols = H.map((c, i) => (/date|time|stamp|when/.test(c) ? i : -1)).filter((i) => i >= 0);
    iU = H.findIndex((c, i) => /unit|dose|amount|^u$|^iu$|qty|quantity/.test(c) && !dtCols.includes(i));
    if (iU < 0) iU = H.findIndex((c, i) => /insulin/.test(c) && !/type|kind|name|brand/.test(c) && !dtCols.includes(i));
    if (iU < 0) { iU = H.findIndex((c, i) => /^value$/.test(c.trim()) && !dtCols.includes(i)); ambiguous = iU >= 0; }
    iK = H.findIndex((c, i) => /type|kind|name|brand|insulin/.test(c) && i !== iU && !dtCols.includes(i));
    iN = H.findIndex((c, i) => /note|comment|memo|remark/.test(c) && ![iU, iK, ...dtCols].includes(i));
    iS = H.findIndex((c, i) => /serial|pen|device/.test(c) && ![iU, iK, iN, ...dtCols].includes(i));
    if (!dtCols.length || iU < 0)
      return { doses, skipped: [`Couldn't find ${!dtCols.length ? "a date/time" : "a units/dose"} column. Headers seen: ${first.join(" | ")}`], rows: lines.length - 1, assumptions, primes };
  }

  const start = hasHeader ? 1 : 0;
  const entries: { ts: string; raw: number | null; units: number | null; kind: string; note: string; label: string }[] = [];
  for (let n = start; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n], delim);
    const label = `Row ${n + 1}`;
    let dt: ReturnType<typeof findDateTime>, units: number | null = null, raw: number | null = null, kind = "", note = "";
    if (hasHeader) {
      dt = findDateTime(dtCols.map((i) => cells[i] ?? "").join(" "), order);
      if (ambiguous) { const v = parseFloat((cells[iU] ?? "").replace(",", ".")); raw = isFinite(v) && v > 0 ? v : null; } else units = unitsFrom(cells[iU] ?? "");
      kind = iK >= 0 ? cells[iK] ?? "" : ""; note = iN >= 0 ? cells[iN] ?? "" : "";
      if (!note && iS >= 0 && (cells[iS] ?? "").trim()) note = `Pen ${cells[iS].trim()}`;
    } else {
      dt = findDateTime(cells.join(" "), order);
      units = dt ? unitsFrom(dt.rest) : null;
      kind = cells.find((c) => /[a-z]/i.test(c) && !findDateTime(c, order)) ?? "";
    }
    if (!dt) { skipped.push(`${label}: no recognisable date`); continue; }
    entries.push({ ts: dt.ts, raw, units, kind: kind.trim(), note: note.trim(), label });
  }

  let tenths = false;
  if (ambiguous) {
    const raws = entries.map((e) => e.raw).filter((v): v is number => v != null);
    tenths = raws.length > 0 && Math.max(...raws) > 100 && raws.every((v) => v % 5 === 0);
    const tally = new Map<number, number>(); raws.forEach((v) => tally.set(v, (tally.get(v) ?? 0) + 1));
    const common = [...tally.entries()].filter(([v]) => v > 40).sort((a, b) => b[1] - a[1])[0]?.[0] ?? raws[0];
    assumptions.push(tenths ? `The "Value" column is read as tenths of a unit (for example ${common} means ${common / 10} units), because the values go up to ${Math.max(...raws)} and are all multiples of 5.` : `The "Value" column is read as whole units.`);
    for (const e of entries) e.units = e.raw == null ? null : Math.round((tenths ? e.raw / 10 : e.raw) * 100) / 100;
  }
  for (const e of entries) {
    if (e.units == null || !(e.units > 0 && e.units <= 500)) { skipped.push(`${e.label}: no valid units value`); continue; }
    doses.push({ id: newId(), ts: e.ts, units: e.units, kind: e.kind, note: e.note || undefined });
  }

  if (ambiguous) {
    // Priming (air) shots: small records within 3 minutes before a larger dose, or before another priming shot.
    doses.sort((a, b) => a.ts.localeCompare(b.ts));
    const t = doses.map((d) => new Date(d.ts).getTime()), isPrime: boolean[] = new Array(doses.length).fill(false);
    for (let i = doses.length - 2; i >= 0; i--) isPrime[i] = doses[i].units <= 4 && t[i + 1] - t[i] <= 180e3 && (doses[i + 1].units > doses[i].units || isPrime[i + 1]);
    primes = doses.filter((_, i) => isPrime[i]);
    const kept = doses.filter((_, i) => !isPrime[i]); doses.length = 0; doses.push(...kept);
    if (primes.length) assumptions.push(`${primes.length} small records (4 units or less) came within 3 minutes before a larger dose. They look like priming shots, where the pen is test-fired before an injection, so no insulin was taken and they are left out.`);
  }
  return { doses, skipped, rows: lines.length - start, assumptions, primes };
}

export function mergeInsulin(existing: InsulinDose[], incoming: InsulinDose[]) {
  // Duplicates are judged against what is already stored. Two identical doses inside one incoming file (for example two
  // 2-unit records in the same minute) are both real, so they are both kept; importing the file again adds nothing.
  const key = (d: InsulinDose) => `${d.ts.slice(0, 16)}|${d.units}|${(d.kind ?? "").toLowerCase()}`;
  const stored = new Set(existing.map(key)); const added = incoming.filter((d) => !stored.has(key(d)));
  return { all: [...existing, ...added].sort((a, b) => a.ts.localeCompare(b.ts)), added: added.length, dupes: incoming.length - added.length };
}

export function insulinToCsv(ds: InsulinDose[]) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ["timestamp,units,type,note", ...ds.map((d) => [d.ts.replace("T", " "), d.units, q(d.kind ?? ""), q(d.note ?? "")].join(","))].join("\n");
}

export function mergeHypos(existing: import("./types").HypoEvent[], incoming: import("./types").HypoEvent[]) {
  const key = (h: import("./types").HypoEvent) => `${h.ts.slice(0, 16)}|${Math.round(h.mgdl ?? 0)}`;
  const seen = new Set(existing.map(key)); const added: import("./types").HypoEvent[] = [];
  for (const h of incoming) { const k = key(h); if (!seen.has(k)) { seen.add(k); added.push(h); } }
  return { all: [...existing, ...added].sort((a, b) => a.ts.localeCompare(b.ts)), added: added.length };
}

export const shiftTs = (ts: string, minutes: number) => localIso(new Date(ts).getTime() + minutes * 60000);
export function mergeLabs(existing: LabA1c[], incoming: LabA1c[]) {
  const key = (l: LabA1c) => `${l.date}|${l.ngsp.toFixed(1)}`; const seen = new Set(existing.map(key)); const added = incoming.filter((l) => !seen.has(key(l)) && seen.add(key(l)));
  return { all: [...existing, ...added].sort((a, b) => a.date.localeCompare(b.date)), added: added.length };
}
export function mergeNotes(existing: DayNote[], incoming: DayNote[]) {
  const key = (n: DayNote) => `${n.ts.slice(0, 16)}|${n.text}`; const seen = new Set(existing.map(key)); const added = incoming.filter((n) => !seen.has(key(n)) && seen.add(key(n)));
  return { all: [...existing, ...added].sort((a, b) => a.ts.localeCompare(b.ts)), added: added.length };
}
export function mergeSupplies(existing: Supply[], incoming: Supply[]) {
  const seen = new Set(existing.map((x) => x.id)); const added = incoming.filter((x) => !seen.has(x.id));
  return { all: [...existing, ...added], added: added.length };
}

export function mergeKetones(existing: import("./types").KetoneReading[], incoming: import("./types").KetoneReading[]) {
  const key = (k: import("./types").KetoneReading) => `${k.ts.slice(0, 16)}|${k.mmol.toFixed(1)}`;
  const seen = new Set(existing.map(key)); const added = incoming.filter((k) => !seen.has(key(k)) && seen.add(key(k)));
  return { all: [...existing, ...added].sort((a, b) => a.ts.localeCompare(b.ts)), added: added.length };
}
