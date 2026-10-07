#!/usr/bin/env node
// Snapshots where federal money goes, for the "Not with my tax dollars"
// experiment (tax-dollars.html): each budget function (Medicare, National
// Defense, ...), its subfunctions, and the largest federal accounts in each,
// from USAspending.gov's free API. Stored once in assets/, so viewers' pages
// never call USAspending themselves. Amounts are obligations for a complete
// fiscal year (USAspending's "spending explorer" view).
//   node scripts/fetch-tax-dollars.js [fiscal-year]   (default: 2025)
'use strict';
const fs = require('fs');
const path = require('path');

const FY = process.argv[2] || '2025';
const API = 'https://api.usaspending.gov/api/v2/spending/';
const OUT = path.join(__dirname, '..', 'assets', `tax-dollars-fy${FY}.json`);
const TOP_ACCOUNTS = 6;

async function explore(type, extra) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, filters: { fy: FY, period: 12, ...extra } }),
  });
  if (!r.ok) throw new Error(`${type} ${JSON.stringify(extra)}: HTTP ${r.status}`);
  return (await r.json()).results || [];
}
const keep = (rows) => rows
  .filter(r => r.code && r.amount > 0 && !/^unreported/i.test(r.name || ''))
  .sort((a, b) => b.amount - a.amount);

(async () => {
  const functions = [];
  for (const f of keep(await explore('budget_function', {}))) {
    if (f.code === '000') continue; // Governmental Receipts: money in, not out
    const subfunctions = [];
    for (const s of keep(await explore('budget_subfunction', { budget_function: f.code }))) {
      const accounts = keep(await explore('federal_account', { budget_function: f.code, budget_subfunction: s.code }))
        .slice(0, TOP_ACCOUNTS)
        .map(a => ({ name: a.name, amount: Math.round(a.amount) }));
      subfunctions.push({ code: s.code, name: s.name, amount: Math.round(s.amount), accounts });
    }
    functions.push({ code: f.code, name: f.name, amount: Math.round(f.amount), subfunctions });
    process.stdout.write(`${f.code} ${f.name}: ${subfunctions.length} subfunctions\n`);
  }
  const total = functions.reduce((n, f) => n + f.amount, 0);
  fs.writeFileSync(OUT, JSON.stringify({
    fiscalYear: Number(FY),
    measure: 'obligations',
    source: 'USAspending.gov spending explorer (budget function, subfunction, federal account)',
    sourceUrl: 'https://www.usaspending.gov/explorer/budget_function',
    fetched: new Date().toISOString().slice(0, 10),
    total,
    functions,
  }, null, 1));
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${functions.length} functions, $${(total / 1e12).toFixed(2)} trillion`);
})().catch((e) => { console.error(e.message); process.exit(1); });
