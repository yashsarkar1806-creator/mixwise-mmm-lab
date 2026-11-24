(function () {
  const S = window.Site;
  const state = { currency: 'INR', billing: 'monthly', utm: S.parseUtm(location.search) };
  const dbg = document.getElementById('debug');
  if (/debug=1/.test(location.search)) { dbg.style.display = 'block'; window.__onTrack = (p) => { const d = document.createElement('div'); d.textContent = JSON.stringify(p); dbg.prepend(d); }; }

  // A/B headline test (sticky per visitor)
  const variants = {
    A: 'Your ad platforms all claim the same subscriber. Find out which channel actually earned it.',
    B: 'Move 20% of your ad budget to where it actually works.',
    C: 'Marketing mix modelling without the data-science team.',
  };
  let v = localStorage.getItem('mw_hl');
  const forced = new URLSearchParams(location.search).get('hl');
  if (forced && variants[forced]) v = forced;
  if (!v || !variants[v]) { v = 'ABC'[Math.floor(Math.random() * 3)]; localStorage.setItem('mw_hl', v); }
  document.getElementById('headline').textContent = variants[v];
  S.track('experiment_view', { experiment: 'hero_headline', variant: v });
  S.track('page_view_enriched', Object.assign({ page: 'landing' }, state.utm));

  document.querySelectorAll('[data-cta]').forEach((a) => a.addEventListener('click', () => S.track('cta_click', { cta: a.dataset.cta, variant: v })));

  function renderPlans() {
    const el = document.getElementById('plans');
    el.innerHTML = S.PLANS.map((p) => {
      const pr = S.price(p.id, state.currency, state.billing);
      return '<div class="card' + (p.id === 'growth' ? ' hl' : '') + '"><h3>' + p.name + (p.id === 'growth' ? ' <span class="pill Scale">Most picked</span>' : '') + '</h3>' +
        '<div class="price">' + S.fmt(pr.perMonth, state.currency) + '<span class="muted" style="font-size:15px;font-weight:500">/mo</span></div>' +
        '<div class="muted" style="font-size:13px">' + (state.billing === 'annual' ? 'Billed ' + S.fmt(pr.billed, state.currency) + ' a year, save ' + S.fmt(pr.saving, state.currency) : 'Billed monthly') + '</div>' +
        '<ul class="muted"><li>Up to ' + p.channels + ' channels</li><li>' + p.refresh + '</li><li>' + p.seats + ' seats</li></ul>' +
        '<a class="btn ' + (p.id === 'growth' ? '' : 'ghost') + '" href="#pilot" data-plan="' + p.id + '">Start with ' + p.name + '</a></div>';
    }).join('');
    el.querySelectorAll('[data-plan]').forEach((a) => a.addEventListener('click', () => S.track('select_plan', { plan: a.dataset.plan, currency: state.currency, billing: state.billing })));
    const sel = document.getElementById('f-spend');
    sel.innerHTML = '<option value="">Choose…</option>' + S.SPEND_BANDS[state.currency].map((b) => '<option value="' + b[0] + '">' + b[1] + '</option>').join('');
  }
  document.querySelectorAll('#cur button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#cur button').forEach((x) => x.classList.toggle('on', x === b));
    state.currency = b.dataset.c; renderPlans(); S.track('currency_toggle', { currency: state.currency });
  }));
  document.querySelectorAll('#bill button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#bill button').forEach((x) => x.classList.toggle('on', x === b));
    state.billing = b.dataset.b; renderPlans(); S.track('billing_toggle', { billing: state.billing });
  }));
  renderPlans();

  let started = false;
  const form = document.getElementById('leadform');
  form.addEventListener('focusin', () => { if (!started) { started = true; S.track('form_start', { form: 'pilot' }); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const errs = S.validateLead(f);
    form.querySelectorAll('[data-e]').forEach((el) => { el.textContent = errs[el.dataset.e] || ''; });
    if (Object.keys(errs).length) { S.track('form_error', { fields: Object.keys(errs).join(',') }); return; }
    const sc = S.scoreLead(f, state.currency);
    const r = document.getElementById('result');
    r.style.display = 'block';
    r.innerHTML = '<div class="kpi"><div class="v">' + sc.score + '/100</div><div class="l">' + sc.tier + '</div></div><p class="muted">Why: ' + sc.why.join(', ') + '.</p>' +
      (Object.keys(state.utm).length ? '<p class="note">Attribution captured: ' + Object.entries(state.utm).map((x) => x.join('=')).join(', ') + '</p>' : '') +
      '<p class="note">Nothing was sent. This concept form scores your fit in the browser only.</p>';
    S.track('generate_lead', Object.assign({ lead_score: sc.score, tier: sc.tier.split(':')[0], currency: state.currency, variant: v }, state.utm));
  });
})();
