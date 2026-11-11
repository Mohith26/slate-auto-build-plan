"""Extract Slate's public starter packs and the accessory rules they use from a saved copy of
https://www.slate.auto/en/store?catalog=accessories (rendered DOM; Next.js flight data).

Usage: python3 scripts/extract_catalog.py store.html > data/packs.json
Captured Nov 10 2026. Public catalog data only (names, prices, requires / incompatibleWith rules)."""
import json, re, sys

html = open(sys.argv[1]).read()
chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
full = ''.join(json.loads(c) for c in chunks)

def grab(pat):
    out = []
    for m in re.finditer(pat, full):
        i = m.start(); depth = 0; j = i; ins = False; esc = False
        while j < len(full):
            c = full[j]
            if ins:
                if esc: esc = False
                elif c == '\\': esc = True
                elif c == '"': ins = False
            else:
                if c == '"': ins = True
                elif c == '{': depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0: break
            j += 1
        try: out.append(json.loads(full[i:j + 1]))
        except Exception: pass
    return out

packs = {p['slug']: p for p in grab(r'\{"accessoryIds":\[')}
catalog = grab(r'\{"giftProductSkus":')
ids = {}
for o in catalog:
    for k in ('configuratorId', 'id', 'key', 'sku'):
        if o.get(k): ids.setdefault(o[k], o)

def rule(o):
    return {'requires': o.get('requires') or [], 'requiresAnyOf': o.get('requiresAnyOf') or [],
            'incompatibleWith': o.get('incompatibleWith') or []}

needed = set()
out_packs = []
for p in packs.values():
    items = []
    prices = {a['id']: a.get('priceCents') for a in p.get('accessoryItems', [])}
    for a in p['accessoryIds']:
        o = ids.get(a, {})
        pc = prices.get(a, o.get('priceCents'))
        items.append({'id': a, 'name': o.get('name', a), 'category': o.get('category'),
                      'priceCents': pc if isinstance(pc, int) else None,
                      'difficulty': o.get('difficulty'), 'image': o.get('imageUrl')})
        needed.add(a)
    out_packs.append({'slug': p['slug'], 'name': p['name'].strip(), 'image': (p.get('image') or {}).get('url'),
                      'vehicle': [v['id'] for v in p.get('vehicleItems', [])], 'items': items,
                      'totalPriceCents': p.get('totalPriceCents')})
# rules for every pack item and everything those rules mention
frontier = set(needed)
rules = {}
while frontier:
    k = frontier.pop()
    o = ids.get(k)
    if not o or k in rules: continue
    rules[k] = dict(rule(o), name=o.get('name'), category=o.get('category'),
                    priceCents=o.get('priceCents') if isinstance(o.get('priceCents'), int) else None)
    for r in rules[k]['requires'] + [x for g in rules[k]['requiresAnyOf'] for x in g]:
        if r not in rules: frontier.add(r)
json.dump({'source': 'https://www.slate.auto/en/store?catalog=accessories (public, captured 2026-11-10)',
           'packs': out_packs, 'rules': rules}, sys.stdout, indent=0)
