// Run from project root: node tests/sizes.cjs. No live service or credentials needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { recommendSize, evaluateSizeExamples, normalizeSize, parseExampleRows } = load('src/lib/sizes.ts');
const { sizeProductSchema } = load('src/lib/sizes-validation.ts');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
const row = (height, weight, size, fit = 'regular') => ({ height, weight, size, fit });
const product = { sizes: ['M', 'L', 'XL'], examples: [row(170, 65, 'M'), row(175, 70, 'M'), row(180, 85, 'L'), row(183, 90, 'L'), row(180, 85, 'XL', 'loose')] };
test('Exact case uses label, not nominal malomerit offset', () => assert.equal(recommendSize(product, 180, 85, 'regular').size, 'L'));
test('Requested fit isolated from other fits', () => assert.equal(recommendSize(product, 180, 85, 'loose').size, 'XL'));
test('Unseen nearby input interpolates from consistent cases', () => { const r = recommendSize(product, 172, 67, 'regular'); assert.equal(r.size, 'M'); assert.equal(r.kind, 'uncertain'); });
test('Boundary prediction carries warning', () => { const p = { sizes:['M','L'], examples:[row(170,70,'M'),row(180,70,'L')] }; assert.ok(recommendSize(p,175,70,'regular').size); assert.equal(recommendSize(p,175,70,'regular').kind,'uncertain'); });
test('Missing fit does not invent +1 or -1', () => assert.equal(recommendSize(product,180,85,'tight').size,null));
test('Far outside support does not clamp to largest size', () => assert.equal(recommendSize(product,220,140,'regular').size,null));
test('Unknown label cannot be returned', () => assert.equal(recommendSize({sizes:['M'], examples:[row(180,85,'XL')]},180,85,'regular').size,null));
test('One example produces preliminary warning', () => assert.equal(recommendSize({sizes:['M'],examples:[row(175,70,'M')]},176,71,'regular').kind,'uncertain'));
test('Invalid measurements rejected', () => { for (const h of [NaN,Infinity,0,99,231]) assert.equal(recommendSize(product,h,70,'regular').size,null); });
test('Conflicting exact examples produce warning', () => assert.equal(recommendSize({sizes:['M','L'],examples:[row(175,70,'M'),row(175,70,'L')]},175,70,'regular').kind,'uncertain'));
test('Input row order cannot decide a tie', () => { const a = recommendSize(product,172,67,'regular'); const b = recommendSize({...product,examples:[...product.examples].reverse()},172,67,'regular'); assert.deepEqual(a,b); });
test('All numeric-label catalogs supported', () => assert.equal(recommendSize({sizes:['2XL','3XL','4XL','5XL'],examples:[row(180,85,'3XL'),row(182,90,'3XL')]},181,87,'regular').size,'3XL'));
test('Paste supports Excel and semicolon, decimal comma, aliases', () => { const r=parseExampleRows('Рост;Вес;Посадка;Размер\n175;70,5;Размер в размер;XXL\n180\t80\tНемного оверсайз\t3XL'); assert.equal(r.length,2); assert.equal(r[0].size,'2XL'); assert.equal(r[0].weight,70.5); });
test('Bad paste is not silently ignored', () => assert.throws(() => parseExampleRows('175;70;???;M')));
const draft={name:'Alpaca',note:'Маломерит на размер',...product,active:true};
test('Valid catalog accepted',()=>assert.equal(sizeProductSchema.safeParse(draft).success,true));
test('Cross-field unavailable size rejected',()=>assert.equal(sizeProductSchema.safeParse({...draft,sizes:['S']}).success,false));
test('Duplicate measurement+fit rows rejected',()=>assert.equal(sizeProductSchema.safeParse({...draft,examples:[row(175,70,'M'),row(175,70,'L')]}).success,false));
test('Alias duplicate sizes rejected',()=>assert.equal(sizeProductSchema.safeParse({...draft,sizes:['XXL','2XL'],examples:[]}).success,false));
test('Published empty catalog item rejected, draft allowed',()=>{assert.equal(sizeProductSchema.safeParse({...draft,examples:[]}).success,false);assert.equal(sizeProductSchema.safeParse({...draft,examples:[],active:false}).success,true);});
test('Editing requires revision',()=>assert.equal(sizeProductSchema.safeParse({...draft,id:'fc3f1719-0a75-44a8-9b8a-c13f6e3290dc'}).success,false));
test('SVG/external photo and extra fields rejected',()=>{assert.equal(sizeProductSchema.safeParse({...draft,photo:'data:image/svg+xml,hi'}).success,false);assert.equal(sizeProductSchema.safeParse({...draft,role:'admin'}).success,false);});

