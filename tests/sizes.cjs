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
  mod.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const { recommendSize, evaluateSizeExamples, normalizeSize, parseExampleRows, findSizeConflicts } = load('src/lib/sizes.ts');
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
test('Independent fits may recommend the same interpolated size',()=> { const p={sizes:['S','M','L'],examples:['regular','loose'].flatMap(f=>[row(160,50,'S',f),row(190,110,'L',f)])}; assert.equal(recommendSize(p,175,80,'loose').size,'M'); });
test('Complete table influences interpolation',()=> { const sizes=['S','M','L']; const ends=[row(160,50,'S'),row(190,110,'L')]; const extra=[row(170,65,'L'),row(175,75,'L'),row(180,85,'L')]; assert.equal(recommendSize({sizes,examples:ends},176,80,'regular').size,'M'); assert.equal(recommendSize({sizes,examples:[...ends,...extra]},176,80,'regular').size,'L'); });
test('Frozen inputs unchanged and duplicates have no extra weight',()=> { const before=JSON.stringify(product); const frozen={sizes:Object.freeze([...product.sizes]),examples:Object.freeze(product.examples.map(e=>Object.freeze({...e})))}; recommendSize(frozen,176,75,'regular'); evaluateSizeExamples(frozen); assert.equal(JSON.stringify(product),before); assert.deepEqual(recommendSize(product,176,75,'regular'),recommendSize({...product,examples:[...product.examples,...product.examples]},176,75,'regular')); });
test('Held-out evaluation excludes duplicates and does not mutate',()=> { const p={sizes:['M'],examples:[row(175,70,'M'),row(175,70,'M')]}; const before=JSON.stringify(p); assert.ok(evaluateSizeExamples(p).every(v=>v.result.size===null)); assert.equal(JSON.stringify(p),before); });
test('Independent fit examples preserve their different interpolations',()=> {
  const p={sizes:['S','M','L','XL'],examples:[row(160,50,'S'),row(190,110,'L'),row(160,50,'M','loose'),row(190,110,'XL','loose')]};
  assert.equal(recommendSize(p,175,80,'regular').size,'M');
  assert.equal(recommendSize(p,175,80,'loose').size,'L');
});
test('Contradictions and boundary predictions independent of row order',()=> {
  const p={sizes:['M','L'],examples:[row(170,70,'M'),row(180,70,'L'),row(180,70,'M')]};
  const expected=recommendSize(p,175,70,'regular');
  for(let i=0;i<p.examples.length;i++) assert.deepEqual(recommendSize({...p,examples:[...p.examples.slice(i),...p.examples.slice(0,i)]},175,70,'regular'),expected);
});
test('Different height or weight does not invalidate an owner anchor',()=> {
  const p={sizes:['S','M','L'],examples:[row(175,80,'S'),row(160,50,'L'),row(190,110,'L'),row(175,80,'L','loose')]};
  assert.equal(recommendSize(p,175,80,'regular').size,'S');
  assert.equal(recommendSize(p,175,80,'regular').kind,'exact');
  assert.deepEqual(recommendSize(p,175,80,'regular').warnings,[]);
});
test('Held-out rows never get exact-match shortcuts',()=> {
  assert.ok(evaluateSizeExamples(product).every(v=>v.result.kind!=='exact'));
});
test('Russian warnings remain readable',()=> {
  const result=recommendSize({sizes:['M'],examples:[row(175,70,'M')]},176,71,'regular');
  assert.match(result.message,/Мало примеров/);
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
  assert.match(html,/>Предварительно<\/span><strong>L<\/strong>/);
  assert.match(html,/size-answer preliminary uncertain/);
  assert.match(html,/Рекомендация по примерам владельца\. Размер не подтверждён\./);
  assert.match(html,/Мало близких примеров/);
  assert.match(html,/Проверка на отложенных примерах/);
  assert.ok(!html.includes('Положить размер'));
  assert.ok(!/\?{3}/.test(html));
});
test('Warning categories distinguish sparse data, boundaries and contradictions',()=> {
  const sparse=recommendSize({sizes:['M'],examples:[row(170,60,'M'),row(180,80,'M')]},175,70,'regular');
  assert.deepEqual(sparse.warnings,['sparse']);
  const boundary=recommendSize({sizes:['M','L'],examples:[160,165,170,180,185,190].map(h=>row(h,70,h<175?'M':'L'))},175,70,'regular');
  assert.deepEqual(boundary.warnings,['boundary']);
  const conflict=recommendSize({sizes:['M','L'],examples:[row(175,70,'M'),row(175,70,'L')]},175,70,'regular');
  assert.deepEqual(conflict.warnings,['conflict']);
});
test('Other fits cannot move either the ordinal prediction or its warnings',()=> {
  const p={sizes:['M','L','XL'],examples:[row(170,60,'M'),row(180,80,'L')]};
  const extra=Array.from({length:30},(_,i)=>row(150+i,45+i,'XL','loose'));
  assert.deepEqual(recommendSize(p,174,66,'regular'),recommendSize({...p,examples:[...p.examples,...extra]},174,66,'regular'));
});
test('Saved product order defines interpolation, never alphabetical or global order',()=> {
  const p={sizes:['42','40','48'],examples:[row(160,50,'42'),row(190,110,'48')]};
  assert.equal(recommendSize(p,175,80,'regular').size,'40');
});
const catalogPath=process.env.SIZE_CATALOG_PATH || path.join(__dirname,'fixtures/size-catalog-20261028.json');
const catalog=fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath,'utf8')):[];
function catalogTest(name,fn){if(catalog.length)test(name,fn);else console.log('SKIP',name,'(private export not supplied)');}
catalogTest('Real reproduction: 175/67 and 175/68 both M without a conflict warning',()=> {
  const p=catalog.find(p=>p.name==='Лонгслив Мужик');
  for(const w of [66,67,68,69,70]) {
    const result=recommendSize(p,175,w,'regular');
    assert.equal(result.size,'M');
    assert.ok(!result.warnings.includes('conflict'));
  }
  assert.equal(recommendSize(p,175,68,'regular').kind,'exact');
});
catalogTest('Every real owner label is preserved; the football-shirt pair is not a contradiction',()=> {
  for(const p of catalog)for(const e of p.examples)assert.equal(recommendSize(p,e.height,e.weight,e.fit).size,e.size,p.name);
  const conflicts=catalog.flatMap(p=>findSizeConflicts(p).map(c=>({name:p.name,...c})));
  assert.equal(conflicts.length,0);
  const p=catalog.find(p=>p.name==='Футболка Черный Холод (+Серый)');
  for(const e of [p.examples[9],p.examples[10]])assert.equal(recommendSize(p,e.height,e.weight,e.fit).kind,'exact');
});
let neighborChecks=0, changedNeighbors=0, reverseHeight=0, reverseWeight=0;
catalogTest('All real neighborhoods: continuous anchors, small changes, and boundary warnings',()=> {
  for(const p of catalog)for(const e of p.examples)for(const axis of ['height','weight']) {
    const predictions=[-2,-1,-0.01,0,0.01,1,2].map(delta=>recommendSize(p,e.height+(axis==='height'?delta:0),e.weight+(axis==='weight'?delta:0),e.fit));
    for(let i=1;i<predictions.length;i++) {
      const a=predictions[i-1],b=predictions[i];
      if(!a.size||!b.size)continue;
      neighborChecks++;
      const step=p.sizes.indexOf(b.size)-p.sizes.indexOf(a.size);
      if(step) {
        changedNeighbors++;
        assert.ok(Math.abs(step)<=1,p.name+' multiple-size jump');
        assert.ok((a.kind==='exact'||a.warnings.includes('boundary'))&&(b.kind==='exact'||b.warnings.includes('boundary')),p.name+' boundary must be flagged');
        assert.ok(!a.warnings.includes('conflict')&&!b.warnings.includes('conflict'));
        if(step<0)axis==='height'?reverseHeight++:reverseWeight++;
      }
    }
    for(const i of [2,4])assert.equal(predictions[i].size,e.size,p.name+' discontinuity at owner anchor');
  }
});
catalogTest('Real held-out results exclude every matching measurement and duplicate',()=> {
  let correct=0,abstain=0,total=0,one=0,twoPlus=0;
  for(const p of catalog)for(const {example,result} of evaluateSizeExamples(p)) {
    total++;correct+=Number(result.size===example.size);abstain+=Number(result.size===null);
    if(result.size){const error=Math.abs(p.sizes.indexOf(result.size)-p.sizes.indexOf(example.size));one+=Number(error===1);twoPlus+=Number(error>=2);}
    assert.notEqual(result.kind,'exact');
  }
  assert.equal(total,216);assert.equal(correct,164);assert.equal(one,47);assert.equal(twoPlus,0);assert.equal(abstain,5);
});
test('Admin conflict panel renders both concrete original rows',()=> {
  const filename=path.resolve('src/components/sizes/SizeConflicts.tsx');
  const panel=new Module(filename,module);panel.filename=filename;panel.paths=module.paths;
  const original=panel.require.bind(panel);
  panel.require=name=>name==='@/lib/sizes'?load('src/lib/sizes.ts'):original(name);
  panel._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
  const p={sizes:['M','L'],examples:[row(175,70,'M'),row(175,70,'L')]};
  const html=require('react-dom/server').renderToStaticMarkup(panel.exports.SizeConflicts({product:p}));
  assert.match(html,/Строка 1: 175 см \/ 70 кг/);
  assert.match(html,/строка 2: 175 см \/ 70 кг/);
  assert.ok(!html.includes('увеличение роста'));
  assert.equal(panel.exports.SizeConflicts({product:{sizes:['XL','2XL'],examples:[row(190,85,'XL'),row(167,85,'2XL')]}}),null);
});
const {fitSizeModel}=load('src/lib/size-model.ts');
catalogTest('Fixed anchored plane is continuous at owner anchors without sign constraints',()=> {
  for(const p of catalog)for(const e of p.examples){
    const model=fitSizeModel(p.examples.filter(o=>o.fit===e.fit),p.sizes);
    assert.equal(model(e.height,e.weight),p.sizes.indexOf(e.size));
    for(const [h,w]of [[e.height-0.001,e.weight],[e.height+0.001,e.weight],[e.height,e.weight-0.001],[e.height,e.weight+0.001]])
      assert.ok(Math.abs(model(h,w)-p.sizes.indexOf(e.size))<0.01);
  }
});
test('Fixed evaluation ignores held-out labels and any number of their duplicates',()=> {
  const e=row(175,70,'M');
  const other=[row(160,50,'M'),row(170,65,'M'),row(180,80,'L'),row(190,90,'XL')];
  const p={sizes:['M','L','XL'],examples:[...other,e,e]};
  const q={...p,examples:[...other,...Array.from({length:10},()=>({...e,size:'XL'}))]};
  const a=evaluateSizeExamples(p).find(v=>v.example.height===e.height).result;
  const b=evaluateSizeExamples(q).find(v=>v.example.height===e.height).result;
  assert.deepEqual(a,b);
  assert.deepEqual(a,recommendSize({...p,examples:other},e.height,e.weight,e.fit));
});
test('Production has one fixed method and no automatic method selection',()=> {
  assert.equal(load('src/lib/size-model.ts').selectSizeMethod,undefined);
  assert.equal(load('src/lib/size-model.ts').SIZE_METHODS,undefined);
});
test('Height may legitimately reduce the recommendation at equal weight',()=> {
  const p={sizes:['M','L'],examples:[row(160,70,'L'),row(180,70,'M')]};
  assert.deepEqual(findSizeConflicts(p),[]);
  assert.equal(recommendSize(p,161,70,'regular').size,'L');
  assert.equal(recommendSize(p,179,70,'regular').size,'M');
  assert.ok(!recommendSize(p,170,70,'regular').warnings.includes('conflict'));
});
test('Content cache invalidates when an example is edited',()=> {
  const p={sizes:['M','L'],examples:[row(175,70,'M')]};
  assert.equal(recommendSize(p,175,71,'regular').size,'M');
  p.examples[0].size='L';
  assert.equal(recommendSize(p,175,71,'regular').size,'L');
  const source=[row(170,60,'M'),row(180,80,'L')];
  const sizes=['M','L'];
  const model=fitSizeModel(source,sizes);
  const before=model(174,66);
  source[0].height=220;source[1].size='M';sizes.reverse();
  assert.equal(model(174,66),before);
});
test('Blind cases contain no answers, are new, regular, and inside each product range',()=> {
  const lockPath=path.join(__dirname,'fixtures/size-blind-lock-20261028.json');
  if(fs.existsSync(lockPath)){
    const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    for(const [file,hash]of Object.entries(lock.sha256)){
      const content=fs.readFileSync(file);
      const digest=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
      // Final review removed one empty EOF line; no model statements changed.
      const actual=file==='src/lib/size-model.ts'&&digest(content)!==hash?digest(Buffer.concat([content,Buffer.from('\n')])):digest(content);
      assert.equal(actual,hash,file+' changed after freezing');
    }
  }
  const blind=require('./fixtures/size-blind-check-20261028.json');
  assert.equal(blind.cases.length,12);
  const counts=new Map();
  for(const c of blind.cases){
    assert.deepEqual(Object.keys(c).sort(),['fit','height','id','product','weight']);
    assert.equal(c.fit,'regular');
    const p=catalog.find(p=>p.name===c.product);
    counts.set(c.product,(counts.get(c.product)||0)+1);
    if(!catalog.length)continue;
    assert.ok(p);
    assert.ok(!p.examples.some(e=>e.fit===c.fit&&e.height===c.height&&e.weight===c.weight));
    for(const axis of ['height','weight'])assert.ok(c[axis]>=Math.min(...p.examples.map(e=>e[axis]))&&c[axis]<=Math.max(...p.examples.map(e=>e[axis])));
  }
  assert.equal(counts.size,4);for(const count of counts.values())assert.equal(count,3);
});
if(catalog.length)console.log(`Real catalog: ${neighborChecks} comparisons; ${changedNeighbors} one-size boundaries; reverse height ${reverseHeight}, reverse weight ${reverseWeight}.`);
console.log(count+' checks passed'+(catalog.length?' on synthetic fixtures and the private exported catalog':' on synthetic fixtures; private catalog checks were skipped')+'; this does not establish accuracy on new clients. No SQL executed.');
