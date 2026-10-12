// Importers for CSV exports from other systems (FreeStyle Libre / LibreView, Dexcom Clarity, Glooko, or any CSV with
// recognisable column names). Only fingerstick (blood) glucose and insulin doses are imported. Continuous-sensor values
// are counted and skipped: they would swamp the meter data and wreck "tests per day" and strip counts.
import { InsulinDose, MMOL, Reading, Settings } from "./types";
import { findDateTime, newId, splitCsvLine } from "./parse";

export type Source = "libre" | "clarity" | "glooko" | "generic";
export const SOURCE_NAMES: Record<Source, string> = { libre: "FreeStyle Libre / LibreView", clarity: "Dexcom Clarity", glooko: "Glooko", generic: "Generic CSV" };
export interface ImportPlan { source: Source; blood: Reading[]; doses: InsulinDose[]; sensorSkipped: number; skipped: string[]; rows: number; order: Settings["dateOrder"]; ambiguous: boolean; error?: string; }

const MEALS: [RegExp, NonNullable<Reading["meal"]>][] = [[/fasting/i, "fasting"], [/bed/i, "bedtime"], [/before|pre/i, "before"], [/after|post/i, "after"]];

export function planImport(text: string, fileName: string, orderSetting: Settings["dateOrder"]): ImportPlan {
  const plan: ImportPlan = { source: "generic", blood: [], doses: [], sensorSkipped: 0, skipped: [], rows: 0, order: orderSetting, ambiguous: false };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const seps = [",", ";", "\t"], delimOf = (l: string) => seps[[...seps.map((d) => l.split(d).length)].reduce((bi, n, i, a) => (n > a[bi] ? i : bi), 0)];

  // Find the header row (exports often start with a few lines of patient or report information)
  let hi = -1, delim = ",";
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const d = delimOf(lines[i]), cells = splitCsvLine(lines[i], d).map((c) => c.toLowerCase());
    if (cells.length >= 3 && cells.some((c) => /time|date/.test(c)) && cells.some((c) => /glucose|insulin|event|record|bg\b/.test(c))) { hi = i; delim = d; break; }
  }
  if (hi < 0) return { ...plan, error: "Couldn't find a header row with a date/time column and glucose or insulin columns." };

  const H = splitCsvLine(lines[hi], delim).map((c) => c.toLowerCase());
  const find = (re: RegExp, not: number[] = []) => H.findIndex((c, i) => re.test(c) && !not.includes(i));
  const tsCol = [find(/timestamp/), find(/date.?time/), find(/^date$/), find(/^time$/), find(/date/), find(/time/)].find((i) => i >= 0) ?? -1;
  if (tsCol < 0) return { ...plan, error: "No date/time column found." };
  const typeCol = find(/event type|record type/), subCol = find(/event subtype/), mealCol = find(/meal tag/);

  const hasType = typeCol >= 0;
  plan.source = H.some((c) => /^record type$/.test(c)) && H.some((c) => /(historic|scan|strip) glucose/.test(c)) ? "libre"
    : hasType && H.some((c) => /glucose value/.test(c)) ? "clarity" : H.some((c) => /glucose value/.test(c)) && H.some((c) => /serial number|meal tag/.test(c)) ? "glooko" : "generic";

  type GCol = { i: number; cls: "blood" | "sensor" | "plain"; mmol: boolean };
  const gcols: GCol[] = H.map((c, i) => ({ c, i })).filter(({ c }) => /glucose|^bg|blood sugar/.test(c) && !/rate of change|ketone|non-numeric/.test(c))
    .map(({ c, i }) => ({ i, mmol: /mmol/.test(c), cls: /strip|blood|finger|meter|calibrat/.test(c) ? "blood" : /historic|scan|sensor|egv|cgm/.test(c) ? "sensor" : "plain" }) as GCol);
  const icols = H.map((c, i) => ({ c, i })).filter(({ c, i }) => /insulin/.test(c) && /units|\(u\)|value|amount/.test(c) && !/non-numeric|type/.test(c) && i !== tsCol)
    .map(({ c, i }) => ({ i, kind: /long|basal/.test(c) ? "Long-acting" : /rapid|fast|meal|correction|bolus/.test(c) ? "Rapid-acting" : "" }));
  if (!gcols.length && !icols.length) return { ...plan, error: "No glucose or insulin columns found." };

  const rows = lines.slice(hi + 1).map((l) => splitCsvLine(l, delim));

  // Work out day/month order from the data itself when the dates make it obvious
  let sawNumeric = false, decided = false;
  for (const r of rows) {
    const m = (r[tsCol] ?? "").match(/^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { sawNumeric = true; if (+m[1] > 12) { plan.order = "dmy"; decided = true; break; } if (+m[2] > 12) { plan.order = "mdy"; decided = true; break; } }
  }
  plan.ambiguous = sawNumeric && !decided;   // every date could be read either way: the user should check the preview
  const timeCol = /^date$/.test(H[tsCol]) ? find(/^time$/) : -1;

  const num = (c?: string) => { const v = parseFloat((c ?? "").replace(",", ".")); return isFinite(v) ? v : NaN; };
  const sensorByName = /cgm|sensor/i.test(fileName);
  const plain: Reading[] = [];
  rows.forEach((r, n) => {
    const raw = ((r[tsCol] ?? "") + (timeCol >= 0 ? " " + (r[timeCol] ?? "") : "")).trim(); if (!(r[tsCol] ?? "").trim()) return;   // report/patient rows have no timestamp
    plan.rows++;
    const dt = findDateTime(raw, plan.order);
    if (!dt) { if (plan.skipped.length < 30) plan.skipped.push(`Row ${hi + n + 2}: couldn't read the date "${raw.slice(0, 30)}"`); return; }
    const type = (hasType ? r[typeCol] ?? "" : "").toLowerCase(), sub = (subCol >= 0 ? r[subCol] ?? "" : "").toLowerCase();
    for (const g of gcols) {
      const v = num(r[g.i]); if (!(v > 0)) continue;
      const isMmol = g.mmol || v < 20 || (v < 35 && /[.,]\d/.test(r[g.i] ?? ""));   // no unit in the header: small decimals are mmol/L
      const mg = isMmol ? v * MMOL : v; if (mg < 18 || mg > 900) continue;
      let cls = g.cls;
      if (cls === "plain" && hasType) cls = /egv/.test(type) ? "sensor" : /calib/.test(type) ? "blood" : "sensor";
      if (sensorByName && cls === "plain") cls = "sensor";
      if (plan.source === "libre" && g.cls === "blood" && type && type !== "2") cls = "sensor";
      if (cls === "sensor") { plan.sensorSkipped++; continue; }
      const meal = mealCol >= 0 ? MEALS.find(([re]) => re.test(r[mealCol] ?? ""))?.[1] : undefined;
      const rd: Reading = { id: newId(), ts: dt.ts, mgdl: Math.round(mg * 10) / 10, flag: "none", ...(meal ? { meal } : {}) };
      (cls === "plain" ? plain : plan.blood).push(rd);
    }
    for (const ic of icols) {
      const v = num(r[ic.i]); if (!(v > 0 && v <= 500)) continue;
      if (hasType && plan.source === "clarity" && !/insulin/.test(type)) continue;
      const kind = ic.kind || (/long|basal/.test(sub) ? "Long-acting" : /fast|rapid|bolus/.test(sub) ? "Rapid-acting" : "");
      plan.doses.push({ id: newId(), ts: dt.ts, units: Math.round(v * 100) / 100, kind });
    }
  });

  // A "plain" glucose column with readings every few minutes is a sensor, not a meter
  if (plain.length) {
    const t = plain.map((x) => new Date(x.ts).getTime()).sort((a, b) => a - b), gaps = t.slice(1).map((x, i) => (x - t[i]) / 60000).sort((a, b) => a - b);
    if (plain.length >= 200 && gaps[Math.floor(gaps.length / 2)] <= 16) plan.sensorSkipped += plain.length; else plan.blood.push(...plain);
  }
  plan.blood.sort((a, b) => a.ts.localeCompare(b.ts)); plan.doses.sort((a, b) => a.ts.localeCompare(b.ts));
  return plan;
}
