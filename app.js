/* Build Plan tab. Every number is computed here by core/buildplan.js from Slate's public Starter Pack data. */
(function () {
  'use strict';
  var BP = window.BuildPlan, D = window.SLATE_DATA, t0 = performance.now();
  var qs = new URLSearchParams(location.search);
  var BUDGETS = [15000, 25000, 40000, 60000];
  var state = {
    slug: D.packs.some(function (p) { return p.slug === qs.get('pack'); }) ? qs.get('pack') : 'the-professional',
    budget: BUDGETS.indexOf(+qs.get('budget') * 100) >= 0 ? +qs.get('budget') * 100 : 25000,
    priority: {}
  };
  var $ = function (id) { return document.getElementById(id); };
  var usd = function (c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var usd2 = function (c) { return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var mo = function (x) { return x == null ? '-' : (Math.round(x * 10) / 10).toFixed(1); };
  var PRI = { 3: 'Must-have', 2: 'Want soon', 1: 'Whenever' };
  var surveyCache = {};
  function pack() { return D.packs.find(function (p) { return p.slug === state.slug; }); }

  // chips: monthly budget
  var chips = $('chips');
  BUDGETS.forEach(function (b) {
    var c = document.createElement('button'); c.className = 'chip'; c.textContent = usd(b); c.setAttribute('data-b', b);
    c.addEventListener('click', function () { state.budget = b; sync(); render(); });
    chips.appendChild(c);
  });
  // pack select
  var sel = $('packSel');
  D.packs.forEach(function (p) { var o = document.createElement('option'); o.value = p.slug; o.textContent = p.name + ' · ' + p.items.length + ' items'; sel.appendChild(o); });
  sel.addEventListener('change', function () { state.slug = sel.value; state.priority = {}; sync(); render(); });
  function sync() { var u = new URL(location.href); u.searchParams.set('pack', state.slug); u.searchParams.set('budget', state.budget / 100); history.replaceState(null, '', u); }

  function render() {
    var p = pack(), r = BP.plan(p, D.rules, { budget: state.budget, priority: state.priority }), prob = r.problem;
    sel.value = state.slug;
    document.querySelectorAll('.chip[data-b]').forEach(function (c) { c.classList.toggle('on', +c.getAttribute('data-b') === state.budget); });
    $('packImg').src = p.image; $('inspoImg').src = p.image;
    $('packName').textContent = p.name;
    $('packSub').textContent = prob.parts.length + ' parts · ' + usd(r.total) + ' in accessories · ' + usd(state.budget) + '/month';

    // compare cards
    var plans = [['Build Plan', r.plan, true], ['List order', r.cart, false], ['Cheapest first', r.cheapest, false]];
    $('compare').innerHTML = plans.map(function (x) {
      var s = x[1], w = s.waiting.length;
      return '<div class="cmp' + (x[2] ? ' me' : '') + '"><div class="t">' + x[0] + '</div><div class="v">' + mo(s.byPriority[3]) + '<small>months</small></div>' +
        '<div class="n">average wait for must-have parts</div><div class="n ' + (w ? 'warn' : '') + '" style="margin-top:6px">' +
        (w ? w + ' part' + (w > 1 ? 's' : '') + ' bought before what ' + (w > 1 ? 'they need' : 'it needs') + ' (' + usd(s.waiting.reduce(function (a, q) { return a + q.price; }, 0)) + ' sitting in the garage)' : 'Every part goes on the day it arrives') + '</div></div>';
    }).join('');

    // months
    var byMonth = {}, tbaParts = [];
    prob.parts.forEach(function (q, j) {
      if (!q.priceKnown && !prob.parts.some(function (o) { return o.prereq.indexOf(j) >= 0; })) { tbaParts.push(j); return; }
      var m = r.plan.buy[j]; (byMonth[m] = byMonth[m] || []).push(j);
    });
    var reason = {};
    prob.parts.forEach(function (q, j) { q.prereq.forEach(function (k) { (reason[k] = reason[k] || []).push(q.name); }); });
    function card(title, js, right) {
      return '<div class="month"><div class="mh"><b>' + title + '</b><span>' + right + '</span></div>' +
        js.map(function (j) {
          var q = prob.parts[j], why = [];
          if (q.prereq.length) why.push('needs ' + q.prereq.map(function (k) { return prob.parts[k].name; }).join(' + '));
          if (reason[j]) why.push('unlocks ' + reason[j].slice(0, 2).join(', '));
          if (q.difficulty >= 3) why.push(q.difficulty >= 4 ? 'pro install' : 'harder DIY');
          var stars = [1, 2, 3].map(function (s) { return '<button data-id="' + q.id + '" data-s="' + s + '" class="' + (s <= q.priority ? 'on' : '') + '" title="' + PRI[s] + '" aria-label="' + PRI[s] + '">★</button>'; }).join('');
          return '<div class="part"><img src="' + (q.image || '') + '" alt="" loading="lazy"><div><div class="nm">' + q.name + (q.priceKnown ? '' : '<span class="tag tba">Price TBA</span>') + '</div><div class="why">' + PRI[q.priority] + (why.length ? ' · ' + why.join(' · ') : '') + '</div></div>' +
            '<div class="stars">' + stars + '</div><div class="pr">' + (q.priceKnown ? usd2(q.price) : '-') + '</div></div>';
        }).join('') + '</div>';
    }
    $('months').innerHTML = Object.keys(byMonth).map(Number).sort(function (a, b) { return a - b; }).map(function (m) {
      var js = byMonth[m], spend = js.reduce(function (a, j) { return a + prob.parts[j].price; }, 0);
      return card('Month ' + m, js, js.length + ' part' + (js.length > 1 ? 's' : '') + ' · ' + usd2(spend) + ' · saved ' + usd(m * state.budget - spentThrough(m)) + ' after');
    }).join('') + (tbaParts.length ? card('When prices are listed', tbaParts, tbaParts.length + ' part' + (tbaParts.length > 1 ? 's' : '') + ' · price TBA') : '');
    function spentThrough(m) { var c = 0; prob.parts.forEach(function (q, j) { if (r.plan.buy[j] <= m) c += q.price; }); return c; }
    $('months').querySelectorAll('.stars button').forEach(function (b) {
      b.addEventListener('click', function () { state.priority[b.getAttribute('data-id')] = +b.getAttribute('data-s'); render(); });
    });
    var tba = prob.flags.filter(function (f) { return f.issue === 'price not listed yet'; }).length, other = prob.flags.filter(function (f) { return f.issue !== 'price not listed yet'; });
    $('flagsNote').textContent = (tba ? tba + ' part' + (tba > 1 ? 's have' : ' has') + ' no listed price yet and count as $0. ' : '') +
      (other.length ? other.map(function (f) { return f.name + ' ' + f.issue + '.'; }).join(' ') + ' ' : '') +
      'Stars set priority; the plan reorders instantly. Parts that require each other (a wheel set and its tires) are bought together.';

    // timeline under the viewer
    var tl = $('tl'), maxM = Math.max(r.plan.months, r.cart.months), html = '';
    [['Build Plan', r.plan, '#0a0a0a'], ['List order', r.cart, '#a7a7a7']].forEach(function (x, i) {
      html += '<div class="lbl" style="top:' + (i * 26) + 'px">' + x[0] + '</div><div class="row" style="top:' + (i * 26) + 'px">';
      prob.parts.forEach(function (q, j) {
        if (q.priority !== 3) return;
        var m = x[1].install[j]; if (m == null) return;
        html += '<span class="seg" style="left:calc(' + ((m - 1) / maxM * 100) + '% );width:calc(' + (100 / maxM) + '% - 2px);background:' + (x[1].waiting.some(function (w) { return w.id === q.id; }) ? '#b3261e' : x[2]) + ';opacity:.85" title="' + q.name + ' · month ' + m + '"></span>';
      });
      html += '</div>';
    });
    html += '<div class="ax"><span>Month 1</span><span style="float:right">Month ' + maxM + '</span></div>';
    tl.innerHTML = html;

    // survey across packs (default priorities)
    var sv = surveyCache[state.budget] || (surveyCache[state.budget] = BP.survey(D, state.budget));
    $('svBudget').textContent = usd(state.budget);
    $('survey').querySelector('tbody').innerHTML = sv.map(function (s) {
      return '<tr data-s="' + s.slug + '" class="' + (s.slug === state.slug ? 'sel' : '') + '"><td>' + s.name + '</td><td class="n">' + s.parts + '</td><td class="n">' + usd(s.total) + '</td><td class="n">' + mo(s.p3plan) + '</td><td class="n">' + mo(s.p3cart) + '</td><td class="n">' + (s.cartWaiting || '-') + '</td></tr>';
    }).join('');
    $('survey').querySelectorAll('tbody tr').forEach(function (tr) { tr.addEventListener('click', function () { state.slug = tr.getAttribute('data-s'); state.priority = {}; sync(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }); });
    var withP3 = sv.filter(function (s) { return s.p3plan != null; });
    var gain = withP3.reduce(function (a, s) { return a + (s.p3cart - s.p3plan); }, 0) / Math.max(1, withP3.length);
    var stranded = sv.filter(function (s) { return s.cartWaiting > 0; }).length;
    $('surveyNote').textContent = 'Across the ' + withP3.length + ' packs with must-have parts, the plan puts them on the truck ' + gain.toFixed(1) + ' months sooner on average than list order. List order leaves parts waiting for a prerequisite in ' + stranded + ' of ' + sv.length + ' packs; the plan never does.';

    $('sumTitle').textContent = 'Plan summary (' + prob.parts.length + ')';
    $('sumSub').textContent = usd(r.total) + ' over ' + r.plan.months + ' months at ' + usd(state.budget) + '/month · must-haves in ' + mo(r.plan.byPriority[3]) + ' months on average';
  }
  render();
  console.log('Build Plan computed in ' + Math.round(performance.now() - t0) + ' ms');
})();
