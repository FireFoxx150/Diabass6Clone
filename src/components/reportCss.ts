// Styles for the printable clinician report. Injected into the app while the report is open
// and embedded in the exported HTML file, so both look identical.
export const REPORT_CSS = `
@page { size: A4; margin: 14mm; }
.report { --raised:#f1f2f6; --line:#cfd2dc; --text:#14161d; --muted:#5b6070; --accent:#3b4bd6; --ins:#1b6fb3; --ok:#0b8f6b; --low:#b86a00; --high:#c0263d;
  font-family: Inter, "Noto Sans", "Ubuntu", system-ui, sans-serif; font-size: 12px; line-height: 1.45; color: var(--text); background: #fff;
  max-width: 210mm; margin: 0 auto; padding: 16mm 15mm; box-shadow: 0 8px 40px #0007; border-radius: 4px; font-variant-numeric: tabular-nums; }
.report, .report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
.report h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -.01em; }
.report h2 { font-size: 13px; margin: 20px 0 8px; padding-bottom: 3px; border-bottom: 1.5px solid var(--text); break-after: avoid; }
.report .sub { color: var(--muted); }
.report .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 4px 18px; margin: 12px 0 4px; }
.report .meta b { display: block; font-size: 10.5px; color: var(--muted); font-weight: 500; }
.report .kv { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.report .kv div { border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; break-inside: avoid; }
.report .kv b { display: block; font-size: 10.5px; color: var(--muted); font-weight: 500; }
.report .kv span { font-size: 17px; font-weight: 650; } .report .kv small { color: var(--muted); font-size: 10.5px; margin-left: 3px; }
.report .ribbon { display: flex; height: 12px; border-radius: 6px; overflow: hidden; gap: 2px; margin: 4px 0 6px; }
.report .ribbon i { display: block; min-width: 2px; }
.report .legend { display: flex; gap: 18px; color: var(--muted); } .report .legend b { color: var(--text); }
.report .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.report table { width: 100%; border-collapse: collapse; font-size: 11px; }
.report th { position: static; background: var(--raised); color: #333; text-align: left; font-weight: 600; padding: 4px 7px; border-bottom: 1px solid var(--line); }
.report td { padding: 3px 7px; border-bottom: 1px solid #e4e6ec; background: none !important; }
.report thead { display: table-header-group; } .report tr { break-inside: avoid; }
.report td.r, .report th.r { text-align: right; }
.report .chart { width: 100%; height: auto; display: block; } .report .tick { fill: var(--muted); font-size: 11px; }
.report .empty { padding: 14px; color: var(--muted); text-align: center; }
.report .block { break-inside: avoid; }
.report .note { color: var(--muted); font-size: 10.5px; margin-top: 6px; }
.report .clin { white-space: pre-wrap; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
.report .foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10.5px; }
@media print {
  html, body, #root { height: auto !important; background: #fff !important; }
  .shell { display: block !important; }
  .side, .head, .toast, .stack, .no-print { display: none !important; }
  .main { overflow: visible !important; padding: 0 !important; }
  .report { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: none !important; border-radius: 0 !important; }
}
`;
