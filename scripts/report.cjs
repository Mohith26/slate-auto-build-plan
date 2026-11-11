// Prints the numbers on the page. Usage: node scripts/report.cjs [budgetDollars] [packSlug]
const path = require('path');
const B = require(path.join(__dirname, '..', 'core', 'buildplan.js'));
const data = require(path.join(__dirname, '..', 'data', 'packs.json'));
const budget = (process.argv[2] ? +process.argv[2] : 250) * 100, slug = process.argv[3] || 'the-professional';
const s = B.survey(data, budget);
const withP3 = s.filter((r) => r.p3plan != null);
const gain = withP3.reduce((a, r) => a + (r.p3cart - r.p3plan), 0) / withP3.length;
console.log(`$${budget / 100}/month, ${s.length} Starter Packs (${withP3.length} with must-have parts)`);
console.log(`must-haves sooner than list order: ${gain.toFixed(1)} months on average; plan p3 avg ${(withP3.reduce((a, r) => a + r.p3plan, 0) / withP3.length).toFixed(1)} vs list ${(withP3.reduce((a, r) => a + r.p3cart, 0) / withP3.length).toFixed(1)}`);
console.log(`list order leaves parts waiting in ${s.filter((r) => r.cartWaiting > 0).length} of ${s.length} packs; cheapest-first in ${s.filter((r) => r.cheapWaiting > 0).length}; plan in ${s.filter((r) => r.planWaiting > 0).length}`);
const gaps = s.filter((r) => r.gap != null);
console.log(`exact DP check on ${gaps.length} packs: max gap ${(Math.max(...gaps.map((r) => r.gap)) * 100).toFixed(3)}%`);
const p = data.packs.find((x) => x.slug === slug), r = B.plan(p, data.rules, { budget });
const f = (x) => (x == null ? '-' : x.toFixed(1));
console.log(`${p.name}: ${r.problem.parts.length} parts, $${(r.total / 100).toFixed(2)}, ${r.plan.months} months`);
for (const [k, v] of [['plan', r.plan], ['list order', r.cart], ['cheapest first', r.cheapest]]) console.log(`  ${k}: must-haves ${f(v.byPriority[3])} mo, waiting ${v.waiting.length} parts ($${(v.waiting.reduce((a, q) => a + q.price, 0) / 100).toFixed(0)})`);
