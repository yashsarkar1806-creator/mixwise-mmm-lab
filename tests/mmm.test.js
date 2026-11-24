const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/mmm.js');

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' not within ' + tol + ' of ' + b);
const demo = M.generateSynthetic('IN');
const model = M.fitModel(demo, { valuePerKpi: demo.valuePerKpi, bootstrap: 60 });

test('adstock carries over geometrically', () => {
  assert.deepEqual(M.adstock([100, 0, 0], 0.5), [100, 50, 25]);
  assert.deepEqual(M.adstock([1, 2, 3], 0), [1, 2, 3]);
});

test('hill saturation: half effect at k, diminishing returns, zero at zero', () => {
  near(M.hill(2, 2), 0.5, 1e-12);
  assert.equal(M.hill(0, 1), 0);
  const g1 = M.hill(1, 1) - M.hill(0.5, 1), g2 = M.hill(1.5, 1) - M.hill(1, 1);
  assert.ok(g2 < g1, 'second increment should add less');
});

test('ridgeNN recovers a known linear model', () => {
  const r = M.rng(3), n = 200;
  const x1 = Array.from({ length: n }, () => r()), x2 = Array.from({ length: n }, () => r());
  const y = x1.map((v, i) => 5 + 3 * v - 2 * x2[i] + 0.01 * M.gauss(r));
  const f = M.ridgeNN([x1, x2], y, [false, false], 0);
  near(f.coef[0], 3, 0.02); near(f.coef[1], -2, 0.02); near(f.intercept, 5, 0.02);
});

test('ridgeNN enforces non-negativity on media columns', () => {
  const r = M.rng(5), n = 100;
  const x = Array.from({ length: n }, () => r());
  const y = x.map((v) => 10 - 4 * v + 0.01 * M.gauss(r));
  const f = M.ridgeNN([x], y, [true], 0);
  assert.equal(f.coef[0], 0);
});

test('synthetic generator is deterministic and well-formed', () => {
  const a = M.generateSynthetic('AU', { seed: 9 }), b = M.generateSynthetic('AU', { seed: 9 });
  assert.deepEqual(a.kpi, b.kpi);
  assert.equal(a.kpi.length, 156); assert.equal(a.channels.length, 5); assert.equal(a.currency, 'AUD');
  assert.ok(a.channels.every((c) => c.spend.every((v) => v >= 0)));
  assert.equal(a.dates[0], '2023-11-27');
  assert.ok(a.controls.find((c) => c.name === 'ctrl_eofy').values.some((v) => v === 1));
});

test('model fits synthetic data well and validates on holdout', () => {
  assert.ok(model.metrics.r2 > 0.85, 'r2 ' + model.metrics.r2);
  assert.ok(model.metrics.holdoutMape < 0.05, 'mape ' + model.metrics.holdoutMape);
  assert.equal(model.metrics.holdoutWeeks, 13);
});

test('model recovers true carry-over (decay) within 0.2 for every channel', () => {
  model.hyper.forEach((h, j) => near(h.decay, demo.truth[j].decay, 0.2));
});

test('model recovers channel ROI on synthetic data across seeds (median error < 25%)', () => {
  const errs = [];
  for (const seed of [1, 2, 99]) {
    const d = M.generateSynthetic('IN', { seed });
    const m = M.fitModel(d, { valuePerKpi: d.valuePerKpi });
    m.channels.forEach((c, j) => { const rel = c.roi / d.truth[j].roi; assert.ok(rel > 0.5 && rel < 1.8, 'seed ' + seed + ' ' + c.name + ' ' + rel); errs.push(Math.abs(rel - 1)); });
  }
  assert.ok(M.quantile(errs, 0.5) < 0.25, 'median error ' + M.quantile(errs, 0.5));
});

test('model identifies the weakest channel (YouTube) as Trim', () => {
  const yt = model.channels.find((c) => c.name === 'YouTube');
  assert.equal(yt.verdict, 'Trim');
  const minRoi = Math.min(...model.channels.map((c) => c.roi));
  assert.equal(yt.roi, minRoi);
});

test('decomposition adds up to fitted values', () => {
  for (let i = 0; i < demo.kpi.length; i += 17) {
    const total = model.decomp.base[i] + M.sum(model.decomp.media.map((m) => m[i]));
    near(total, model.fitted[i], 1e-6);
  }
  model.decomp.media.forEach((m) => assert.ok(m.every((v) => v >= 0)));
});

test('shares sum to 1 and ROI equals contribution x value / spend', () => {
  near(M.sum(model.channels.map((c) => c.spendShare)), 1, 1e-9);
  near(M.sum(model.channels.map((c) => c.effectShare)), 1, 1e-9);
  const c = model.channels[0];
  near(c.roi, (c.contribution * demo.valuePerKpi) / c.spend, 1e-9);
});

