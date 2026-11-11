const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const B = require(path.join(__dirname, '..', 'core', 'buildplan.js'));
const data = require(path.join(__dirname, '..', 'data', 'packs.json'));
const pack = (slug) => data.packs.find((p) => p.slug === slug);

test('requirement semantics: same-category alternatives, cross-category all needed, requiresAnyOf as alternatives', () => {
  const fog = B.clauses('EL003', data.rules);           // Front Fog Lights: bumper AND five-switch
  assert.equal(fog.length, 2);
  const wheels = B.clauses('W008_BRONZE', data.rules);  // 17" wheel set: stock tire OR KO2 tire
  assert.equal(wheels.length, 1); assert.equal(wheels[0].options.length, 2);
  const mats = B.clauses('ACCIA005', data.rules);       // SUV mats: requiresAnyOf alternatives
  assert.equal(mats[0].kind, 'dnf'); assert.ok(mats[0].options.length >= 3);
});

test('mutually required parts (wheel set + tire set) become one bundle', () => {
  const prob = B.prepare(pack('the-professional'), data.rules);
  const ids = (b) => b.members.map((m) => prob.parts[m].id).sort();
  const wheelBundle = prob.bundles.find((b) => b.members.some((m) => prob.parts[m].id === 'W010_SILVER'));
  assert.deepEqual(ids(wheelBundle), ['20_MODERN', 'W010_SILVER']);
});

test('max-weight closure equals brute force on random DAGs', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let rep = 0; rep < 60; rep++) {
    const n = 2 + Math.floor(rnd() * 9);
    const bundles = []; for (let i = 0; i < n; i++) { const pre = []; for (let j = 0; j < i; j++) if (rnd() < 0.25) pre.push(j); bundles.push({ id: i, prereq: pre }); }
    const val = bundles.map(() => Math.round((rnd() - 0.5) * 100));
    const nodes = bundles.map((b) => b.id);
    const got = B.maxClosure(nodes, bundles, (b) => val[b]).reduce((s, b) => s + val[b], 0);
    let best = 0;
    for (let m = 0; m < (1 << n); m++) {
      let ok = true, s = 0; for (let i = 0; i < n; i++) if (m & (1 << i)) { s += val[i]; for (const q of bundles[i].prereq) if (!(m & (1 << q))) ok = false; }
      if (ok) best = Math.max(best, s);
    }
    assert.equal(got, best);
  }
});

test('Sidney order matches the exact DP optimum on every starter pack small enough to solve exactly', () => {
  let checked = 0;
  for (const p of data.packs) {
    const prob = B.prepare(p, data.rules);
    const ex = B.exactOrder(prob.bundles); if (!ex) continue;
    const sid = B.sidneyOrder(prob.bundles);
    const a = B.weightedCost(sid, prob.bundles), b = B.weightedCost(ex, prob.bundles);
    assert.ok(a <= b * (1 + 1e-9), `${p.slug}: ${a} vs ${b}`);
    checked++;
  }
  assert.ok(checked >= 20, 'checked ' + checked);
});

test('a plan never buys a part before what it needs; listing order sometimes does', () => {
  let cartWaits = 0;
  for (const p of data.packs) {
    const r = B.plan(p, data.rules, { budget: 25000 });
    assert.equal(r.plan.waiting.length, 0, p.slug);
    r.problem.parts.forEach((q, j) => q.prereq.forEach((k) => assert.ok(r.plan.install[k] <= r.plan.install[j], p.slug + ' ' + q.id)));
    if (r.cart.waiting.length) cartWaits++;
    // budget is respected: cumulative spend by month m never exceeds m * budget
    const spentBy = {}; r.problem.parts.forEach((q, j) => { spentBy[r.plan.buy[j]] = (spentBy[r.plan.buy[j]] || 0) + q.price; });
    let cum = 0; Object.keys(spentBy).map(Number).sort((x, y) => x - y).forEach((m) => { cum += spentBy[m]; assert.ok(cum <= m * 25000 + 1e-6); });
  }
  assert.ok(cartWaits > 0);
});

test('survey numbers are internally consistent', () => {
  const s = B.survey(data, 25000);
  assert.equal(s.length, 46);
  s.forEach((r) => { assert.equal(r.planWaiting, 0); if (r.p3plan != null) assert.ok(r.p3plan <= r.p3cart + 1e-9, r.slug); });
});
