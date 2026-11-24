(function () {
  const M = window.MMM, S = window.Site;
  const $ = (id) => document.getElementById(id);
  const COLORS = ['#7c9cff', '#40d9a8', '#ffb547', '#ff6b81', '#c08cff', '#4fd1ff', '#f4e04d', '#9be564'];
  const BASE_COLOR = '#3a4170';
  const st = { data: null, synthetic: true, currency: 'INR', model: null, opt: null };
  const dbg = $('debug');
  if (/debug=1/.test(location.search)) { dbg.style.display = 'block'; window.__onTrack = (p) => { const d = document.createElement('div'); d.textContent = JSON.stringify(p); dbg.prepend(d); }; }
  const money = (v) => M.fmtMoney(v, st.currency);
  const n0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-IN') : '—');
  const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function status(t, bad) { $('status').textContent = t; $('status').style.color = bad ? 'var(--bad)' : 'var(--accent2)'; }

  function loadSynthetic() {
    const mk = $('market').value, seed = Number($('seed').value) || 99;
    st.data = M.generateSynthetic(mk, { seed }); st.synthetic = true; st.currency = st.data.currency;
    $('value').value = st.data.valuePerKpi;
    status('Loaded synthetic Tallyo data: ' + st.data.kpi.length + ' weeks, ' + st.data.channels.length + ' channels (' + mk + ', seed ' + seed + ').');
    S.track('load_demo', { market: mk, seed });
  }

  function run() {
    if (!st.data) loadSynthetic();
    const btn = $('run'); btn.disabled = true; status('Fitting… searching carry-over and saturation for each channel.');
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const value = Number($('value').value);
        if (!(value > 0)) throw new Error('Enter a margin per subscriber above 0.');
        st.model = M.fitModel(st.data, { valuePerKpi: value, targetRoi: Number($('target').value) || 1, bootstrap: Number($('boot').value) });
        const ms = Math.round(performance.now() - t0);
        status('Model fitted in ' + ms + ' ms.');
        render();
        S.track('model_fit', { weeks: st.model.metrics.weeks, channels: st.data.channels.length, r2: +st.model.metrics.r2.toFixed(3), holdout_mape: st.model.metrics.holdoutMape != null ? +st.model.metrics.holdoutMape.toFixed(3) : null, synthetic: st.synthetic, ms });
      } catch (e) { status(e.message, true); S.track('model_error', { message: e.message }); }
      btn.disabled = false;
    }, 30);
  }

  function render() {
    const m = st.model; $('out').style.display = 'block';
    const totalSpend = M.sum(m.channels.map((c) => c.spend)), totalMedia = M.sum(m.channels.map((c) => c.contribution));
    $('kpis').innerHTML = [
      ['R² (all weeks)', m.metrics.r2.toFixed(2)],
      ['Holdout error (MAPE)', m.metrics.holdoutMape != null ? pct(m.metrics.holdoutMape) : '—'],
      ['Media-driven share of KPI', pct(totalMedia / M.sum(m.data.kpi))],
      ['Blended cost per incremental', money(totalSpend / totalMedia)],
    ].map((k) => '<div class="card kpi"><div class="v">' + k[1] + '</div><div class="l">' + k[0] + '</div></div>').join('');
    drawFit(); drawDecomp(); drawShare(); drawCurves(); renderTable(); renderTruth();
    $('lift-ch').innerHTML = m.channels.map((c, j) => '<option value="' + j + '">' + esc(c.name) + '</option>').join('');
    $('lift-out').innerHTML = '';
    const cur = M.sum(m.channels.map((c) => c.currentWeekly));
    $('budget').value = Math.round(cur);
    optimise(true);
  }

  function renderTable() {
    const m = st.model, boot = m.bootstrap > 0;
    let h = '<tr><th>Channel</th><th>Spend</th><th>Spend share</th><th>Effect share</th><th>Incremental KPI</th><th>Cost / incremental</th><th>ROI' + (boot ? ' (80% range)' : '') + '</th><th>Next-dollar ROI</th><th>Carry-over</th><th>Half-saturation /wk</th><th>Verdict</th></tr>';
    m.channels.forEach((c) => {
      h += '<tr><td>' + esc(c.name) + '</td><td>' + money(c.spend) + '</td><td>' + pct(c.spendShare) + '</td><td>' + pct(c.effectShare) + '</td><td>' + n0(c.contribution) + '</td><td>' + money(c.costPerIncremental) + '</td><td>' + c.roi.toFixed(2) + (boot ? ' <span class="muted">(' + c.roiLow.toFixed(2) + '–' + c.roiHigh.toFixed(2) + ')</span>' : '') + '</td><td>' + c.mroi.toFixed(2) + '</td><td>' + Math.round(c.decay * 100) + '%</td><td>' + money(c.halfSat) + '</td><td><span class="pill ' + c.verdict + '">' + c.verdict + '</span></td></tr>';
    });
    $('tbl').innerHTML = h;
  }

  function renderTruth() {
    const card = $('truth-card');
    if (!st.synthetic || !st.data.truth) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const m = st.model;
    let h = '<tr><th>Channel</th><th>True ROI</th><th>Model ROI</th><th>Gap</th><th>True carry-over</th><th>Model</th></tr>';
    st.data.truth.forEach((t, j) => {
      const c = m.channels[j], gap = c.roi / t.roi - 1;
      h += '<tr><td>' + esc(t.name) + '</td><td>' + t.roi.toFixed(2) + '</td><td>' + c.roi.toFixed(2) + '</td><td style="color:' + (Math.abs(gap) <= 0.25 ? 'var(--accent2)' : 'var(--warn)') + '">' + (gap >= 0 ? '+' : '') + Math.round(gap * 100) + '%</td><td>' + Math.round(t.decay * 100) + '%</td><td>' + Math.round(c.decay * 100) + '%</td></tr>';
    });
    $('truth').innerHTML = h;
  }

  function optimise(silent) {
    const m = st.model; $('opt-err').textContent = '';
    try {
      const budget = Number($('budget').value), lo = Number($('minpct').value) / 100, hi = Number($('maxpct').value) / 100;
      if (!(budget > 0)) throw new Error('Enter a weekly budget above 0.');
      if (!(hi >= lo)) throw new Error('Maximum must be at least the minimum.');
      const bounds = m.channels.map((c) => [c.currentWeekly * lo, Math.max(c.currentWeekly * hi, c.currentWeekly * lo)]);
      st.opt = M.optimizeBudget(m, budget, bounds);
      const o = st.opt;
      let h = '<tr><th>Channel</th><th>Current /wk</th><th>Proposed /wk</th><th>Change</th><th>Incremental /wk</th><th>Next-dollar ROI after</th></tr>';
      o.perChannel.forEach((p) => { h += '<tr><td>' + esc(p.name) + '</td><td>' + money(p.current) + '</td><td>' + money(p.proposed) + '</td><td style="color:' + (p.change >= 0 ? 'var(--accent2)' : 'var(--bad)') + '">' + (p.change == null ? '—' : (p.change >= 0 ? '+' : '') + Math.round(p.change * 100) + '%') + '</td><td>' + p.incremental.toFixed(0) + '</td><td>' + p.mroi.toFixed(2) + '</td></tr>'; });
      $('opt-tbl').innerHTML = h;
      const v = m.opts.valuePerKpi, curSpend = M.sum(o.current);
      $('opt-sum').innerHTML = [
        ['Incremental subscribers /wk', o.currentIncremental.toFixed(0) + ' → ' + o.optimizedIncremental.toFixed(0) + ' (' + (o.upliftPct >= 0 ? '+' : '') + (o.upliftPct * 100).toFixed(1) + '%)'],
        ['Cost per incremental', money(o.currentCost) + ' → ' + money(o.optimizedCost)],
        ['Extra margin a year (modelled)', money((o.optimizedIncremental * v - M.sum(o.alloc)) * 52 - (o.currentIncremental * v - curSpend) * 52)],
      ].map((k) => '<div class="card kpi"><div class="v" style="font-size:20px">' + k[1] + '</div><div class="l">' + k[0] + '</div></div>').join('') + (o.unspent > 1 ? '<p class="note">' + money(o.unspent) + ' a week left unspent: every channel hit its maximum.</p>' : '');
      $('readout').value = M.readout(m, st.currency, o);
      if (!silent) S.track('budget_optimise', { budget, uplift_pct: +(o.upliftPct * 100).toFixed(1), min_pct: lo * 100, max_pct: hi * 100 });
    } catch (e) { $('opt-err').textContent = e.message; $('readout').value = M.readout(m, st.currency, null); }
  }

  // ---------- charts ----------
  function ctx(id) {
    const c = $(id), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = Number(c.getAttribute('height'));
    c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g, w, h, pad: { l: 56, r: 12, t: 12, b: 26 } };
  }
  function axes(C, ymax, xlabels, yfmt) {
    const { g, w, h, pad } = C; g.strokeStyle = '#2b3263'; g.fillStyle = '#a3a9d1'; g.font = '11px system-ui'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ((h - pad.t - pad.b) * i) / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
      g.textAlign = 'right'; g.fillText((yfmt || n0)(ymax * (1 - i / 4)), pad.l - 6, y + 4);
    }
    if (xlabels) { g.textAlign = 'center'; xlabels.forEach((l) => g.fillText(l.t, l.x, h - 8)); }
  }
  const sx = (C, i, n) => C.pad.l + ((C.w - C.pad.l - C.pad.r) * i) / Math.max(1, n - 1);
  const sy = (C, v, ymax) => C.pad.t + (C.h - C.pad.t - C.pad.b) * (1 - v / ymax);
  function dateLabels(C, dates) { const n = dates.length, out = []; const step = Math.ceil(n / 6); for (let i = 0; i < n; i += step) out.push({ x: sx(C, i, n), t: String(dates[i]).slice(0, 7) }); return out; }
  function line(C, arr, ymax, color, w, startIdx, n) {
    const { g } = C; g.strokeStyle = color; g.lineWidth = w || 2; g.beginPath();
    arr.forEach((v, i) => { const x = sx(C, (startIdx || 0) + i, n || arr.length), y = sy(C, v, ymax); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  function drawFit() {
    const m = st.model, C = ctx('c-fit'), n = m.data.kpi.length;
    const ymax = Math.max(...m.data.kpi, ...m.fitted) * 1.08;
    if (m.holdout.rows.length) { C.g.fillStyle = 'rgba(255,181,71,.08)'; const x0 = sx(C, m.holdout.rows[0], n); C.g.fillRect(x0, C.pad.t, C.w - C.pad.r - x0, C.h - C.pad.t - C.pad.b); }
    axes(C, ymax, dateLabels(C, m.data.dates));
    line(C, m.data.kpi, ymax, '#eef0ff', 1.5); line(C, m.fitted, ymax, '#7c9cff', 2);
    if (m.holdout.rows.length) line(C, m.holdout.pred, ymax, '#ffb547', 2, m.holdout.rows[0], n);
  }
  function drawDecomp() {
    const m = st.model, C = ctx('c-decomp'), n = m.data.kpi.length, g = C.g;
    const layers = [m.decomp.base].concat(m.decomp.media);
    const tops = m.data.kpi.map((_, i) => M.sum(layers.map((l) => Math.max(0, l[i]))));
    const ymax = Math.max(...tops) * 1.08; axes(C, ymax, dateLabels(C, m.data.dates));
    const cum = new Array(n).fill(0);
    layers.forEach((l, k) => {
      const lower = cum.slice(); l.forEach((v, i) => { cum[i] += Math.max(0, v); });
      g.fillStyle = k === 0 ? BASE_COLOR : COLORS[(k - 1) % COLORS.length]; g.globalAlpha = 0.9; g.beginPath();
      for (let i = 0; i < n; i++) { const x = sx(C, i, n), y = sy(C, cum[i], ymax); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      for (let i = n - 1; i >= 0; i--) g.lineTo(sx(C, i, n), sy(C, lower[i], ymax));
      g.closePath(); g.fill(); g.globalAlpha = 1;
    });
    $('lg-decomp').innerHTML = '<span><i style="background:' + BASE_COLOR + '"></i>Base</span>' + m.data.channels.map((c, j) => '<span><i style="background:' + COLORS[j % COLORS.length] + '"></i>' + esc(c.name) + '</span>').join('');
  }
  function drawShare() {
    const m = st.model, C = ctx('c-share'), g = C.g, J = m.channels.length;
    const ymax = Math.max(...m.channels.map((c) => Math.max(c.spendShare, c.effectShare))) * 1.15;
    const slot = (C.w - C.pad.l - C.pad.r) / J, bw = Math.min(28, slot / 3);
    axes(C, ymax, m.channels.map((c, j) => ({ x: C.pad.l + slot * (j + 0.5), t: c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name })), (v) => Math.round(v * 100) + '%');
    m.channels.forEach((c, j) => {
      const x = C.pad.l + slot * (j + 0.5);
      [[c.spendShare, '#5b6299', -bw - 2], [c.effectShare, '#40d9a8', 2]].forEach(([v, col, off]) => { g.fillStyle = col; const y = sy(C, v, ymax); g.fillRect(x + off, y, bw, C.h - C.pad.b - y); });
    });
  }
  function drawCurves() {
    const m = st.model, C = ctx('c-curves'), g = C.g;
    const curves = m.channels.map((c, j) => M.responseCurve(m, j, 3, 50));
    const xmax = Math.max(...curves.map((cv) => cv[cv.length - 1].spend)), ymax = Math.max(...curves.flat().map((p) => p.incremental)) * 1.1 || 1;
    axes(C, ymax, [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: C.pad.l + (C.w - C.pad.l - C.pad.r) * f, t: money(xmax * f) })));
    const X = (v) => C.pad.l + ((C.w - C.pad.l - C.pad.r) * v) / xmax;
    curves.forEach((cv, j) => {
      g.strokeStyle = COLORS[j % COLORS.length]; g.lineWidth = 2; g.beginPath();
      cv.forEach((p, i) => { const x = X(p.spend), y = sy(C, p.incremental, ymax); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      const cur = m.channels[j].currentWeekly; g.fillStyle = COLORS[j % COLORS.length]; g.beginPath(); g.arc(X(cur), sy(C, M.response(m, j, cur), ymax), 4, 0, 7); g.fill();
    });
    $('lg-curves').innerHTML = m.channels.map((c, j) => '<span><i style="background:' + COLORS[j % COLORS.length] + '"></i>' + esc(c.name) + '</span>').join('');
  }

  // ---------- events ----------
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  $('run').addEventListener('click', run);
  $('regen').addEventListener('click', () => { loadSynthetic(); run(); });
  $('market').addEventListener('change', () => { loadSynthetic(); run(); });
  $('opt').addEventListener('click', () => optimise(false));
  $('lift').addEventListener('click', () => {
    const j = Number($('lift-ch').value), cost = Number($('lift-cost').value);
    if (!(cost > 0)) { $('lift-out').innerHTML = '<div class="err">Enter the test cost per incremental subscriber.</div>'; return; }
    const r = M.liftCheck(st.model, j, cost);
    const col = r.status === 'Agrees' ? 'Scale' : r.status.includes('optimistic') ? 'Trim' : 'Hold';
    $('lift-out').innerHTML = '<p><span class="pill ' + col + '">' + r.status + '</span> Model ' + money(r.modelCost) + ' vs test ' + money(r.testCost) + ' per incremental (ratio ' + r.ratio.toFixed(2) + ').</p><p class="note">' + (r.status === 'Agrees' ? 'Within ±30%. Keep using the model for this channel.' : 'Outside ±30%. Trust the experiment, and tighten the prior on this channel or rerun with more weeks of varied spend.') + '</p>';
    S.track('lift_check', { channel: r.channel, status: r.status });
  });
  $('file').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((txt) => {
      try { st.data = M.parseCSV(txt); st.synthetic = false; status('Loaded ' + f.name + ': ' + st.data.kpi.length + ' weeks, ' + st.data.channels.length + ' channels. Set the margin per KPI, then fit.'); S.track('csv_upload', { weeks: st.data.kpi.length, channels: st.data.channels.length }); run(); }
      catch (err) { status(err.message, true); S.track('csv_error', { message: err.message }); }
    });
    e.target.value = '';
  });
  $('dl-data').addEventListener('click', () => { if (!st.data) loadSynthetic(); download('mixwise-data.csv', M.toCSV(st.data), 'text/csv'); S.track('file_download', { file: 'data_csv' }); });
  $('dl-decomp').addEventListener('click', () => { if (st.model) { download('mixwise-decomposition.csv', M.decompCSV(st.model), 'text/csv'); S.track('file_download', { file: 'decomp_csv' }); } });
  $('dl-md').addEventListener('click', () => { download('mixwise-readout.md', $('readout').value, 'text/markdown'); S.track('file_download', { file: 'readout_md' }); });
  $('copy').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText($('readout').value); $('copy').textContent = 'Copied'; setTimeout(() => ($('copy').textContent = 'Copy'), 1200); S.track('readout_copy', {}); });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (st.model) { drawFit(); drawDecomp(); drawShare(); drawCurves(); } }, 150); });

  S.track('page_view_enriched', Object.assign({ page: 'demo' }, S.parseUtm(location.search)));
  loadSynthetic(); run();
})();