test('bootstrap intervals bracket ordered low <= high and are finite', () => {
  model.channels.forEach((c) => { assert.ok(Number.isFinite(c.roiLow) && Number.isFinite(c.roiHigh)); assert.ok(c.roiLow <= c.roiHigh); });
});

test('response curves are increasing and concave', () => {
  const cv = M.responseCurve(model, 0, 3, 30);
  for (let i = 1; i < cv.length; i++) assert.ok(cv[i].incremental >= cv[i - 1].incremental);
  const d1 = cv[10].incremental - cv[9].incremental, d2 = cv[25].incremental - cv[24].incremental;
  assert.ok(d2 < d1);
});

test('verdict thresholds follow the target ROI', () => {
  assert.equal(M.verdict(1.4, 1), 'Scale');
  assert.equal(M.verdict(1.0, 1), 'Hold');
  assert.equal(M.verdict(0.8, 1), 'Trim');
  assert.equal(M.verdict(2.0, 2), 'Hold');
});

test('optimiser spends the budget, respects bounds and never does worse than current mix', () => {
  const cur = model.channels.map((c) => c.currentWeekly);
  const budget = M.sum(cur);
  const bounds = cur.map((x) => [x * 0.5, x * 2]);
  const o = M.optimizeBudget(model, budget, bounds, 800);
  near(M.sum(o.alloc) + o.unspent, budget, 1e-6 * budget);
  o.alloc.forEach((a, j) => { assert.ok(a >= bounds[j][0] - 1e-6 && a <= bounds[j][1] + 1e-6); });
  assert.ok(o.optimizedIncremental >= o.currentIncremental - 1e-6);
  assert.ok(o.upliftPct > 0);
});

test('optimiser rejects budgets below the minimums and reports unspent when capped', () => {
  const cur = model.channels.map((c) => c.currentWeekly);
  assert.throws(() => M.optimizeBudget(model, 10, cur.map((x) => [x, x * 2])), /below/);
  const o = M.optimizeBudget(model, M.sum(cur) * 10, cur.map((x) => [0, x]));
  assert.ok(o.unspent > 0);
});

test('lift check classifies agreement within ±30%', () => {
  const c = model.channels[1];
  assert.equal(M.liftCheck(model, 1, c.costPerIncremental).status, 'Agrees');
  assert.equal(M.liftCheck(model, 1, c.costPerIncremental * 2).status, 'Model too optimistic');
  assert.equal(M.liftCheck(model, 1, c.costPerIncremental / 2).status, 'Model too pessimistic');
});

test('CSV round trip keeps data and parses quoted numbers', () => {
  const csv = M.toCSV(demo);
  const back = M.parseCSV(csv);
  assert.deepEqual(back.kpi, demo.kpi);
  assert.equal(back.channels.length, 5);
  assert.equal(back.channels[1].name, 'Google Search');
  assert.deepEqual(back.channels[1].spend, demo.channels[1].spend);
  assert.equal(back.controls[0].name, 'ctrl_festive_sale');
  const q = M.parseCSV('date,kpi,spend_meta\n2025-01-06,"1,200",500\n');
  assert.equal(q.kpi[0], 1200);
});

test('CSV parser gives clear errors', () => {
  assert.throws(() => M.parseCSV('week,sales\n1,2\n'), /date/);
  assert.throws(() => M.parseCSV('date,kpi\n2025-01-01,3\n'), /spend_/);
  assert.throws(() => M.parseCSV('date,kpi,spend_meta\n2025-01-01,abc,3\n'), /Row 2/);
});

test('fitModel validates input', () => {
  assert.throws(() => M.fitModel({ kpi: [1, 2, 3], channels: [{ name: 'x', spend: [1, 2, 3] }] }), /26 weeks/);
  const bad = M.generateSynthetic('IN', { weeks: 40 });
  bad.channels[0].spend = bad.channels[0].spend.map(() => 0);
  assert.throws(() => M.fitModel(bad), /no spend/);
});

test('readout and decomposition CSV are complete and free of NaN', () => {
  const cur = model.channels.map((c) => c.currentWeekly);
  const o = M.optimizeBudget(model, M.sum(cur), cur.map((x) => [x * 0.5, x * 2]));
  const md = M.readout(model, 'INR', o);
  assert.ok(!/NaN|undefined|Infinity/.test(md));
  model.channels.forEach((c) => assert.ok(md.includes(c.name)));
  assert.match(md, /Budget reallocation/);
  const csv = M.decompCSV(model).trim().split('\n');
  assert.equal(csv.length, demo.kpi.length + 1);
  assert.match(csv[0], /contrib_apple_search_ads/);
});

test('money formatting uses lakh/crore for INR and A$ for AUD', () => {
  assert.equal(M.fmtMoney(250000, 'INR'), '₹2.5 L');
  assert.equal(M.fmtMoney(32000000, 'INR'), '₹3.20 Cr');
  assert.equal(M.fmtMoney(9500, 'INR'), '₹9,500');
  assert.equal(M.fmtMoney(21000, 'AUD'), 'A$21,000');
});
