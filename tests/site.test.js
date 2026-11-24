const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/site.js');

test('pricing: monthly and annual (20% off) in INR and AUD', () => {
  assert.deepEqual(S.price('growth', 'INR', 'monthly'), { perMonth: 39999, billed: 39999, saving: 0 });
  const a = S.price('starter', 'AUD', 'annual');
  assert.equal(a.perMonth, 279); assert.equal(a.billed, 279 * 12); assert.equal(a.saving, 70 * 12);
  assert.throws(() => S.price('nope', 'INR', 'monthly'));
  assert.equal(S.fmt(39999, 'INR'), '₹39,999');
});

test('lead validation flags missing and invalid fields', () => {
  const e = S.validateLead({ name: 'A', email: 'bad', company: '', spend: '' });
  assert.deepEqual(Object.keys(e).sort(), ['company', 'email', 'name', 'spend']);
  assert.deepEqual(S.validateLead({ name: 'Priya', email: 'priya@tallyo.app', company: 'Tallyo', spend: '25lto1cr' }), {});
});

test('lead scoring rewards fit and tiers correctly', () => {
  const hot = S.scoreLead({ email: 'priya@tallyo.app', spend: '25lto1cr', channels: 5, history: 30, role: 'Head of Growth' }, 'INR');
  assert.equal(hot.score, 100); assert.match(hot.tier, /^Hot/);
  const cold = S.scoreLead({ email: 'a@gmail.com', spend: 'lt10k', channels: 1, history: 3, role: 'Intern' }, 'AUD');
  assert.equal(cold.score, 0); assert.match(cold.tier, /^Nurture/);
});

test('UTM parsing and dataLayer tracking', () => {
  assert.deepEqual(S.parseUtm('?utm_source=linkedin&utm_medium=social&x=1'), { utm_source: 'linkedin', utm_medium: 'social' });
  const w = {}; S.track('generate_lead', { lead_score: 80 }, w);
  assert.deepEqual(w.dataLayer, [{ event: 'generate_lead', lead_score: 80 }]);
});
