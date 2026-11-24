/* Mixwise MMM engine: pure functions, no dependencies. Works in the browser (window.MMM) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MMM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- small helpers ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  function quantile(arr, q) {
    const s = arr.slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  // ---------- media transforms ----------
  /** Geometric adstock: carry-over of last week's effect at rate `decay` (0..<1). */
  function adstock(x, decay) {
    const out = new Array(x.length); let carry = 0;
    for (let i = 0; i < x.length; i++) { carry = x[i] + decay * carry; out[i] = carry; }
    return out;
  }
  /** Hill saturation with shape 1 (pure diminishing returns). k = spend level giving half the max effect. */
  function hill(x, k) { return x <= 0 ? 0 : x / (x + k); }

  /** Channel feature: adstock -> normalise so steady average spend = 1 -> saturate. */
  function channelFeature(spend, decay, k, norm) {
    const a = adstock(spend, decay);
    return a.map((v) => hill((v * (1 - decay)) / norm, k));
  }
  function spendNorm(spend) { const pos = spend.filter((v) => v > 0); return pos.length ? mean(pos) : 1; }

  // ---------- regression ----------
  /**
   * Ridge regression with optional non-negativity per column, solved by coordinate descent
   * on standardised columns. Returns { coef, intercept }.
   */
  function ridgeNN(X, y, nonneg, lambda, maxIter) {
    lambda = lambda == null ? 0.01 : lambda; maxIter = maxIter || 500;
    const n = y.length, p = X.length;
    const mu = X.map(mean), sd = X.map((col, j) => Math.sqrt(mean(col.map((v) => (v - mu[j]) ** 2))));
    const ybar = mean(y);
    const Z = X.map((col, j) => (sd[j] > 1e-12 ? col.map((v) => (v - mu[j]) / sd[j]) : null));
    const b = new Array(p).fill(0);
    const r = y.map((v) => v - ybar);
    for (let it = 0; it < maxIter; it++) {
      let maxD = 0;
      for (let j = 0; j < p; j++) {
        const z = Z[j]; if (!z) continue;
        let rho = 0; for (let i = 0; i < n; i++) rho += z[i] * (r[i] + b[j] * z[i]);
        rho /= n;
        let nb = rho / (1 + lambda);
        if (nonneg[j] && nb < 0) nb = 0;
        const d = nb - b[j];
        if (d !== 0) { for (let i = 0; i < n; i++) r[i] -= d * z[i]; b[j] = nb; }
        if (Math.abs(d) > maxD) maxD = Math.abs(d);
      }
      if (maxD < 1e-9) break;
    }
    const coef = b.map((v, j) => (Z[j] ? v / sd[j] : 0));
    const intercept = ybar - sum(coef.map((c, j) => c * mu[j]));
    return { coef, intercept };
  }
  function predict(X, fit, rows) {
    const out = [];
    for (const i of rows) { let v = fit.intercept; for (let j = 0; j < X.length; j++) v += fit.coef[j] * X[j][i]; out.push(v); }
    return out;
  }
  function range(a, b) { const o = []; for (let i = a; i < b; i++) o.push(i); return o; }
  function r2(y, f) { const m = mean(y); const ss = sum(y.map((v) => (v - m) ** 2)); const se = sum(y.map((v, i) => (v - f[i]) ** 2)); return ss > 0 ? 1 - se / ss : 0; }
  function mape(y, f) { const v = y.map((a, i) => (a !== 0 ? Math.abs((a - f[i]) / a) : 0)); return mean(v); }
  function nrmse(y, f) { const rm = Math.sqrt(mean(y.map((v, i) => (v - f[i]) ** 2))); const rg = Math.max(...y) - Math.min(...y); return rg > 0 ? rm / rg : 0; }

  // ---------- base (non-media) features ----------
  function baseFeatures(n, controls) {
    const cols = [], names = [];
    cols.push(range(0, n).map((t) => t / Math.max(1, n - 1))); names.push('trend');
    for (let h = 1; h <= 2; h++) {
      cols.push(range(0, n).map((t) => Math.sin((2 * Math.PI * h * t) / 52))); names.push('sin' + h);
      cols.push(range(0, n).map((t) => Math.cos((2 * Math.PI * h * t) / 52))); names.push('cos' + h);
    }
    (controls || []).forEach((c) => { cols.push(c.values.slice()); names.push(c.name); });
    return { cols, names };
  }

  const DECAYS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const KS = [0.7, 1, 1.5, 2.2, 3.2]; // half-saturation prior range: 0.7x to 3.2x average weekly spend

  function design(data, hyper) {
    const n = data.kpi.length;
    const media = data.channels.map((c, j) => channelFeature(c.spend, hyper[j].decay, hyper[j].k, hyper[j].norm));
    const base = baseFeatures(n, data.controls);
    return { X: media.concat(base.cols), nonneg: media.map(() => true).concat(base.cols.map(() => false)), baseNames: base.names, nMedia: media.length };
  }

  function sseFor(data, hyper, rows, lambda) {
    const d = design(data, hyper);
    const Xr = d.X.map((col) => rows.map((i) => col[i]));
    const yr = rows.map((i) => data.kpi[i]);
    const fit = ridgeNN(Xr, yr, d.nonneg, lambda, 200);
    const f = predict(Xr, fit, range(0, rows.length));
    return sum(yr.map((v, i) => (v - f[i]) ** 2));
  }

  /**
   * Fit the MMM. data = { dates[], kpi[], channels:[{name, spend[]}], controls:[{name, values[]}] }
   * opts: { holdoutWeeks=13, lambda=0.005, passes=3, valuePerKpi=1, bootstrap=0, seed=7 }
   */
  function fitModel(data, opts) {
    opts = Object.assign({ holdoutWeeks: 13, lambda: 0.005, passes: 3, valuePerKpi: 1, bootstrap: 0, seed: 7 }, opts || {});
    validateData(data);
    const n = data.kpi.length;
    const hold = Math.min(opts.holdoutWeeks, Math.floor(n * 0.25));
    const trainRows = range(0, n - hold), holdRows = range(n - hold, n);
    const hyper = data.channels.map((c) => ({ decay: 0.3, k: 1, norm: spendNorm(c.spend) }));
    let best = sseFor(data, hyper, trainRows, opts.lambda);
    for (let pass = 0; pass < opts.passes; pass++) {
      let improved = false;
      for (let j = 0; j < hyper.length; j++) {
        for (const d of DECAYS) for (const k of KS) {
          if (d === hyper[j].decay && k === hyper[j].k) continue;
          const trial = hyper.map((h, i) => (i === j ? { decay: d, k, norm: h.norm } : h));
          const s = sseFor(data, trial, trainRows, opts.lambda);
          if (s < best - 1e-9) { best = s; hyper[j] = trial[j]; improved = true; }
        }
      }
      if (!improved) break;
    }
    const d = design(data, hyper);
    // holdout validation: fit on train rows only, predict holdout (adstock carries across the split)
    const Xt = d.X.map((col) => trainRows.map((i) => col[i]));
    const fitTrain = ridgeNN(Xt, trainRows.map((i) => data.kpi[i]), d.nonneg, opts.lambda);
    const predHold = hold ? predict(d.X, fitTrain, holdRows) : [];
    // final fit on all weeks for decomposition
    const fit = ridgeNN(d.X, data.kpi, d.nonneg, opts.lambda);
    const fitted = predict(d.X, fit, range(0, n));
    const model = {
      data, opts, hyper, fit, fitted, X: d.X, nonneg: d.nonneg, nMedia: d.nMedia, baseNames: d.baseNames,
      metrics: {
        weeks: n, holdoutWeeks: hold,
        r2: r2(data.kpi, fitted), nrmse: nrmse(data.kpi, fitted),
        holdoutMape: hold ? mape(holdRows.map((i) => data.kpi[i]), predHold) : null,
      },
      holdout: { rows: holdRows, pred: predHold },
    };
    model.decomp = decompose(model);
    model.channels = channelSummary(model);
    if (opts.bootstrap > 0) attachBootstrap(model, opts.bootstrap, opts.seed);
    return model;
  }

  function validateData(data) {
    if (!data || !Array.isArray(data.kpi) || data.kpi.length < 26) throw new Error('Need at least 26 weeks of KPI data.');
    if (!data.channels || !data.channels.length) throw new Error('Need at least one spend channel.');
    data.channels.forEach((c) => {
      if (c.spend.length !== data.kpi.length) throw new Error('Spend for ' + c.name + ' has the wrong number of weeks.');
      if (c.spend.some((v) => !(v >= 0))) throw new Error('Spend for ' + c.name + ' must be numbers ≥ 0.');
      if (sum(c.spend) <= 0) throw new Error('Channel ' + c.name + ' has no spend.');
    });
    if (data.kpi.some((v) => !Number.isFinite(v))) throw new Error('KPI column has blanks or non-numbers.');
    (data.controls || []).forEach((c) => { if (c.values.length !== data.kpi.length) throw new Error('Control ' + c.name + ' has the wrong number of weeks.'); });
  }

  function decompose(model) {
    const n = model.data.kpi.length;
    const media = model.data.channels.map((c, j) => model.X[j].map((v) => v * model.fit.coef[j]));
    const base = range(0, n).map((i) => model.fitted[i] - sum(media.map((m) => m[i])));
    return { media, base };
  }

  /** Steady-state weekly response (incremental KPI per week) for a channel at weekly spend x. */
  function response(model, j, x) {
    const h = model.hyper[j];
    return model.fit.coef[j] * hill(x / h.norm, h.k);
  }
  function marginal(model, j, x) { const e = Math.max(1, x * 0.01); return (response(model, j, x + e) - response(model, j, x)) / e; }
  function recentSpend(model, j, weeks) {
    const s = model.data.channels[j].spend; const w = Math.min(weeks || 13, s.length);
    return mean(s.slice(s.length - w));
  }

  function verdict(mroi, target) {
    target = target || 1;
    if (mroi >= target * 1.3) return 'Scale';
    if (mroi < target * 0.9) return 'Trim';
    return 'Hold';
  }

  function channelSummary(model, coefOverride) {
    const coef = coefOverride || model.fit.coef;
    const v = model.opts.valuePerKpi;
    const totalSpend = sum(model.data.channels.map((c) => sum(c.spend)));
    const contribs = model.data.channels.map((c, j) => sum(model.X[j]) * coef[j]);
    const totalContrib = sum(contribs);
    return model.data.channels.map((c, j) => {
      const spend = sum(c.spend), contrib = contribs[j];
      const cur = recentSpend(model, j, 13);
      const m = coefOverride ? null : marginal(model, j, cur);
      const mroi = m == null ? null : m * v;
      return {
        name: c.name, spend, contribution: contrib,
        spendShare: totalSpend ? spend / totalSpend : 0,
        effectShare: totalContrib ? contrib / totalContrib : 0,
        costPerIncremental: contrib > 0 ? spend / contrib : Infinity,
        roi: spend ? (contrib * v) / spend : 0,
        currentWeekly: cur,
        mroi, verdict: mroi == null ? null : verdict(mroi, model.opts.targetRoi),
        decay: model.hyper[j].decay, halfSat: model.hyper[j].k * model.hyper[j].norm,
      };
    });
  }

  /** Residual block bootstrap with fixed hyperparameters -> 80% intervals for ROI. */
  function attachBootstrap(model, B, seed) {
    const r = rng(seed || 7), n = model.data.kpi.length, block = 4;
    const resid = model.data.kpi.map((y, i) => y - model.fitted[i]);
    const rois = model.channels.map(() => []);
    for (let b = 0; b < B; b++) {
      const ystar = new Array(n);
      for (let i = 0; i < n; i += block) {
        const start = Math.floor(r() * (n - block + 1));
        for (let k = 0; k < block && i + k < n; k++) ystar[i + k] = model.fitted[i + k] + resid[start + k];
      }
      const f = ridgeNN(model.X, ystar, model.nonneg, model.opts.lambda, 200);
      channelSummary(model, f.coef).forEach((c, j) => rois[j].push(c.roi));
    }
    model.channels.forEach((c, j) => { c.roiLow = quantile(rois[j], 0.1); c.roiHigh = quantile(rois[j], 0.9); });
    model.bootstrap = B;
  }

  /**
   * Greedy marginal allocation of a weekly budget (optimal for concave response curves).
   * bounds: array of [min, max] weekly spend per channel.
   */
  function optimizeBudget(model, weeklyBudget, bounds, steps) {
    const J = model.data.channels.length;
    bounds = bounds || model.data.channels.map((c, j) => [0, recentSpend(model, j) * 3 + 1]);
    const minTotal = sum(bounds.map((b) => b[0]));
    if (weeklyBudget < minTotal - 1e-6) throw new Error('Budget is below the sum of channel minimums.');
    const alloc = bounds.map((b) => b[0]);
    let left = weeklyBudget - minTotal;
    const step = Math.max(weeklyBudget / (steps || 400), 1e-6);
    while (left > 1e-9) {
      let bestJ = -1, bestGain = 0, bestAmt = 0;
      for (let j = 0; j < J; j++) {
        const amt = Math.min(step, left, bounds[j][1] - alloc[j]);
        if (amt <= 1e-12) continue;
        const gain = (response(model, j, alloc[j] + amt) - response(model, j, alloc[j])) / amt;
        if (gain > bestGain) { bestGain = gain; bestJ = j; bestAmt = amt; }
      }
      if (bestJ < 0) break;
      alloc[bestJ] += bestAmt; left -= bestAmt;
    }
    const current = model.data.channels.map((c, j) => recentSpend(model, j));
    const respOf = (a) => sum(a.map((x, j) => response(model, j, x)));
    const curResp = respOf(current), newResp = respOf(alloc);
    return {
      alloc, current, unspent: Math.max(0, left),
      currentIncremental: curResp, optimizedIncremental: newResp,
      upliftPct: curResp > 0 ? newResp / curResp - 1 : 0,
      currentCost: sum(current) / (curResp || Infinity), optimizedCost: sum(alloc) / (newResp || Infinity),
      perChannel: alloc.map((x, j) => ({ name: model.data.channels[j].name, current: current[j], proposed: x, change: current[j] ? x / current[j] - 1 : null, incremental: response(model, j, x), mroi: marginal(model, j, x) * model.opts.valuePerKpi })),
    };
  }

  /** Response curve points for charting: multipliers of current weekly spend. */
  function responseCurve(model, j, maxMult, points) {
    const cur = recentSpend(model, j); const out = [];
    points = points || 40; maxMult = maxMult || 3;
    for (let i = 0; i <= points; i++) { const x = (cur * maxMult * i) / points; out.push({ spend: x, incremental: response(model, j, x) }); }
    return out;
  }

  /** Compare the model's cost per incremental KPI for a channel to a lift-test result. */
  function liftCheck(model, j, testCostPerIncremental) {
    const c = model.channels[j];
    const ratio = c.costPerIncremental / testCostPerIncremental;
    let status = 'Agrees';
    if (ratio < 0.7) status = 'Model too optimistic';
    else if (ratio > 1.3) status = 'Model too pessimistic';
    return { channel: c.name, modelCost: c.costPerIncremental, testCost: testCostPerIncremental, ratio, status };
  }

  // ---------- synthetic data ----------
  const MARKETS = {
    IN: {
      currency: 'INR', valuePerKpi: 1500, base: 3200, start: '2023-11-27',
      events: [{ name: 'ctrl_festive_sale', weeksOfYear: [43, 44, 45] }, { name: 'ctrl_ipl_season', weeksOfYear: [13, 14, 15, 16, 17, 18, 19, 20, 21] }],
      channels: [
        { name: 'Meta', mean: 520000, decay: 0.3, k: 1.0, roi: 1.35, pattern: 'always' },
        { name: 'Google Search', mean: 300000, decay: 0.1, k: 1.5, roi: 1.9, pattern: 'always' },
        { name: 'YouTube', mean: 380000, decay: 0.6, k: 1.5, roi: 0.75, pattern: 'flight' },
        { name: 'Creators', mean: 220000, decay: 0.4, k: 3.2, roi: 1.8, pattern: 'pulse' },
        { name: 'Apple Search Ads', mean: 100000, decay: 0.0, k: 1.5, roi: 2.6, pattern: 'always' },
      ],
    },
    AU: {
      currency: 'AUD', valuePerKpi: 120, base: 1400, start: '2023-11-27',
      events: [{ name: 'ctrl_eofy', weeksOfYear: [25, 26] }, { name: 'ctrl_black_friday', weeksOfYear: [47, 48] }],
      channels: [
        { name: 'Meta', mean: 21000, decay: 0.3, k: 1.0, roi: 1.3, pattern: 'always' },
        { name: 'Google Search', mean: 14000, decay: 0.1, k: 1.5, roi: 2.0, pattern: 'always' },
        { name: 'YouTube', mean: 16000, decay: 0.6, k: 1.5, roi: 0.7, pattern: 'flight' },
        { name: 'Creators', mean: 9000, decay: 0.4, k: 3.2, roi: 1.8, pattern: 'pulse' },
        { name: 'Apple Search Ads', mean: 4500, decay: 0.0, k: 1.5, roi: 2.5, pattern: 'always' },
      ],
    },
  };

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }

  /** Synthetic weekly data for a fictional budgeting app ("Tallyo"), with known true effects for recovery checks. */
  function generateSynthetic(market, opts) {
    opts = Object.assign({ weeks: 156, seed: 99, noise: 0.02 }, opts || {});
    const M = MARKETS[market] || MARKETS.IN; const r = rng(opts.seed); const n = opts.weeks;
    const start = new Date(M.start + 'T00:00:00Z');
    const dates = range(0, n).map((i) => new Date(start.getTime() + i * 7 * 86400000));
    const woy = dates.map(isoWeek);
    const controls = M.events.map((e) => ({ name: e.name, values: woy.map((w) => (e.weeksOfYear.includes(w) ? 1 : 0)) }));
    const channels = M.channels.map((c) => {
      const spend = range(0, n).map((i) => {
        let v;
        if (c.pattern === 'flight') v = (Math.floor(i / 6) % 2 === 0 ? 1.7 : 0.25) * c.mean * (0.8 + 0.4 * r());
        else if (c.pattern === 'pulse') v = (r() < 0.35 ? 2.1 : 0.45) * c.mean * (0.75 + 0.5 * r());
        else v = (r() < 0.08 ? 0.1 : 0.25 + 1.5 * r()) * c.mean;
        if (controls[0].values[i]) v *= 1.4;
        return Math.round(v / 100) * 100;
      });
      return { name: c.name, spend };
    });
    const truth = M.channels.map((c, j) => {
      const norm = spendNorm(channels[j].spend);
      const beta = (c.roi * norm) / M.valuePerKpi / hill(1, c.k);
      return { name: c.name, decay: c.decay, k: c.k, beta, norm };
    });
    const media = truth.map((t, j) => channelFeature(channels[j].spend, t.decay, t.k, t.norm).map((v) => v * t.beta));
    const kpi = range(0, n).map((i) => {
      const season = 0.08 * Math.sin((2 * Math.PI * i) / 52) + 0.04 * Math.cos((4 * Math.PI * i) / 52);
      const baseVal = M.base * (1 + 0.15 * (i / (n - 1)) + season + 0.12 * controls[0].values[i] + 0.05 * (controls[1] ? controls[1].values[i] : 0));
      const v = baseVal + sum(media.map((m) => m[i]));
      return Math.round(v * (1 + opts.noise * gauss(r)));
    });
    const trueContrib = truth.map((t, j) => sum(media[j]));
    const trueRoi = trueContrib.map((c, j) => (c * M.valuePerKpi) / sum(channels[j].spend));
    return {
      brand: 'Tallyo (fictional budgeting app)', market, currency: M.currency, valuePerKpi: M.valuePerKpi, kpiName: 'new_paid_subscribers',
      dates: dates.map((d) => d.toISOString().slice(0, 10)), kpi, channels, controls,
      truth: truth.map((t, j) => Object.assign({}, t, { contribution: trueContrib[j], roi: trueRoi[j] })),
    };
  }

  // ---------- CSV ----------
  function splitCSVLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map((s) => s.trim());
  }
  /** Parse weekly CSV: date, kpi, spend_<channel>..., optional ctrl_<name>... */
  function parseCSV(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV is empty.');
    const head = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
    const di = head.indexOf('date'), ki = head.indexOf('kpi');
    if (di < 0 || ki < 0) throw new Error('CSV needs "date" and "kpi" columns.');
    const spendIdx = head.map((h, i) => (h.startsWith('spend_') ? i : -1)).filter((i) => i >= 0);
    const ctrlIdx = head.map((h, i) => (h.startsWith('ctrl_') ? i : -1)).filter((i) => i >= 0);
    if (!spendIdx.length) throw new Error('CSV needs at least one spend_<channel> column.');
    const rows = lines.slice(1).map(splitCSVLine);
    const num = (s, col, row) => { const v = Number(String(s).replace(/[,₹$\s]/g, '')); if (!Number.isFinite(v)) throw new Error('Row ' + (row + 2) + ': "' + s + '" in ' + col + ' is not a number.'); return v; };
    const pretty = (h) => h.replace(/^spend_/, '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    const raw = splitCSVLine(lines[0]);
    return {
      dates: rows.map((r) => r[di]),
      kpi: rows.map((r, i) => num(r[ki], 'kpi', i)),
      channels: spendIdx.map((ci) => ({ name: pretty(raw[ci]), spend: rows.map((r, i) => num(r[ci] || 0, raw[ci], i)) })),
      controls: ctrlIdx.map((ci) => ({ name: raw[ci], values: rows.map((r, i) => num(r[ci] || 0, raw[ci], i)) })),
    };
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function toCSV(data) {
    const head = ['date', 'kpi'].concat(data.channels.map((c) => 'spend_' + slug(c.name))).concat((data.controls || []).map((c) => c.name));
    const lines = [head.join(',')];
    data.kpi.forEach((k, i) => lines.push([data.dates[i], k].concat(data.channels.map((c) => c.spend[i])).concat((data.controls || []).map((c) => c.values[i])).join(',')));
    return lines.join('\n') + '\n';
  }
  function decompCSV(model) {
    const head = ['date', 'actual', 'fitted', 'base'].concat(model.data.channels.map((c) => 'contrib_' + slug(c.name)));
    const lines = [head.join(',')];
    model.data.kpi.forEach((k, i) => lines.push([model.data.dates[i], k, model.fitted[i].toFixed(1), model.decomp.base[i].toFixed(1)].concat(model.decomp.media.map((m) => m[i].toFixed(1))).join(',')));
    return lines.join('\n') + '\n';
  }

  // ---------- readout ----------
  function fmtMoney(v, currency) {
    if (!Number.isFinite(v)) return '—';
    if (currency === 'INR') {
      const a = Math.abs(v);
      if (a >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr';
      if (a >= 1e5) return '₹' + (v / 1e5).toFixed(1) + ' L';
      return '₹' + Math.round(v).toLocaleString('en-IN');
    }
    return 'A$' + Math.round(v).toLocaleString('en-AU');
  }
  function readout(model, currency, opt) {
    const m = model.metrics, ch = model.channels.slice().sort((a, b) => b.mroi - a.mroi);
    const L = [];
    L.push('# Marketing mix readout');
    L.push('');
    L.push('**Model quality:** R² ' + m.r2.toFixed(2) + ', NRMSE ' + (m.nrmse * 100).toFixed(1) + '%' + (m.holdoutMape != null ? ', holdout error (MAPE) ' + (m.holdoutMape * 100).toFixed(1) + '% on the last ' + m.holdoutWeeks + ' weeks' : '') + '.');
    const totalMedia = sum(model.channels.map((c) => c.contribution)), totalKpi = sum(model.data.kpi);
    L.push('**Paid media drove about ' + ((totalMedia / totalKpi) * 100).toFixed(0) + '% of the KPI** over ' + m.weeks + ' weeks; the rest is base demand (organic, brand, seasonality, events).');
    L.push('');
    L.push('## Channel verdicts (marginal ROI at current weekly spend)');
    ch.forEach((c) => {
      L.push('- **' + c.name + ': ' + c.verdict + '.** Average ROI ' + c.roi.toFixed(2) + (c.roiLow != null ? ' (80% range ' + c.roiLow.toFixed(2) + '–' + c.roiHigh.toFixed(2) + ')' : '') + ', next-dollar ROI ' + c.mroi.toFixed(2) + ', cost per incremental KPI ' + fmtMoney(c.costPerIncremental, currency) + '. ' + Math.round(c.spendShare * 100) + '% of spend vs ' + Math.round(c.effectShare * 100) + '% of media effect; carry-over ' + Math.round(c.decay * 100) + '% a week.');
    });
    if (opt) {
      L.push('');
      L.push('## Budget reallocation (same weekly budget ' + fmtMoney(sum(opt.alloc) + opt.unspent, currency) + ')');
      opt.perChannel.forEach((p) => L.push('- ' + p.name + ': ' + fmtMoney(p.current, currency) + ' → ' + fmtMoney(p.proposed, currency) + (p.change != null ? ' (' + (p.change >= 0 ? '+' : '') + Math.round(p.change * 100) + '%)' : '')));
      L.push('- Modelled incremental KPI: ' + opt.currentIncremental.toFixed(0) + ' → ' + opt.optimizedIncremental.toFixed(0) + ' a week (' + (opt.upliftPct >= 0 ? '+' : '') + (opt.upliftPct * 100).toFixed(1) + '%).');
    }
    L.push('');
    L.push('## Caveats');
    L.push('- MMM is correlational. Validate the biggest moves with a geo holdout or platform lift test before shifting more than ~20% of a channel.');
    L.push('- Curves outside the historical spend range are extrapolations.');
    return L.join('\n');
  }

  return {
    rng, gauss, mean, sum, quantile, adstock, hill, channelFeature, spendNorm, ridgeNN, fitModel, response, marginal,
    recentSpend, verdict, optimizeBudget, responseCurve, liftCheck, generateSynthetic, MARKETS, parseCSV, toCSV, decompCSV,
    readout, fmtMoney, isoWeek, r2, mape, nrmse, DECAYS, KS,
  };
});