test('Wide interpolation does not require nearby rows',()=> { const p={sizes:['S','M','L'],examples:[row(160,50,'S'),row(190,110,'L')]}; assert.equal(recommendSize(p,175,80,'regular').size,'M'); });
test('Joint height and weight signals',()=> { const p={sizes:['S','M','L'],examples:[row(160,60,'S'),row(180,60,'M'),row(160,100,'M'),row(180,100,'L')]}; assert.equal(recommendSize(p,170,80,'regular').size,'M'); assert.equal(recommendSize(p,179,99,'regular').size,'L'); });
test('Fit offsets are learned and may be zero',()=> { const p={sizes:['S','M','L'],examples:['regular','loose'].flatMap(f=>[row(160,50,'S',f),row(190,110,'L',f)])}; assert.equal(recommendSize(p,175,80,'loose').size,'M'); });
test('Complete table influences interpolation',()=> { const sizes=['S','M','L']; const ends=[row(160,50,'S'),row(190,110,'L')]; const extra=[row(170,65,'L'),row(175,75,'L'),row(180,85,'L')]; assert.equal(recommendSize({sizes,examples:ends},176,80,'regular').size,'M'); assert.equal(recommendSize({sizes,examples:[...ends,...extra]},176,80,'regular').size,'L'); });
test('Frozen inputs unchanged and duplicates have no extra weight',()=> { const before=JSON.stringify(product); const frozen={sizes:Object.freeze([...product.sizes]),examples:Object.freeze(product.examples.map(e=>Object.freeze({...e})))}; recommendSize(frozen,176,75,'regular'); evaluateSizeExamples(frozen); assert.equal(JSON.stringify(product),before); assert.deepEqual(recommendSize(product,176,75,'regular'),recommendSize({...product,examples:[...product.examples,...product.examples]},176,75,'regular')); });
test('Held-out evaluation excludes duplicates and does not mutate',()=> { const p={sizes:['M'],examples:[row(175,70,'M'),row(175,70,'M')]}; const before=JSON.stringify(p); assert.ok(evaluateSizeExamples(p).every(v=>v.result.size===null)); assert.equal(JSON.stringify(p),before); });
test('Nonzero fit differences learned between measurements',()=> {
  const p={sizes:['S','M','L','XL'],examples:[row(160,50,'S'),row(190,110,'L'),row(160,50,'M','loose'),row(190,110,'XL','loose')]};
  assert.equal(recommendSize(p,175,80,'regular').size,'M');
  assert.equal(recommendSize(p,175,80,'loose').size,'L');
});
test('Contradictions and boundary predictions independent of row order',()=> {
  const p={sizes:['M','L'],examples:[row(170,70,'M'),row(180,70,'L'),row(180,70,'M')]};
  const expected=recommendSize(p,175,70,'regular');
  for(let i=0;i<p.examples.length;i++) assert.deepEqual(recommendSize({...p,examples:[...p.examples.slice(i),...p.examples.slice(0,i)]},175,70,'regular'),expected);
});
test('Consistent exact overrides regression including other fits',()=> {
  const p={sizes:['S','M','L'],examples:[row(175,80,'S'),row(160,50,'L'),row(190,110,'L'),row(175,80,'L','loose')]};
  assert.equal(recommendSize(p,175,80,'regular').size,'S');
  assert.equal(recommendSize(p,175,80,'regular').kind,'exact');
});
test('Held-out rows never get exact-match shortcuts',()=> {
  assert.ok(evaluateSizeExamples(product).every(v=>v.result.kind!=='exact'));
});
test('Russian warnings remain readable',()=> {
  const result=recommendSize({sizes:['M'],examples:[row(175,70,'M')]},176,71,'regular');
  assert.match(result.message,/мало примеров/);
  assert.ok(!/\?{3}/.test(result.message));
});
test('Picker renders preliminary label and readable held-out explanation',()=> {
  const filename=path.resolve('src/components/sizes/SizePicker.tsx');
  const picker=new Module(filename,module); picker.filename=filename; picker.paths=module.paths;
  const original=picker.require.bind(picker); let state=0;
  picker.require=name=>name==='react' ? {...require('react'),useState:()=>[['176','71','regular'][state++],()=>{}],useMemo:fn=>fn()}
    : name==='@/lib/sizes' ? load('src/lib/sizes.ts') : original(name);
  picker._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
  const html=require('react-dom/server').renderToStaticMarkup(picker.exports.SizePicker({product:{id:'test',sizes:['L'],examples:[row(175,70,'L')]}}));
  assert.match(html,/Предварительно: L/);
  assert.match(html,/Проверка на отложенных примерах/);
  assert.ok(!html.includes('Положить размер'));
  assert.ok(!/\?{3}/.test(html));
});
console.log(count+' checks passed. Synthetic fixtures verify behavior, not real-client accuracy. No SQL executed.');
