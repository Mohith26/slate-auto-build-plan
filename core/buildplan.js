/*
 * Build Plan core: turn a Slate design into a month-by-month purchase plan on a monthly budget, where every
 * part can be installed the day it arrives (its requirements are already on the truck) and the parts you care
 * about most arrive first.
 *
 * Scheduling view: money arrives at B per month, so a part's purchase time is its cumulative price / B. Ordering
 * parts to minimize priority-weighted arrival time under "requires" constraints is 1|prec|sum w_j C_j. We solve it
 * with Sidney decomposition (repeatedly take the requirement-closed set with the highest priority-per-dollar,
 * found by parametric max-weight closure / min cut), which is optimal for series-parallel requirement graphs and
 * a 2-approximation in general; an exact subset DP checks it on small designs.
 * Works in the browser (window.BuildPlan) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BuildPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Parts every Slate starts with (truck body, stock wheels and tires).
  var BASE = ['TB009', 'STOCK_WHEEL', 'STOCK_TIRE'];
  // Body kits are listed as full vehicle prices; bought later they cost the difference to the truck
  // ($29,950 / $31,950 vs $24,950, per Slate's published pricing).
  var KIT_PRICE = { 'TB009-SUV': 500000, 'TB009-Fastback': 700000 };
  // Categories that are alternatives for one another when they appear together in a requires list.
  var FAMILY = { roof_rack_partial: 'rack', roof_rack_full: 'rack', tower_rack: 'rack', roof_t_rail: 'rack' };
  var PRIORITY = {
    3: ['suspension', 'wheel', 'tire', 'front_bumper', 'rear_bumper', 'roof_rack_partial', 'roof_rack_full', 'tower_rack',
      'bed_topper', 'bed_topper_sm', 'bed_floor_accessory', 'bed_wall_accessory', 'bed_t_rail', 'tailgate_accessory', 'tailgate_accessory_attachment',
      'hitch_accessory', 'side_step', 'spare_tire_carrier', 'front_fog_lights', 'body_type', 'body_kit', 'roof_t_rail', 'exterior_t_rail',
      'interior_t_rail', 'molle_accessory', 'roof_rack_accessory', 'window_power_kit', 'locking_tailgate', 'hv_charge_cable', 'ccs_to_nacs_adapter'],
    2: ['wrap', 'partial_wrap', 'partial_wrap_lower', 'partial_wrap_upper', 'partial_wrap_roof', 'signature_design_full',
      'signature_design_partial_lower', 'signature_design_partial_upper', 'front_lights', 'rear_lights', 'rock_lights', 'bed_light', 'grille',
      'multibutton', 'bluetooth_controls', 'center_console', 'front_center_speaker', 'front_side_speakers', 'integrated_front_center_speaker',
      't_rail_speakers', 'tablet_mount', 'seat_cover', 'climate_controls', 'telematics_module', 'fender_flares', 'pedal_kit',
      '2nd_row_floor_mats', 'front_floor_mats', 'frunk_floor_mats', 'SUV_cargo_floor_mats', 'frunk_upper_accessory', 'door_cubby', 'doors']
  };
  function defaultPriority(cat) { if (PRIORITY[3].indexOf(cat) >= 0) return 3; if (PRIORITY[2].indexOf(cat) >= 0) return 2; return 1; }

  // ------------------------------------------------------------ requirement clauses
  // requiresAnyOf (when present) is a list of alternatives, each a list of parts that must all be present.
  // Otherwise `requires` lists parts grouped by category family: same family = alternatives, families = all needed.
  function clauses(id, rules) {
    var r = rules[id]; if (!r) return [];
    if (r.requiresAnyOf && r.requiresAnyOf.length) return [{ kind: 'dnf', options: r.requiresAnyOf.map(function (g) { return g.slice(); }) }];
    var groups = {}, order = [];
    (r.requires || []).forEach(function (q) {
      var c = rules[q] ? rules[q].category : q, f = FAMILY[c] || c || q;
      if (!groups[f]) { groups[f] = []; order.push(f); }
      groups[f].push(q);
    });
    return order.map(function (f) { return { kind: 'any', options: groups[f].map(function (q) { return [q]; }) }; });
  }

  // Build the planning problem for a design: parts, prices, priorities, and in-design prerequisites.
  function prepare(design, rules, opt) {
    opt = opt || {};
    var base = {}; BASE.concat(design.vehicle || []).forEach(function (k) { base[k] = true; });
    var inDesign = {}; design.items.forEach(function (it) { inDesign[it.id] = true; });
    var parts = [], idx = {}, flags = [];
    design.items.forEach(function (it) {
      if (base[it.id]) return;
      var price = KIT_PRICE[it.id] != null ? KIT_PRICE[it.id] : it.priceCents;
      var p = { id: it.id, name: it.name, category: it.category, difficulty: it.difficulty, image: it.image,
        price: price == null ? 0 : price, priceKnown: price != null,
        priority: opt.priority && opt.priority[it.id] != null ? opt.priority[it.id] : defaultPriority(it.category), prereq: [] };
      idx[p.id] = parts.length; parts.push(p);
      if (price == null) flags.push({ id: p.id, name: p.name, issue: 'price not listed yet' });
    });
    function priceOf(k) { var i = idx[k]; return i == null ? Infinity : parts[i].price; }
    parts.forEach(function (p) {
      clauses(p.id, rules).forEach(function (cl) {
        var best = null, bestCost = Infinity;
        for (var o = 0; o < cl.options.length; o++) {
          var opt2 = cl.options[o], ok = true, need = [], cost = 0;
          for (var j = 0; j < opt2.length; j++) {
            var q = opt2[j];
            if (base[q]) continue;
            if (inDesign[q] && idx[q] != null) { need.push(q); cost += priceOf(q); } else { ok = false; break; }
          }
          if (ok && cost < bestCost) { best = need; bestCost = cost; }
        }
        if (best == null) flags.push({ id: p.id, name: p.name, issue: 'needs one of ' + cl.options.map(function (g) { return g.join(' + '); }).join(' or ') + ', not in this design' });
        else best.forEach(function (q) { if (p.prereq.indexOf(idx[q]) < 0 && idx[q] !== idx[p.id]) p.prereq.push(idx[q]); });
      });
    });
    return { parts: parts, flags: flags, bundles: bundle(parts) };
  }

  // Parts that require each other (e.g. a wheel set and its tire set) must arrive together: strongly connected
  // components of the requirement graph become bundles; bundles form a DAG.
  function bundle(parts) {
    var n = parts.length, index = 0, stack = [], on = [], ids = [], low = [], comp = new Array(n).fill(-1), comps = [];
    for (var i = 0; i < n; i++) { ids[i] = -1; on[i] = false; }
    function dfs(v) {
      ids[v] = low[v] = index++; stack.push(v); on[v] = true;
      parts[v].prereq.forEach(function (w) {
        if (ids[w] === -1) { dfs(w); low[v] = Math.min(low[v], low[w]); } else if (on[w]) low[v] = Math.min(low[v], ids[w]);
      });
      if (low[v] === ids[v]) { var c = []; var w; do { w = stack.pop(); on[w] = false; comp[w] = comps.length; c.push(w); } while (w !== v); comps.push(c); }
    }
    for (var s = 0; s < n; s++) if (ids[s] === -1) dfs(s);
    return comps.map(function (members, b) {
      var pre = {};
      members.forEach(function (m) { parts[m].prereq.forEach(function (q) { if (comp[q] !== b) pre[comp[q]] = true; }); });
      var w = 0, p = 0; members.forEach(function (m) { w += parts[m].priority * Math.max(parts[m].price, 1); p += parts[m].price; });
      // weight = priority x price: a part's importance scales with what it is; ratio = priority per dollar
      return { id: b, members: members, prereq: Object.keys(pre).map(Number), weight: w, price: p };
    });
  }

  // ------------------------------------------------------------ max-weight closure (min cut, Dinic)
  function maxClosure(nodes, bundles, val) {
    // nodes: list of bundle ids; closure must contain the prerequisites (within nodes) of every member.
    var n = nodes.length, S = n, T = n + 1, N = n + 2, pos = {}, INF = 1e18;
    nodes.forEach(function (b, i) { pos[b] = i; });
    var head = new Array(N).fill(-1), to = [], cap = [], nxt = [];
    function add(u, v, c) { to.push(v); cap.push(c); nxt.push(head[u]); head[u] = to.length - 1; to.push(u); cap.push(0); nxt.push(head[v]); head[v] = to.length - 1; }
    nodes.forEach(function (b, i) {
      var v = val(b);
      if (v > 0) add(S, i, v); else if (v < 0) add(i, T, -v);
      bundles[b].prereq.forEach(function (q) { if (pos[q] != null) add(i, pos[q], INF); });
    });
    var level = new Array(N), it = new Array(N);
    function bfs() { level.fill(-1); var q = [S]; level[S] = 0; for (var h = 0; h < q.length; h++) { var u = q[h]; for (var e = head[u]; e !== -1; e = nxt[e]) if (cap[e] > 1e-9 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; q.push(to[e]); } } return level[T] >= 0; }
    function dfs(u, f) { if (u === T) return f; for (; it[u] !== -1; it[u] = nxt[it[u]]) { var e = it[u], v = to[e]; if (cap[e] > 1e-9 && level[v] === level[u] + 1) { var d = dfs(v, Math.min(f, cap[e])); if (d > 0) { cap[e] -= d; cap[e ^ 1] += d; return d; } } } return 0; }
    while (bfs()) { for (var i2 = 0; i2 < N; i2++) it[i2] = head[i2]; while (dfs(S, INF) > 1e-9) { /* augment */ } }
    // source side of the residual graph = maximum closure
    var seen = new Array(N).fill(false), q2 = [S]; seen[S] = true;
    for (var h2 = 0; h2 < q2.length; h2++) { var u2 = q2[h2]; for (var e2 = head[u2]; e2 !== -1; e2 = nxt[e2]) if (cap[e2] > 1e-9 && !seen[to[e2]]) { seen[to[e2]] = true; q2.push(to[e2]); } }
    return nodes.filter(function (b, i) { return seen[i]; });
  }

  // Requirement-closed subset of `nodes` with the highest weight / price (Sidney's ratio-maximal initial set).
  function bestInitialSet(nodes, bundles) {
    var free = nodes.filter(function (b) { return bundles[b].price === 0 && bundles[b].prereq.every(function (q) { return nodes.indexOf(q) < 0; }); });
    if (free.length) return [free[0]];
    var lo = 0, hi = 0;
    nodes.forEach(function (b) { if (bundles[b].price > 0) hi = Math.max(hi, bundles[b].weight / bundles[b].price); });
    hi = hi * 1.0001 + 1e-9;
    var best = null;
    for (var k = 0; k < 50; k++) {
      var lam = (lo + hi) / 2;
      var cl = maxClosure(nodes, bundles, function (b) { return bundles[b].weight - lam * bundles[b].price; });
      var val = 0; cl.forEach(function (b) { val += bundles[b].weight - lam * bundles[b].price; });
      if (cl.length && val > 1e-6) { lo = lam; best = cl; } else hi = lam;
    }
    if (!best || !best.length) {
      // all ratios equal: take any available bundle
      var avail = nodes.filter(function (b) { return bundles[b].prereq.every(function (q) { return nodes.indexOf(q) < 0; }); });
      best = [avail[0]];
    }
    return best;
  }

  // Order inside a block: highest ratio among bundles whose prerequisites are already placed.
  function listOrder(block, bundles, placed) {
    var out = [], left = block.slice();
    while (left.length) {
      var avail = left.filter(function (b) { return bundles[b].prereq.every(function (q) { return placed[q] || block.indexOf(q) < 0 && placed[q] !== false; }); });
      if (!avail.length) avail = left.slice();
      avail.sort(function (a, b) { return bundles[b].weight / Math.max(1, bundles[b].price) - bundles[a].weight / Math.max(1, bundles[a].price) || a - b; });
      var x = avail[0]; out.push(x); placed[x] = true; left.splice(left.indexOf(x), 1);
    }
    return out;
  }

  function sidneyOrder(bundles) {
    var remaining = bundles.map(function (b) { return b.id; }), order = [], placed = {};
    while (remaining.length) {
      var I = bestInitialSet(remaining, bundles);
      var seq = I.length === 1 ? I : listOrder(I, bundles, placed);
      seq.forEach(function (b) { placed[b] = true; order.push(b); });
      remaining = remaining.filter(function (b) { return I.indexOf(b) < 0; });
    }
    return order;
  }

  // Exact optimum of sum_j w_j C_j (continuous money time) by DP over requirement-closed subsets; small designs only.
  function exactOrder(bundles) {
    var n = bundles.length; if (n > 18) return null;
    var full = (1 << n) - 1, preMask = bundles.map(function (b) { var m = 0; b.prereq.forEach(function (q) { m |= 1 << q; }); return m; });
    var cost = new Float64Array(1 << n).fill(Infinity), from = new Int32Array(1 << n).fill(-1), spent = new Float64Array(1 << n);
    cost[0] = 0;
    for (var m = 0; m <= full; m++) {
      if (cost[m] === Infinity) continue;
      for (var j = 0; j < n; j++) {
        if (m & (1 << j) || (preMask[j] & m) !== preMask[j]) continue;
        var nm = m | (1 << j), t = spent[m] + bundles[j].price, c = cost[m] + bundles[j].weight * t;
        if (c < cost[nm] - 1e-9) { cost[nm] = c; from[nm] = j; spent[nm] = t; }
      }
    }
    var ord = [], cur = full; while (cur) { var j2 = from[cur]; ord.unshift(j2); cur &= ~(1 << j2); }
    return ord;
  }
  function weightedCost(order, bundles) { var t = 0, c = 0; order.forEach(function (b) { t += bundles[b].price; c += bundles[b].weight * t; }); return c; }

  // ------------------------------------------------------------ month-by-month simulation
  // Money arrives at `budget` per month (month 1 = first month after delivery). Parts are bought in the given
  // order as soon as savings cover them. A part is installed when it and all of its prerequisites are owned.
  // `groups`: list of arrays of part indices bought together (a plan buys whole bundles; a naive order buys parts).
  function simulate(prob, groups, budget) {
    var parts = prob.parts, owned = {}, buy = {}, inst = {}, savings = 0, m = 0, i = 0, guard = 0, comp = {};
    prob.bundles.forEach(function (b) { b.members.forEach(function (x) { comp[x] = b.id; }); });
    function cost(g) { var c = 0; g.forEach(function (k) { c += parts[k].price; }); return c; }
    while (i < groups.length && guard++ < 5000) {
      m++; savings += budget;
      while (i < groups.length && cost(groups[i]) <= savings + 1e-9) {
        savings -= cost(groups[i]); groups[i].forEach(function (k) { buy[k] = m; owned[k] = true; }); i++;
      }
      // a part goes on the truck once it and its prerequisites are owned (prerequisites outside its bundle installed)
      var changed = true;
      while (changed) {
        changed = false;
        for (var j = 0; j < parts.length; j++) {
          if (!owned[j] || inst[j] != null) continue;
          var ok = parts[j].prereq.every(function (q) { return owned[q] && (inst[q] != null || comp[q] === comp[j]); });
          if (ok) { inst[j] = m; changed = true; }
        }
      }
    }
    var w = 0, wm = 0, waitDollarMonths = 0, waiting = [];
    parts.forEach(function (p, j) {
      var at = inst[j] != null ? inst[j] : Infinity;
      w += p.priority; wm += p.priority * (isFinite(at) ? at : m);
      var wait = (isFinite(at) ? at : m) - buy[j];
      if (wait > 0) { waitDollarMonths += p.price / 100 * wait; waiting.push({ id: p.id, name: p.name, months: wait, price: p.price, bought: buy[j], installed: inst[j] }); }
    });
    var byPriority = {}; [1, 2, 3].forEach(function (pr) {
      var s2 = 0, c = 0; parts.forEach(function (p, j) { if (p.priority === pr) { s2 += inst[j]; c++; } }); byPriority[pr] = c ? s2 / c : null;
    });
    return { buy: buy, install: inst, months: m, weightedMonth: wm / Math.max(1, w), waitDollarMonths: waitDollarMonths, waiting: waiting, byPriority: byPriority };
  }

  function expand(prob, bundleOrder) { return bundleOrder.map(function (b) { return prob.bundles[b].members.slice().sort(function (x, y) { return x - y; }); }); }

  function plan(design, rules, opt) {
    opt = opt || {};
    var prob = prepare(design, rules, opt), budget = opt.budget || 30000;
    var ord = sidneyOrder(prob.bundles);
    var cart = prob.parts.map(function (p, i) { return [i]; });
    var cheap = cart.slice().sort(function (a, b) { return prob.parts[a[0]].price - prob.parts[b[0]].price || a[0] - b[0]; });
    var res = {
      problem: prob, budget: budget,
      plan: simulate(prob, expand(prob, ord), budget), planGroups: expand(prob, ord),
      cart: simulate(prob, cart, budget), cheapest: simulate(prob, cheap, budget),
      total: prob.parts.reduce(function (s, p) { return s + p.price; }, 0)
    };
    var ex = exactOrder(prob.bundles);
    if (ex) res.gap = weightedCost(ord, prob.bundles) / Math.max(1e-9, weightedCost(ex, prob.bundles)) - 1;
    return res;
  }

  // Every starter pack at one budget: how often the listing order leaves parts waiting, and the months saved.
  function survey(data, budget) {
    return data.packs.map(function (d) {
      var r = plan(d, data.rules, { budget: budget });
      return { slug: d.slug, name: d.name, parts: r.problem.parts.length, total: r.total, months: r.plan.months,
        planWeighted: r.plan.weightedMonth, cartWeighted: r.cart.weightedMonth, cheapWeighted: r.cheapest.weightedMonth,
        cartWaiting: r.cart.waiting.length, cartWaitDollarMonths: r.cart.waitDollarMonths, cheapWaiting: r.cheapest.waiting.length,
        planWaiting: r.plan.waiting.length, p3plan: r.plan.byPriority[3], p3cart: r.cart.byPriority[3], gap: r.gap, flags: r.problem.flags.length };
    });
  }

  return { BASE: BASE, KIT_PRICE: KIT_PRICE, defaultPriority: defaultPriority, clauses: clauses, prepare: prepare, bundle: bundle,
    maxClosure: maxClosure, bestInitialSet: bestInitialSet, sidneyOrder: sidneyOrder, exactOrder: exactOrder, weightedCost: weightedCost,
    simulate: simulate, expand: expand, plan: plan, survey: survey };
});
