const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
}).outputText, filename);
const { recommendAllColors, reviewedSizeData } = require('../src/lib/detailed-sizes.ts');
const byKey = new Map(reviewedSizeData.products.map(p => [p.key, p]));
const product = key => {
  const d = byKey.get(key);
  return { id: d.id, name: d.name, sizes: d.sizes, examples: d.rules.filter(r => r.source === 'catalog').map(r => ({height:r.height,weight:r.weight,fit:r.fit==='closer'?'tight':r.fit==='relaxed'?'loose':'regular',size:r.size})), note: '', active: true, revision: 1, updated_at: '', photo_count: 1 };
};
const input = (height, weight, extra = {}) => ({ height, weight, fit: 'regular', lengthPreference: 'standard', ...extra });
let checks = 0;
function expect(key, parameters, expected, color) {
  const result = recommendAllColors(product(key), parameters);
  const selected = color ? result.find(r => r.colorId === color) : result[0];
  assert.ok(selected, `${key}: missing color ${color}`);
  assert.equal(selected.size, expected, `${key} ${JSON.stringify(parameters)} ${color ?? ''}: ${JSON.stringify(selected)}`);
  checks++; return selected;
}
for (const d of reviewedSizeData.products) {
  assert.ok(d.id && d.rules.length);
  for (const row of d.rows) for (const range of Object.values(row.measures)) assert.ok(range[0] <= range[1]);
  assert.ok(!d.rules.some(r => r.size && !d.sizes.includes(r.size)));
}
// Same input, three separate color-specific answers; no universal +1 fit offset.
const colors = recommendAllColors(product('alpaca-striped-buttons'), input(183, 78));
assert.deepEqual(colors.map(r => [r.colorId, r.size]), [['dark-gray', 'XL'], ['light-gray', '2XL'], ['light-beige', '2XL']]); checks++;
expect('alpaca-striped-buttons', input(184, 79, { fit: 'relaxed' }), '2XL', 'light-beige');
expect('alpaca-striped-buttons', input(183, 78, { fit: 'relaxed' }), '2XL', 'dark-gray');
expect('alpaca-striped-buttons', input(183, 78, { fit: 'relaxed' }), '3XL', 'light-gray');
expect('alpaca-striped-no-buttons', input(178, 75), 'XL');
expect('alpaca-striped-no-buttons', input(179, 76), 'XL');
expect('alpaca-striped-no-buttons', input(172, 74, { reference: { shoulders: 50, chest: 53 } }), 'L');
expect('alpaca-striped-no-buttons', input(183, 78), 'XL');
expect('alpaca-striped-no-buttons', input(183, 78, { fit: 'relaxed' }), '2XL');
expect('margiela-striped-pants', input(175, 70), 'XL');
expect('margiela-striped-pants', input(165, 57), 'L');
expect('margiela-striped-pants', input(180, 60, { reference: { halfWaist: 38 } }), 'L');
assert.ok(expect('margiela-striped-pants', input(175, 70, { lengthPreference: 'cropped', reference: { halfWaist: 40 } }), 'XL').requiresCheck);
expect('margiela-striped-pants', input(175, 70, { fit: 'closer', lengthPreference: 'cropped', reference: { halfWaist: 40 } }), 'L');
expect('samurai-shirt', input(160, 50), '2XL');
expect('samurai-shirt', input(170, 60), '3XL');
expect('samurai-shirt', input(175, 70), '4XL');
expect('samurai-shirt', input(181, 76), '5XL');
expect('samurai-shirt', input(175, 70, { fit: 'closer' }), '3XL');
assert.ok(expect('samurai-shirt', input(183, 80), null).message.includes('рукав'));
expect('black-cold-gray-longsleeve', input(185, 65), 'L');
expect('black-cold-gray-longsleeve', input(175, 70, { fit: 'closer', reference: { shoulders: 46, chest: 53 } }), 'M');
expect('black-cold-gray-longsleeve', input(175, 70, { reference: { shoulders: 46, chest: 53 } }), 'M');
const acceptedColdEstimate = expect('black-cold-gray-longsleeve', input(190, 115), '5XL');
assert.ok(!acceptedColdEstimate.checks.some(x => x.includes('Перемерьте')));
assert.equal(byKey.get('black-cold-gray-longsleeve').rows.find(r => r.tag === '5XL').estimated, true);
assert.equal(byKey.get('black-cold-gray-longsleeve').stretch, 'none'); checks += 2;
expect('black-cold-gray-longsleeve', input(173, 60), 'S');
expect('black-cold-gray-longsleeve', input(174, 64), 'M');
expect('black-cold-gray-longsleeve', input(174, 69), 'M');
expect('black-cold-gray-longsleeve', input(181, 65, { reference: { chest: 44 } }), 'M');
expect('black-cold-gray-longsleeve', input(181, 65, { reference: { chest: 45 } }), 'M');
expect('black-cold-gray-longsleeve', input(178, 80), 'L');
expect('black-cold-gray-longsleeve', input(188, 90), '2XL');
expect('black-cold-gray-longsleeve', input(172, 80), 'L');
expect('black-cold-gray-longsleeve', input(172, 85), 'L');
const sharedCold = recommendAllColors({ ...product('black-cold-gray-longsleeve'), stock_details: { colors: [
  { name: 'Серый' }, { name: 'Серые' }, { name: 'Чёрные' },
] } }, input(173, 60));
assert.equal(sharedCold.length, 1);
assert.equal(sharedCold[0].colorName, 'Размер');
assert.equal(sharedCold[0].size, 'S'); checks++;
expect('best-distress-shirt', input(183, 78), '2XL');
expect('best-distress-shirt', input(175, 80), '2XL');
expect('best-distress-shirt', input(175, 80, { fit: 'relaxed' }), '2XL');
expect('best-distress-shirt', input(183, 78, { fit: 'closer' }), 'XL');
expect('best-distress-shirt', input(176, 72), 'XL');
expect('best-distress-shirt', input(153, 50), 'M');
expect('best-distress-shirt', input(173, 50), 'L');
expect('muzhik-longsleeve', input(185, 85), 'XL');
expect('muzhik-longsleeve', input(183, 78, { fit: 'relaxed' }), 'L');
expect('wooden-buttons-longsleeve', input(178, 60), 'M');
expect('wooden-buttons-longsleeve', input(178, 60, { reference: { shoulders: 44, chest: 50, length: 70, sleeve: 63 } }), 'S');
expect('wooden-buttons-longsleeve', input(179, 61, { reference: { shoulders: 44, chest: 50 } }), 'S');
expect('wooden-buttons-longsleeve', input(190, 95), '3XL');
expect('dense-new-stripe-pants', input(183, 88), '3XL');
expect('dense-new-stripe-pants', input(183, 88, { reference: { halfWaist: 42 } }), '3XL');
expect('dense-new-stripe-pants', input(183, 88, { reference: { halfWaist: 42, length: 111 } }), '3XL');
expect('dense-new-stripe-pants', input(176, 71), 'XL');
expect('dense-new-stripe-pants', input(186, 94, { reference: { halfWaist: 49 } }), null);
assert.ok(expect('huge-pants', input(176, 66), '2XL').checks.some(x => x.includes('полупояс')));
expect('huge-pants', input(175, 65), 'XL');
expect('huge-pants', input(164, 49), 'L');
expect('huge-pants', input(163, 48), 'L');
expect('old-textured-collar-shirt', input(165, 55), 'L');
expect('old-textured-collar-shirt', input(175, 70, { reference: { shoulders: 46, chest: 51, length: 70, sleeve: 61 } }), 'XL');
expect('old-textured-collar-shirt', input(183, 78, { reference: { shoulders: 48, chest: 51, length: 73, sleeve: 63 } }), '2XL');
assert.equal(expect('old-textured-collar-shirt', input(180, 100, { reference: { chest: 60 } }), null).basis, 'incompatible');
expect('old-textured-collar-shirt', input(179, 99, { reference: { chest: 60 } }), null);
// Validation, color isolation and stock never silently replace the chosen size.
for (const extra of [{ height: NaN }, { weight: Infinity }, { reference: { chest: -1 } }, { reference: { chest: NaN } }, { reference: { chest: 100 }, measurementSubject: 'body' }])
  assert.ok(recommendAllColors(product('alpaca-striped-buttons'), { ...input(183, 78), ...extra }).every(r => !r.size));
