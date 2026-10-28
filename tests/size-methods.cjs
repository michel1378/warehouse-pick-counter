// Offline development-set audit. The fixed method was chosen using this catalog.
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');

function compile(source, filename = 'src/lib/sizes.ts') {
  const cache = new Map();
  function load(file, input) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = new Module(file, module);
    mod.filename = file; mod.paths = module.paths; cache.set(file, mod);
    const original = mod.require.bind(mod);
    mod.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : original(name);
    mod._compile(ts.transpileModule(input ?? fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, file);
    return mod.exports;
  }
  return load(filename, source);
}
function readCatalog(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (text.startsWith('[')) return JSON.parse(text);
  const cell = text.slice(text.indexOf('\n') + 1).trim();
  return JSON.parse(cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
}
const samePoint = (a, b) => a.height === b.height && a.weight === b.weight && a.fit === b.fit;
const emptyStats = () => ({ correct: 0, one: 0, twoPlus: 0, abstain: 0, total: 0 });
function add(stats, actual, predicted, sizes) {
  stats.total++;
  if (predicted === null) stats.abstain++;
  else {
    const error = Math.abs(sizes.indexOf(actual) - sizes.indexOf(predicted));
    stats[error === 0 ? 'correct' : error === 1 ? 'one' : 'twoPlus']++;
  }
}

function audit(products) {
  const current = compile(fs.readFileSync('src/lib/sizes.ts', 'utf8'));
  const baseline = require('./fixtures/size-regression-baseline.cjs');
  const names = ['baseline', 'fixed'];
  const totals = Object.fromEntries(names.map(name => [name, emptyStats()]));
  const result = [];
  for (const product of products) {
    const stats = Object.fromEntries(names.map(name => [name, emptyStats()]));
    const folds = [];
    for (const example of product.examples) {
      const train = { ...product, examples: product.examples.filter(e => !samePoint(e, example)) };
      const predictions = { baseline: baseline.recommendSize(train, example.height, example.weight, example.fit).size };
      predictions.fixed = current.recommendSize(train, example.height, example.weight, example.fit).size;
      for (const name of names) {
        add(stats[name], example.size, predictions[name], product.sizes);
        add(totals[name], example.size, predictions[name], product.sizes);
      }
      folds.push({ row: product.examples.indexOf(example) + 1, example, predictions });
    }
    const neighborhoods = { comparisons: 0, changes: 0, reverseHeight: 0, reverseWeight: 0, twoPlus: 0, anchorDiscontinuities: 0, cases: [] };
    for (const example of product.examples) for (const axis of ['height', 'weight']) {
      const deltas = [-2, -1, -0.01, 0, 0.01, 1, 2];
      const predictions = deltas.map(delta => current.recommendSize(product,
        example.height + (axis === 'height' ? delta : 0), example.weight + (axis === 'weight' ? delta : 0), example.fit));
      for (const i of [2, 4]) if (predictions[i].size !== example.size) neighborhoods.anchorDiscontinuities++;
      for (let i = 1; i < deltas.length; i++) {
        const a = predictions[i - 1], b = predictions[i];
        if (!a.size || !b.size) continue;
        neighborhoods.comparisons++;
        const step = product.sizes.indexOf(b.size) - product.sizes.indexOf(a.size);
        if (!step) continue;
        neighborhoods.changes++;
        if (step < 0) neighborhoods[axis === 'height' ? 'reverseHeight' : 'reverseWeight']++;
        if (Math.abs(step) >= 2) neighborhoods.twoPlus++;
        neighborhoods.cases.push({ row: product.examples.indexOf(example) + 1, axis, from: deltas[i - 1], to: deltas[i], sizes: [a.size, b.size], warnings: [a.warnings, b.warnings] });
      }
    }
    result.push({ name: product.name, stats, folds, neighborhoods });
  }
  return { totals, products: result };
}
if (require.main === module) {
  const file = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const products = readCatalog(file || path.join(__dirname, 'fixtures/size-catalog-20261028.json'));
  const result = audit(products);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const p of result.products) console.log(JSON.stringify({ name: p.name, stats: p.stats, neighborhoods: { ...p.neighborhoods, cases: undefined } }));
    console.log(JSON.stringify({ totals: result.totals }));
  }
}
module.exports = { compile, readCatalog, audit };
