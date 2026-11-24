/* Mixwise landing-page logic: pricing, lead scoring, UTM capture, GA4-style events. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Site = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PLANS = [
    { id: 'starter', name: 'Starter', monthly: { INR: 14999, AUD: 349 }, channels: 5, refresh: 'Monthly model refresh', seats: 2 },
    { id: 'growth', name: 'Growth', monthly: { INR: 39999, AUD: 899 }, channels: 12, refresh: 'Weekly refresh + budget optimiser + lift-test calibration', seats: 6 },
    { id: 'scale', name: 'Scale', monthly: { INR: 89999, AUD: 1999 }, channels: 30, refresh: 'Weekly refresh, geo-test design, analyst hours', seats: 20 },
  ];
  const ANNUAL_DISCOUNT = 0.2;

  function price(planId, currency, billing) {
    const p = PLANS.find((x) => x.id === planId);
    if (!p) throw new Error('Unknown plan ' + planId);
    const m = p.monthly[currency];
    if (m == null) throw new Error('Unknown currency ' + currency);
    if (billing === 'annual') { const perMonth = Math.round(m * (1 - ANNUAL_DISCOUNT)); return { perMonth, billed: perMonth * 12, saving: (m - perMonth) * 12 }; }
    return { perMonth: m, billed: m, saving: 0 };
  }
  function fmt(v, currency) { return currency === 'INR' ? '₹' + Math.round(v).toLocaleString('en-IN') : 'A$' + Math.round(v).toLocaleString('en-AU'); }

  /** Monthly paid media spend bands (in local currency) used for fit scoring. */
  const SPEND_BANDS = {
    INR: [['lt5l', 'Under ₹5 L', 0], ['5to25l', '₹5–25 L', 20], ['25lto1cr', '₹25 L–1 Cr', 35], ['gt1cr', 'Over ₹1 Cr', 30]],
    AUD: [['lt10k', 'Under A$10k', 0], ['10to50k', 'A$10–50k', 20], ['50to200k', 'A$50–200k', 35], ['gt200k', 'Over A$200k', 30]],
  };
  const FREE_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'rediffmail.com'];

  function validateLead(f) {
    const errors = {};
    if (!f.name || f.name.trim().length < 2) errors.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email || '')) errors.email = 'Enter a valid work email.';
    if (!f.company || f.company.trim().length < 2) errors.company = 'Enter your company.';
    if (!f.spend) errors.spend = 'Pick a spend band.';
    return errors;
  }
  function scoreLead(f, currency) {
    let s = 0; const why = [];
    const band = (SPEND_BANDS[currency] || SPEND_BANDS.INR).find((b) => b[0] === f.spend);
    if (band) { s += band[2]; if (band[2] >= 20) why.push('spend band fits MMM (' + band[1] + ')'); else why.push('spend too low for MMM yet'); }
    const ch = Number(f.channels) || 0;
    if (ch >= 4) { s += 20; why.push(ch + ' paid channels'); } else if (ch >= 2) { s += 10; why.push(ch + ' paid channels'); }
    const hist = Number(f.history) || 0;
    if (hist >= 24) { s += 20; why.push(hist + ' months of history'); } else if (hist >= 12) { s += 10; why.push('enough history for a first model'); }
    const domain = String(f.email || '').split('@')[1] || '';
    if (domain && !FREE_DOMAINS.includes(domain.toLowerCase())) { s += 10; why.push('work email'); }
    if (/head|lead|director|vp|founder|cmo|growth|manager/i.test(f.role || '')) { s += 15; why.push('decision-maker role'); }
    s = Math.min(100, s);
    const tier = s >= 70 ? 'Hot: book design-partner call' : s >= 40 ? 'Warm: send sample readout' : 'Nurture: send MMM-readiness checklist';
    return { score: s, tier, why };
  }
  function parseUtm(search) {
    const p = new URLSearchParams(search || '');
    const out = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => { const v = p.get(k); if (v) out[k] = v.slice(0, 100); });
    return out;
  }
  function track(event, params, w) {
    w = w || (typeof window !== 'undefined' ? window : null);
    const payload = Object.assign({ event }, params || {});
    if (w) { w.dataLayer = w.dataLayer || []; w.dataLayer.push(payload); if (w.__onTrack) w.__onTrack(payload); }
    return payload;
  }
  return { PLANS, ANNUAL_DISCOUNT, price, fmt, SPEND_BANDS, validateLead, scoreLead, parseUtm, track };
});
