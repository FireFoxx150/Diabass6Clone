export type Flag = "none" | "control";
export interface Reading {
  id: string;
  ts: string;        // local time "YYYY-MM-DDTHH:mm:ss"
  mgdl: number;      // always stored as mg/dL
  flag: Flag;        // "control" = control-solution test, excluded from stats
  meal?: "" | "fasting" | "before" | "after" | "bedtime";
  note?: string;
  hct?: number;      // haematocrit % the meter recorded with this reading
}
export interface Protocol {
  baud: number;
  commandHex: string; // commands in hex, separated by ';' (each sent in turn). Empty = just listen.
  idleMs: number;     // stop when no data for this long
  maxMs: number;      // hard stop
}
export interface Settings {
  unit: "mgdl" | "mmol";
  low: number;        // mg/dL
  high: number;       // mg/dL
  dateOrder: "dmy" | "mdy";
  port: string;
  patient?: string;   // optional name printed on the clinician report
  autoDownload: "off" | "ask" | "auto"; // what to do when a USB meter is plugged in
  meterId?: string;       // USB vid:pid of the meter, learned after a successful download
  lastDownload?: string;  // local time of the last successful download
  clockOffsetMin?: number; // minutes added to meter timestamps to correct a wrong meter clock
  backup?: { enabled: boolean; folder: string; keep: number }; // automatic dated backups
  goals?: Goals; reminders?: Reminders;
  kindMap?: Record<string, KindRule>;   // what to do with meter record kinds this app doesn't recognise, keyed "40 07"
  lastAppointment?: string; lastFullDownload?: string; clockWarnings?: string[];
  hypoDismissed?: string[]; // reading ids the user chose not to log as low-glucose events
  protocol: Protocol;
}
export interface InsulinDose {
  id: string;
  ts: string;      // local time "YYYY-MM-DDTHH:mm:ss"
  units: number;
  kind?: string;   // free text, e.g. "basal", "bolus", "Lantus"
  note?: string;
}
export interface HypoEvent {
  id: string;
  ts: string;
  mgdl?: number;
  readingId?: string;
  symptoms: string[];
  treatment: string;
  recoveryMgdl?: number;
  recoveryMins?: number;
  assisted: boolean;   // needed another person's help
  note?: string;
}
export interface KetoneReading { id: string; ts: string; mmol: number; }
export interface Goals { testsPerDay?: number; tir?: number; maxLows?: number; }          // maxLows counts readings below range per 14 days
export interface Reminders { enabled: boolean; times: string[]; stale: boolean; strips: boolean; }
export interface KindRule { as: "ketone" | "ignore"; divisor: number; }
export interface LabA1c { id: string; date: string; ngsp: number; note?: string; } // ngsp = HbA1c in %
export type SupplyKind = "strips" | "control" | "lancets" | "other";
export interface Supply {
  id: string; kind: SupplyKind; name: string;
  expiry?: string;        // YYYY-MM-DD
  openedOn?: string;      // YYYY-MM-DD, for control solution
  discardDays?: number;   // discard this many days after opening
  count?: number; countedAt?: string; lowAt?: number; // strips: count at a moment in time
}
export interface DayNote { id: string; ts: string; tags: string[]; text: string; }
export const ifccOf = (ngsp: number) => (ngsp - 2.15) * 10.929;
export const ngspOf = (ifcc: number) => ifcc / 10.929 + 2.15;
export interface Store { readings: Reading[]; insulin: InsulinDose[]; hypos: HypoEvent[]; labs: LabA1c[]; supplies: Supply[]; notes: DayNote[]; ketones: KetoneReading[]; settings: Settings; }
export const DEFAULT_SETTINGS: Settings = {
  unit: "mgdl", low: 70, high: 180, dateOrder: "dmy", port: "", autoDownload: "ask",
  protocol: { baud: 9600, commandHex: "", idleMs: 2500, maxMs: 60000 },
};
export const MMOL = 18.016;
export const fmt = (mgdl: number, unit: Settings["unit"]) =>
  unit === "mgdl" ? String(Math.round(mgdl)) : (mgdl / MMOL).toFixed(1);
export const unitLabel = (u: Settings["unit"]) => (u === "mgdl" ? "mg/dL" : "mmol/L");

export interface Extra { insulin?: InsulinDose[]; hypos?: HypoEvent[]; labs?: LabA1c[]; supplies?: Supply[]; notes?: DayNote[]; ketones?: KetoneReading[]; }
