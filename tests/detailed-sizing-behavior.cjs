const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
}).outputText, filename);
const { recommendAllColors, reviewedSizeData } = require('../src/lib/detailed-sizes.ts');
const fits = ['closer', 'regular', 'relaxed'];
const fixture = d => ({ id: d.id, name: d.name, sizes: d.sizes, examples: [], note: '', active: true, revision: 1, updated_at: '', photo_count: 1 });
const input = (height, weight, fit = 'regular', reference = {}) => ({ height, weight, fit, reference, lengthPreference: 'standard' });
let checks = 0, calls = 0;
const run = (p, x) => { calls++; return recommendAllColors(p, x); };
const ordering = (d, answers, context) => {
  for (const regular of answers[1]) {
    const ordered = answers.map(rs => rs.find(r => r.colorId === regular.colorId));
    if (ordered.every(r => r.size)) {
      const ranks = ordered.map(r => d.sizes.indexOf(r.size));
      assert.ok(ranks[0] <= ranks[1] && ranks[1] <= ranks[2], `${d.key} ${context}: ${ordered.map(r => r.size)}`);
      checks++;
    }
  }
};
for (const d of reviewedSizeData.products) {
  const p = fixture(d);
  // Recheck the entire source, not just a hand-picked subset of examples.
  for (const r of d.rules) {
    const actual = run(p, { ...input(r.height, r.weight, r.fit, r.reference), lengthPreference: r.lengthPreference });
    for (const a of actual.filter(a => !r.colors.length || r.colors.includes(a.colorId))) {
      const expected = r.manual && r.reason?.includes('грудь') ? null : r.size;
      assert.equal(a.size, expected, `${d.key} ${r.id} ${a.colorId}`); checks++;
    }
  }
  for (let h = 150; h <= 200; h += 5) {
    let previous = [];
    for (let w = 40; w <= 120; w++) {
      const answers = fits.map(f => run(p, input(h, w, f)));
      ordering(d, answers, `${h}/${w}`);
      if (previous.length) for (let f = 0; f < fits.length; f++) for (const a of answers[f]) {
        const before = previous[f].find(b => b.colorId === a.colorId);
        if (a.size && before?.size) {
          assert.ok(d.sizes.indexOf(a.size) >= d.sizes.indexOf(before.size), `${d.key} ${fits[f]} ${h}/${w-1}->${w}: ${before.size}->${a.size}`); checks++;
        }
      }
      previous = answers;
    }
  }
  for (const row of d.rows) {
    const ref = Object.fromEntries(Object.entries(row.measures).filter(([k]) => ['shoulders', 'chest', 'halfWaist'].includes(k)).map(([k, v]) => [k, (v[0] + v[1]) / 2]));
    ordering(d, fits.map(f => run(p, input(183, 78, f, ref))), `reference ${row.tag}`);
  }
}
const byKey = new Map(reviewedSizeData.products.map(d => [d.key, fixture(d)]));
const best = byKey.get('best-distress-shirt');
assert.deepEqual(fits.map(f => run(best, input(175, 80, f))[0].size), ['XL', '2XL', '2XL']); checks++;
assert.deepEqual(fits.map(f => run(best, input(175, 70, f))[0].size), ['L', 'XL', '2XL']); checks++;
const cold = byKey.get('black-cold-gray-longsleeve');
assert.equal(run(cold, input(185, 85))[0].size, 'XL'); checks++;
assert.equal(run(cold, input(183, 78))[0].size, 'L'); checks++;
const huge = byKey.get('huge-pants');
assert.equal(run(huge, input(165, 73))[0].size, '2XL'); checks++;
const shirt = byKey.get('old-textured-collar-shirt');
for (const f of fits) { assert.equal(run(shirt, input(180, 100, f, { chest: 60 }))[0].basis, 'incompatible'); checks++; }
// Same shoulders but different chest, and the same chest with different fit.
const wood = byKey.get('wooden-buttons-longsleeve');
assert.equal(run(wood, input(178, 60, 'regular', { shoulders: 44, chest: 50 }))[0].size, 'S');
assert.equal(run(wood, input(178, 60, 'relaxed', { shoulders: 44, chest: 50 }))[0].size, 'M');
assert.notEqual(run(wood, input(178, 60, 'regular', { shoulders: 44, chest: 58 }))[0].size, 'S'); checks += 3;
console.log(`PASS ${checks} behavior checks across ${reviewedSizeData.products.length} products; ${calls} recommendation calls. Fit order, neighboring weights, all source rules, measurements and actual volume limits. Not a claim of physical fitting accuracy.`);