checks += 5;
const editedColors = { ...product('alpaca-striped-buttons'), stock_details: { colors: [{ name: 'Тёмно-серый', sizes: ['L'] }, { name: 'Красный', sizes: ['XL'] }] } };
const editedResults = recommendAllColors(editedColors, input(183, 78));
assert.equal(editedResults.find(r => r.colorId === 'dark-gray').size, 'XL');
assert.ok(editedResults.find(r => r.colorId === 'dark-gray').checks.some(x => x.includes('наличие')));
assert.equal(editedResults.find(r => r.colorName === 'Красный').size, null); checks += 3;
const missingM = { ...product('dense-new-stripe-pants'), sizes: ['L', 'XL', '2XL', '3XL'] };
assert.ok(recommendAllColors(missingM, input(165, 55))[0].checks.some(x => x.includes('наличие M'))); checks++;
const regularWaistChoice = expect('margiela-striped-pants', input(183, 88), '3XL');
const shortLengthOnly = recommendAllColors(product('margiela-striped-pants'), input(183, 88, { lengthPreference: 'cropped', reference: { length: 100 } }))[0];
assert.equal(shortLengthOnly.size, regularWaistChoice.size);
assert.ok(shortLengthOnly.requiresCheck); checks += 2;
console.log(`PASS ${checks} reviewed scenarios and boundary checks; three colors, reference garments, fit, cropped length, stock, estimated measurements and manual fit limits. This is regression, not independent fitting accuracy.`);
