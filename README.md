# Build Plan for Slatemaker

**Live demo:** https://mohith26.github.io/slate-auto-build-plan/

An unofficial concept feature for Slate's configurator: a **Build Plan** tab that turns a design into a month-by-month purchase plan on a monthly budget. Every part can go on the truck the day it arrives (whatever it requires is already installed), parts that only work together arrive together, and the parts you star as must-haves come first.

Unofficial concept demo by Mohith Gajjela. Not affiliated with Slate Auto. Public data from slate.auto: the 46 Starter Packs, their prices and the accessory rules (`requires`, `requiresAnyOf`, `incompatibleWith`) published in the store page, captured Nov 10, 2026 (`scripts/extract_catalog.py`). Monthly budget and default priorities are my assumptions.

## Why

Slate's pitch is a $24,950 truck you "accessorize over time" ("add, upgrade, or swap whenever you want"), and its own FAQ asks "I overdid it on accessories. How can I make my build more affordable?" A Starter Pack can carry $5,000 to $10,000 of accessories, and the catalog has real dependencies: Front Fog Lights need the Front Bumper Upgrade and the Five Switch; the A/T tires need the Lift Kit; a 20" wheel set and its tires require each other. Buy in the order the parts are listed (or cheapest first) on a monthly budget and some parts sit in the garage waiting for the part they need.

## How it works (`core/buildplan.js`)

1. **Rules.** `requiresAnyOf` is a list of alternatives. Otherwise `requires` is grouped by category family: parts of the same family are alternatives (a wheel needs the stock tire *or* the KO2 tire), different families are all needed (fog lights need a bumper *and* a switch). Body style and stock wheels/tires come with the vehicle.
2. **Bundles.** Parts that require each other are strongly connected components (Tarjan) and are bought together.
3. **Order.** With money arriving at B per month, a part's arrival time is its cumulative price / B, so ordering parts to minimize priority-weighted arrival time under requirements is the scheduling problem 1|prec|Σ w_j C_j. I use Sidney decomposition: repeatedly take the requirement-closed set with the highest priority per dollar, found exactly by parametric max-weight closure (min cut, Dinic), and order inside it by ratio. It is optimal for series-parallel requirement graphs and a 2-approximation in general; an exact subset DP confirms it is optimal on all 34 packs small enough to check.
4. **Months.** Savings accumulate; whole bundles are bought as soon as savings cover them, in plan order.

## Results (public data, $250/month, `node scripts/report.cjs`)

* Across the 27 Starter Packs that contain must-have parts, must-haves go on the truck **5.3 months sooner** on average than buying in list order (7.3 vs 12.6 months).
* Buying in list order leaves parts waiting for a prerequisite in **18 of 46** packs (cheapest first: 21); the plan: 0.
* The Professional (21 parts, $5,369.85): must-haves in 10.2 months on average vs 12.4 in list order, which also buys the Front Fog Lights two months before the Five Switch they need and the 20" tires five months before their wheel set ($1,300 of parts waiting).
* At $400/month: 3.1 months sooner, 16 of 46 packs strand parts in list order.

## Honest limitations

* **Rule semantics are inferred.** The published fields do not say whether a multi-item `requires` means "all" or "any"; the category-family rule fits every case I checked by hand, but Slate's configurator may resolve some differently.
* **Prices TBA.** Up to 9 items per pack (Lift Kit, seat covers, key fob caps...) had no listed price on Nov 10; they count as $0 and are shown separately unless another part needs them.
* **Priorities are a default by category** (functional parts are must-haves, wraps and lights "want soon", small trim "whenever"); stars change them and the plan re-solves instantly.
* No installation scheduling, shipping times, stock, or financing; one budget per month, no carry-in savings at delivery.
* Starter Pack vehicle choice (truck, SUV, Fastback) is treated as bought with the vehicle.

## Novelty

Slatemaker lets you design, save and buy accessories, and Slate offers a vehicle payment estimator and accessory financing at purchase. I found no Slate feature (or third-party tool such as slatemod.com's build calculator, which totals cost and payload) that sequences accessory purchases over time against the catalog's requirement rules.

## Run

```
node --test test/buildplan.test.cjs   # 6 tests
node scripts/report.cjs [budget] [pack]
```

Static page, no build step: `index.html`, `styles.css`, `app.js`, `core/buildplan.js`, `data/packs.js`. Slate's web font and product images are loaded from slate.auto / Slate's CDN. URL params: `?pack=the-professional&budget=250`.
