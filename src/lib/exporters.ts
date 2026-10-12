import { MMOL, Reading } from "./types";

/** Blood glucose in the Tidepool data model (type smbg, mmol/L, UTC time plus the meter's own local time). Control tests are left out. */
export function toTidepoolJson(readings: Reading[]): string {
  const out = readings.filter((r) => r.flag !== "control").map((r) => ({
    type: "smbg", subType: "manual", units: "mmol/L", value: Math.round((r.mgdl / 18.01559) * 10000) / 10000,
    time: new Date(r.ts).toISOString(), deviceTime: r.ts, timezoneOffset: -new Date(r.ts).getTimezoneOffset(),
  }));
  return JSON.stringify(out, null, 2);
}

export function toCsvAlt(readings: Reading[], o: { unit: "mgdl" | "mmol"; delimiter: "," | ";"; header?: boolean }): string {
  const d = o.delimiter, rows = readings.filter((r) => r.flag !== "control").map((r) => {
    const v = o.unit === "mgdl" ? String(Math.round(r.mgdl)) : (r.mgdl / MMOL).toFixed(1).replace(".", d === ";" ? "," : ".");
    return [r.ts.slice(0, 10), r.ts.slice(11, 16), v, r.meal ?? "", r.hct ?? ""].join(d);
  });
  return [...(o.header === false ? [] : [["date", "time", o.unit === "mgdl" ? "glucose_mg_dl" : "glucose_mmol_l", "meal", "haematocrit_pct"].join(d)]), ...rows].join("\n");
}
