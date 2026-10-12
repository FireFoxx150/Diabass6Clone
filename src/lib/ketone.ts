export function ketoneBand(mmol: number): { label: string; tone: "ok" | "warn" | "bad" } {
  if (mmol < 0.6) return { label: "Normal", tone: "ok" };
  if (mmol < 1.6) return { label: "Raised", tone: "warn" };
  if (mmol < 3.0) return { label: "High", tone: "bad" };
  return { label: "Very high", tone: "bad" };
}
export const KETONE_NOTE = "Commonly used guideline bands: below 0.6 mmol/L normal, 0.6 to 1.5 raised, 1.6 to 2.9 high, 3.0 and above very high. They are general guidance only. Follow your own care plan, and seek urgent medical advice if you are unwell with high ketones.";
