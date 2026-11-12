const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
let session = { role: 'admin' }, savedPeople = [], savedProducts = [];
function builder(table) {
  let rows = table === 'size_fit_people' ? savedPeople : savedProducts, filters = [], values, mode = 'select';
  const q = { select(){return q}, order(){return q}, range(){return q}, neq(){return q}, gt(){return q},
    eq(k,v){filters.push(r=>r[k]===v);return q}, update(v){values=v;mode='update';return q}, insert(v){values=v;mode='insert';return q},
    result(single=false){let selected=rows.filter(r=>filters.every(f=>f(r)));if(mode==='update')selected.forEach(r=>Object.assign(r,values));if(mode==='insert'){const r={...values,id:'00000000-0000-4000-8000-000000000099'};rows.push(r);selected=[r]};return {data:single?selected[0]??null:structuredClone(selected),error:null}},
    maybeSingle:async()=>q.result(true),single:async()=>q.result(true),then(resolve){return Promise.resolve(q.result()).then(resolve)} };
  return q;
}
const cache = new Map();
function load(file) {
  const filename = path.resolve(file);if(cache.has(filename))return cache.get(filename).exports;
  const m = new Module(filename,module);m.filename=filename;m.paths=module.paths;cache.set(filename,m);const req=m.require.bind(m);
  m.require=name=>name==='@/lib/session'?{getSession:async()=>session}:name==='@/lib/supabase'?{createAdminClient:()=>({from:builder}),logSupabaseError(){}}:name.startsWith('@/')?load('src/'+name.slice(2)+'.ts'):name.startsWith('.')&&!name.endsWith('.json')?load(path.resolve(path.dirname(filename),name+'.ts')):req(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);return m.exports;
}
const {snapshotFittings,fittingInputSchema}=load('src/lib/size-fittings.ts');
const {recommendAllColors,getDetailedSizeDefinition}=load('src/lib/detailed-sizes.ts');
const peopleApi=load('src/app/api/size-fit-people/route.ts'), productsApi=load('src/app/api/sizes/route.ts');
const person={id:'00000000-0000-4000-8000-000000000001',slot:1,label:'Тестовый профиль',height:183,weight:79,shoulders:49,chest_circumference:104,waist_circumference:82,revision:1};
const row={id:'00000000-0000-4000-8000-000000000002',personId:person.id,size:'XL',colorId:'all',fit:'regular',length:'ok',sleeve:'ok',notes:''};
const body=input=>new Request('https://warehouse.test/api/sizes',{method:'POST',headers:{origin:'https://warehouse.test',host:'warehouse.test','content-type':'application/json'},body:JSON.stringify(input)});
const def=getDetailedSizeDefinition('2886d56d-b216-4873-b26a-d26c84ecf928');
const p={id:def.id,name:def.name,note:'',sizes:def.sizes,examples:[{height:173,weight:60,size:'S',fit:'regular'}],fittings:[],revision:1,active:true,show_in_sizes:true,show_in_availability:true,photo_count:1};
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++};
(async()=>{
 const snap=snapshotFittings([row],[],[person],false,'2026-11-12T10:00:00Z');
 check(snap[0].body.chestCircumference===104,'Store full body circumference');
 const next=snapshotFittings([row],snap,[{...person,weight:90,chest_circumference:112}],false);
 check(next[0].body.weight===79 && next[0].body.chestCircumference===104,'Old snapshots must remain unchanged');
 check(snapshotFittings([{...row,refreshMeasurements:true}],snap,[{...person,weight:90}],false)[0].body.weight===90,'Explicit snapshot refresh');
 check(!fittingInputSchema.safeParse({...row,body:{height:1}}).success,'Client cannot submit body snapshots');
 assert.throws(()=>snapshotFittings([row,row],[],[person],false));checks++;
 const parameters={height:183,weight:79,fit:'regular',lengthPreference:'standard'};
 check(recommendAllColors(p,parameters)[0].size==='L','Original baseline');
 const observed={...p,fittings:snap};
 check(recommendAllColors(observed,parameters)[0].size==='XL','Real fitting overrides hypothetical baseline');
 check(recommendAllColors(observed,parameters)[0].basis==='fitting','Real evidence marked honestly');
 const bad={...p,fittings:[{...snap[0],size:'L',fit:'too_tight'}]};
 check(recommendAllColors(bad,parameters)[0].size===null,'Failed real fitting cannot silently confirm L');
 check(recommendAllColors({...p,fittings:[{...snap[0],colorId:'other'}]},parameters)[0].size==='L','Colors isolated');
 const newProduct={...p,id:'00000000-0000-4000-8000-000000000077',examples:[],fittings:snap};
 check(recommendAllColors(newProduct,parameters)[0].size==='XL','Fittings-only new product can recommend');
 const conflict={...p,fittings:[...snap,{...snap[0],id:'00000000-0000-4000-8000-000000000003',personId:'00000000-0000-4000-8000-000000000004',size:'2XL',body:{...snap[0].body,chestCircumference:114}}]};
 check(recommendAllColors(conflict,parameters)[0].size===null,'Different body shapes are not averaged into fictional label');
 savedPeople=[structuredClone(person)];savedProducts=[structuredClone(p)];
 session=null;check((await peopleApi.GET()).status===403,'No anonymous profiles');check((await productsApi.GET()).status===401,'No anonymous catalog');
 session={role:'employee'};check((await peopleApi.POST(body({...person}))).status===403,'Employee cannot edit profiles');
 session={role:'admin'};
 const personInput={id:person.id,revision:1,label:person.label,height:183,weight:79,shoulders:49,chest_circumference:104,waist_circumference:82};
 let res=await peopleApi.POST(body(personInput));check(res.status===200,'Save profile through API');check((await peopleApi.POST(body(personInput))).status===409,'Stale profile version rejected');
 const incoming={id:p.id,revision:1,name:p.name,note:p.note,sizes:p.sizes,examples:p.examples,active:true,show_in_sizes:true,show_in_availability:true,fittings:[row]};
 res=await productsApi.POST(body(incoming));check(res.status===200,JSON.stringify(await res.clone().json()));
 const afterSave=(await res.json()).product;check(afterSave.fittings[0].body.weight===79,'Server records the trusted profile snapshot');
 res=await productsApi.GET();const reloaded=(await res.json()).products[0];check(recommendAllColors(reloaded,parameters)[0].size==='XL','Saved fitting survives catalog reload and affects actual picker');
 check((await productsApi.POST(body(incoming))).status===409,'Stale product write rejected');
 const external=new Request('https://warehouse.test/api/size-fit-people',{method:'POST',headers:{origin:'https://foreign.test',host:'warehouse.test'},body:JSON.stringify(personInput)});
 check((await peopleApi.POST(external)).status===403,'Cross-origin profile writes rejected');
 console.log(`PASS ${checks} fitting checks: body/garment units, immutable history, profiles and product APIs, auth, concurrency, reload, real recommendation, negative examples and colors.`);
})().catch(e=>{console.error(e);process.exitCode=1});
