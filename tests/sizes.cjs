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
const { recommendSize, normalizeSize, parseExampleRows } = load('src/lib/sizes.ts');
const { sizeProductSchema } = load('src/lib/sizes-validation.ts');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
const row = (height, weight, size, fit = 'regular') => ({ height, weight, size, fit });
const product = { sizes: ['M', 'L', 'XL'], examples: [row(170, 65, 'M'), row(175, 70, 'M'), row(180, 85, 'L'), row(183, 90, 'L'), row(180, 85, 'XL', 'loose')] };
test('Exact case uses label, not nominal malomerit offset', () => assert.equal(recommendSize(product, 180, 85, 'regular').size, 'L'));
test('Requested fit isolated from other fits', () => assert.equal(recommendSize(product, 180, 85, 'loose').size, 'XL'));
test('Unseen nearby input interpolates from consistent cases', () => { const r = recommendSize(product, 172, 67, 'regular'); assert.equal(r.size, 'M'); assert.equal(r.kind, 'estimated'); });
test('Boundary disagreement returns clarification', () => { const p = { sizes:['M','L'], examples:[row(170,70,'M'),row(180,70,'L')] }; assert.equal(recommendSize(p,175,70,'regular').size,null); });
test('Missing fit does not invent +1 or -1', () => assert.equal(recommendSize(product,180,85,'tight').size,null));
test('Far outside support does not clamp to largest size', () => assert.equal(recommendSize(product,220,140,'regular').size,null));
test('Unknown label cannot be returned', () => assert.equal(recommendSize({sizes:['M'], examples:[row(180,85,'XL')]},180,85,'regular').size,null));
test('One nearby example does not pretend to cover a range', () => assert.equal(recommendSize({sizes:['M'],examples:[row(175,70,'M')]},176,71,'regular').size,null));
test('Invalid measurements rejected', () => { for (const h of [NaN,Infinity,0,99,231]) assert.equal(recommendSize(product,h,70,'regular').size,null); });
test('Conflicting exact examples rejected', () => assert.equal(recommendSize({sizes:['M','L'],examples:[row(175,70,'M'),row(175,70,'L')]},175,70,'regular').size,null));
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
async function sqlTest() {
  const { PGlite } = require('@electric-sql/pglite'); const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const sql=fs.readFileSync('supabase/migrations/20261004_size_catalog.sql','utf8');
    await db.exec(sql); await db.exec(sql);
    const {rows}=await db.query("select relrowsecurity from pg_class where oid='public.size_products'::regclass"); assert.equal(rows[0].relrowsecurity,true);
    const grants=await db.query("select has_table_privilege('anon','public.size_products','SELECT') as anon, has_table_privilege('authenticated','public.size_products','UPDATE') as employee, has_table_privilege('service_role','public.size_products','UPDATE') as service"); assert.deepEqual(grants.rows[0],{anon:false,employee:false,service:true});
    const inserted=await db.query("insert into public.size_products(name,sizes,examples,photo) values ('Test','[\"M\"]','[]','data:image/jpeg;base64,test') returning id,revision");
    const id=inserted.rows[0].id;
    const first=await db.query('update public.size_products set revision=revision+1 where id=$1 and revision=1 returning revision',[id]);
    const second=await db.query('update public.size_products set revision=revision+1 where id=$1 and revision=1 returning revision',[id]);
    assert.equal(first.rows.length,1); assert.equal(second.rows.length,0);
    console.log('PASS Migration repeatability, RLS, privileges, optimistic concurrency'); count++;
  } finally { await db.close(); }
  console.log(`${count} checks passed.`);
}
sqlTest().catch(e=>{console.error(e);process.exitCode=1;});
