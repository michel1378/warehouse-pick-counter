const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
let session = {role:'admin'}, products = [];
const modules = new Map();
function builder() {
  let filters=[],values;
  const q={select(){return q},order(){return q},range(){return q},neq(){return q},gt(){return q},
    eq(k,v){filters.push(p=>p[k]===v);return q},update(v){values=v;return q},
    result(single=false){const rows=products.filter(p=>filters.every(f=>f(p)));if(values)rows.forEach(p=>Object.assign(p,values));return {data:structuredClone(single?rows[0]??null:rows),error:null}},
    maybeSingle:async()=>q.result(true),then(resolve){return Promise.resolve(q.result()).then(resolve)}};
  return q;
}
function load(file) {
  const filename=path.resolve(file);if(modules.has(filename))return modules.get(filename).exports;
  const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;modules.set(filename,m);const req=m.require.bind(m);
  m.require=name=>name==='@/lib/session'?{getSession:async()=>session}:name==='@/lib/supabase'?{createAdminClient:()=>({from:builder}),logSupabaseError(){}}:name.startsWith('@/')?load('src/'+name.slice(2)+'.ts'):name.startsWith('.')&&!name.endsWith('.json')?load(path.resolve(path.dirname(filename),name+'.ts')):req(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);return m.exports;
}
const {recommendAllColors,reviewedSizeData}=load('src/lib/detailed-sizes.ts');
const {confirmSizeExamples,combineSizeExamples}=load('src/lib/size-examples.ts');
const api=load('src/app/api/sizes/route.ts');
const cold=reviewedSizeData.products.find(p=>p.key==='black-cold-gray-longsleeve');
const fixture=d=>({id:d.id,name:d.name,note:'',sizes:d.sizes,examples:[],fittings:[],active:true,show_in_sizes:true,revision:1,updated_at:'',photo_count:1});
const input=(height,weight,fit='regular',reference={})=>({height,weight,fit,reference,lengthPreference:'standard'});
const pick=(p,x)=>recommendAllColors(p,x)[0];
const request=body=>new Request('https://warehouse.test/api/sizes',{method:'POST',headers:{host:'warehouse.test',origin:'https://warehouse.test','content-type':'application/json'},body:JSON.stringify(body)});
const payload=p=>({id:p.id,revision:p.revision,name:p.name,note:p.note,sizes:p.sizes,examples:p.examples.map(({height,weight,fit,size,colorId})=>({height,weight,fit,size,...(colorId?{colorId}:{})})),active:true,show_in_sizes:true});
let checks=0;
function equal(a,b,reason){assert.deepEqual(a,b,reason);checks++}
(async()=>{
  const base=fixture(cold);
  const stale={height:185,weight:65,fit:'regular',size:'M'};
  const historical={height:186,weight:73,fit:'regular',size:'XL'};
  const live={...base,examples:[stale,historical]};
  equal(pick(live,input(185,65)).size,'L','Reviewed correction outranks a stale old example');
  equal(pick(live,input(186,73)).size,'XL','Historical example used for a previously reviewed model');
  equal(pick(live,input(186,73)).basis,'legacy','Exact historical evidence is distinguished from a prediction');
  equal(pick({...live,examples:[]},input(186,73)).basis,'estimate','Deleting live examples removes them from the calculation');
  equal(confirmSizeExamples([stale],[stale]),[stale],'Saving unrelated fields does not reconfirm stale rows');
  const corrected={...stale,size:'XL'};
  const confirmed=confirmSizeExamples([corrected],[stale],'2026-11-12T12:00:00Z');
  equal(pick({...base,examples:confirmed},input(185,65)).size,'XL','Explicit new editor correction overrides the compiled example');
  equal(confirmSizeExamples([corrected],confirmed,'2026-11-12T13:00:00Z'),confirmed,'Unchanged recommendation keeps its original confirmation');
  const nearby=input(185,66);
  assert.ok(cold.sizes.indexOf(pick({...base,examples:confirmed},nearby).size)>cold.sizes.indexOf(pick(base,nearby).size),'New example must affect nearby customers too');checks++;
  const impossible=pick({...base,examples:confirmed},input(185,65,'regular',{chest:110}));
  equal(impossible.basis,'incompatible','An example does not override incompatible physical measurements');
  const fitting={id:'00000000-0000-4000-8000-000000000003',personId:'00000000-0000-4000-8000-000000000004',personSlot:1,size:'L',colorId:'all',fit:'regular',length:'ok',sleeve:'ok',notes:'',body:{height:185,weight:65,shoulders:null,chestCircumference:null,waistCircumference:null},measuredAt:'2026-11-12T12:00:00Z'};
  equal(pick({...base,examples:confirmed,fittings:[fitting]},input(185,65)).size,'L','Actual fitting takes priority over an editor assumption');
  const flowers=reviewedSizeData.products.find(p=>p.key==='flowers-shirt');
  equal(combineSizeExamples(flowers,[],'all').length,0,'Deleted catalog-only rows cannot return from a bundled snapshot');
  const alpaca=reviewedSizeData.products.find(p=>p.key==='alpaca-striped-buttons');
  const alpacaProduct={...fixture(alpaca),examples:confirmSizeExamples([{height:183,weight:78,fit:'regular',size:'L',colorId:'dark-gray'}],[])};
  equal(recommendAllColors(alpacaProduct,input(183,78)).map(r=>[r.colorId,r.size]),[['dark-gray','L'],['light-gray','2XL'],['light-beige','2XL']],'Edited dark color does not overwrite lighter colors');

  products=[structuredClone(live)];
  let res=await api.POST(request({...payload(live),note:'Изменили только подпись'}));
  equal(res.status,200,'Existing card saves');
  let saved=(await res.json()).product;
  equal(saved.examples,[stale,historical],'Server preserves old examples without falsely marking them new');
  equal(pick(saved,input(185,65)).size,'L','Unrelated save preserves reviewed correction');
  const edit={...payload(saved),examples:[corrected,historical]};
  res=await api.POST(request(edit));equal(res.status,200,'Save a recommendation correction');
  saved=(await res.json()).product;
  assert.ok(saved.examples[0].confirmedAt && !saved.examples[1].confirmedAt,'Server confirms only the changed row');checks++;
  const adminReload=(await (await api.GET()).json()).products[0];
  equal(pick(adminReload,input(185,65)).size,'XL','Saved correction is used after admin reload');
  session={role:'employee'};
  const employeeReload=(await (await api.GET()).json()).products[0];
  equal(pick(employeeReload,input(185,65)).size,'XL','Employee receives the same updated sizing');
  equal((await api.POST(request(edit))).status,403,'Employee cannot change examples');
  session={role:'admin'};
  equal((await api.POST(request(edit))).status,409,'Stale revision rejected');
  equal((await api.POST(request({...payload(saved),examples:[{...corrected,confirmedAt:'2100-01-01'}]}))).status,400,'Client cannot forge server confirmation metadata');
  products=[fixture(alpaca)];
  const ambiguous={...payload(products[0]),examples:[{height:183,weight:78,fit:'regular',size:'L'}]};
  equal((await api.POST(request(ambiguous))).status,400,'New color-dependent recommendation requires a color');
  res=await api.POST(request({...ambiguous,examples:[{...ambiguous.examples[0],colorId:'dark-gray'}]}));
  equal(res.status,200,'Save a color-scoped recommendation');
  saved=(await res.json()).product;
  equal(recommendAllColors(saved,input(183,78)).map(r=>r.size),['L','2XL','2XL'],'Color isolation survives API persistence');

  // Optional private audit: production examples are read from outside the repo,
  // never copied into a public fixture. Check preservation with the actual mix.
  if(process.argv[2]) {
    const liveProducts=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    for(const d of reviewedSizeData.products) {
      const p={...fixture(d),...liveProducts.find(p=>p.id===d.id)};
      for(const r of d.rules.filter(r=>r.source!=='catalog')) {
        const actual=recommendAllColors(p,{...input(r.height,r.weight,r.fit,r.reference),lengthPreference:r.lengthPreference});
        for(const a of actual.filter(a=>!r.colors.length||r.colors.includes(a.colorId)))
          equal(a.size,r.manual&&r.reason?.includes('грудь')?null:r.size,`${d.key}: preserve ${r.id} with live examples`);
      }
      for(let h=150;h<=200;h+=5) {
        let prev=[];
        for(let w=40;w<=120;w++) {
          const answers=['closer','regular','relaxed'].map(f=>recommendAllColors(p,input(h,w,f)));
          for(let f=0;f<3;f++) for(const a of answers[f]) {
            const before=prev[f]?.find(r=>r.colorId===a.colorId);
            if(a.size&&before?.size)assert.ok(d.sizes.indexOf(a.size)>=d.sizes.indexOf(before.size),`${d.key}: weight decrease ${h}/${w} fit ${f}: ${before.size}->${a.size}`);
            checks++;
          }
          for(const a of answers[1]) {
            const trio=answers.map(rs=>rs.find(r=>r.colorId===a.colorId));
            if(trio.every(r=>r.size)){const ranks=trio.map(r=>d.sizes.indexOf(r.size));assert.ok(ranks[0]<=ranks[1]&&ranks[1]<=ranks[2],`${d.key}: fit order ${h}/${w}`);checks++;}
          }
          prev=answers;
        }
      }
    }
  }
  console.log(`PASS ${checks} example integration checks: historical/reviewed priority, editor changes, nearby prediction, immutable confirmations, grids, actual fittings, colors, APIs, reload and employee parity.`);
})().catch(e=>{console.error(e);process.exitCode=1});
