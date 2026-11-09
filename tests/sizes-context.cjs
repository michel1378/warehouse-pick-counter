// Regression tests with an explicitly mocked model. These do not measure model quality.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const cache=new Map(),calls=[];let factory,fail=false,session={role:'employee',sub:'test'},allowed=true,product;
class MockOpenAI {constructor(){this.responses={parse:async args=>{
  const payload=JSON.parse(args.input);calls.push({args,payload});if(fail)throw Error('synthetic failure');
  return {status:'completed',output_parsed:{results:factory(payload)}};
}};}}
function load(relative){
  const filename=path.resolve(relative);if(cache.has(filename))return cache.get(filename).exports;
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;cache.set(filename,mod);const original=mod.require.bind(mod);
  mod.require=name=>name==='openai'?MockOpenAI:name==='@/lib/session'?{getSession:async()=>session}:name==='@/lib/supabase'?{logSupabaseError(){},createAdminClient:()=>({
    from:()=>{const filters=[];const query={select(){return query},eq(k,v){filters.push([k,v]);return query},async maybeSingle(){return {data:filters.every(([k,v])=>product[k]===v)?structuredClone(product):null,error:null}}};return query},rpc:async()=>({data:allowed,error:null})
  })}:name.endsWith('.json')?original(name):name.startsWith('@/')?load('src/'+name.slice(2)+'.ts'):name.startsWith('.')?load(path.resolve(path.dirname(filename),name+'.ts')):original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
const core=load('src/lib/size-context.ts'),profile=require('../scripts/lib/alpaca-size-profile.cjs')({...load('src/lib/size-profile.ts'),...load('src/lib/color-size-grids.ts')});
const examples=[{height:150,weight:50,fit:'regular',size:'M'},{height:163,weight:60,fit:'regular',size:'L'}];
const input={height:175,weight:70,fit:'regular'},base={id:'a92d78d6-90c1-4938-8d14-f01859925511',name:'Alpaca',note:'Маломерит',examples,sizes:['M','L','XL','2XL','3XL']};
function answers(payload,size) {size??=payload.product.colors.some(row=>row.fitRule)?'L':'XL';return payload.requestedKeys.map(key=>({key,size,baseSize:size,fitAdjustmentIncluded:false,reason:'Synthetic model response for transport testing only',clarification:null,basis:'owner_examples',exampleIndexes:[0,1]}));}
const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='synthetic-key-not-used-on-network';
const api=load('src/app/api/sizes/recommend/route.ts'),id='e5f81908-0a6a-4514-af98-54770af6d603';
function request(body,origin='http://warehouse.test'){return new Request('http://warehouse.test/api/sizes/recommend',{method:'POST',headers:{origin,host:'warehouse.test','content-type':'application/json'},body:JSON.stringify(body)});}
(async()=>{try{
  factory=answers;let before=calls.length;
  const result=await core.recommendContextualSize(base,profile,input);
  assert.deepEqual(result.colorResults.map(r=>r.size),['XL','L','XL']);assert(result.colorResults.every(r=>r.approximate));assert.equal(calls.length-before,1);
  const sent=calls.at(-1);assert.equal(sent.payload.product.colors.length,3);assert.equal(sent.payload.customer.shouldersCm,null);assert.equal(sent.payload.customer.chestWidthCm,null);
  assert(sent.payload.product.examples.every(e=>e.confirmed===false));assert.notEqual(sent.payload.product.fitNote,profile.fitNote);assert.equal(sent.payload.product.cut,profile.cut);
  assert.deepEqual(sent.payload.product.colors.map(row=>row.fitRule.smallBySteps),[1,0,1]);
  assert.deepEqual(sent.payload.product.colors[0].grid.rows[0].shoulders,{samples:[42,43,44]});assert(!JSON.stringify(sent.payload).includes('synthetic-key'));
  assert.equal((await core.recommendContextualSize(base,profile,input)).providerStatus,'cached');assert.equal(calls.length-before,1);
  await core.recommendContextualSize(base,{...profile,cut:'Changed cut evidence'},input);assert.equal(calls.length-before,2);
  const {applyColorFitRule}=load('src/lib/size-color-fit.ts');
  for(const color of profile.colorGrids.colors){
    const first=applyColorFitRule(base.id,color,{size:'L',baseSize:'L',fitAdjustmentIncluded:false},false);
    assert.equal(first.size,color.key==='dark'?'L':'XL');
    assert.equal(applyColorFitRule(base.id,color,first,false).size,first.size);
    assert.equal(applyColorFitRule(base.id,color,{size:'L',baseSize:'L'},true).size,'L');
  }
  factory=p=>p.requestedKeys.map(key=>({key,size:key==='dark'?'L':'XL',baseSize:'L',fitAdjustmentIncluded:true,reason:'Synthetic already corrected result',clarification:null,basis:'owner_examples',exampleIndexes:[0,1]}));
  assert.deepEqual((await core.recommendContextualSize(base,{...profile,cut:'already adjusted'},input)).colorResults.map(r=>r.size),['XL','L','XL']);
  assert.equal(applyColorFitRule(base.id,profile.colorGrids.colors[1],{size:'2XL',baseSize:'2XL',fitAdjustmentIncluded:false},false).size,null);
  console.log('PASS model transport: one selected item, all color grids/ranges/properties/examples, optional measurements; content cache invalidates on edits');
  factory=p=>p.requestedKeys.map(key=>({key,size:key==='main'?'3XL':'XL',reason:'Synthetic measured candidate',clarification:null,basis:'measurements',exampleIndexes:[]}));
  const measured=await core.recommendContextualSize(base,profile,{...input,shouldersCm:50,chestWidthCm:54});
  assert.deepEqual(measured.colorResults.map(r=>r.size),['3XL','XL','2XL']);assert.equal(measured.colorResults[2].approximate,false);assert(!calls.at(-1).payload.requestedKeys.includes('light_beige'));
  assert(calls.at(-1).payload.product.colors.every(row=>row.fitRule===null));
  const exactPlan=core.planSizeRecommendation(base,profile,{...input,shouldersCm:50,chestWidthCm:54,colorKey:'light_beige'});
  assert.equal(core.hasPendingSizeDecisions(exactPlan),false);
  const dark=await core.recommendContextualSize(base,profile,{...input,shouldersCm:50,chestWidthCm:56,colorKey:'dark'});assert.equal(dark.size,null);assert.equal(dark.providerStatus,'not_needed');
  before=calls.length;const known={...base,examples:[{...input,size:'M',confirmed:true,colorKey:'main'}]};
  const fitted=await core.recommendContextualSize(known,profile,{...input,colorKey:'main'});assert.equal(fitted.size,'M');assert.equal(calls.length,before);
  console.log('PASS priority: exact beige 2XL and confirmed fitting locked, no offset; dark calculated rows blocked');
  factory=p=>p.requestedKeys.map(key=>({key,size:key==='dark'?'3XL':'XL',reason:'Synthetic answer',clarification:null,basis:'owner_examples',exampleIndexes:[0]}));
  const partial=await core.recommendContextualSize({...base,id:'partial'},profile,input);assert.equal(partial.colorResults[0].size,'XL');assert.equal(partial.colorResults[1].size,null);assert.equal(partial.colorResults[2].size,'XL');
  fail=true;const unavailable=await core.recommendContextualSize({...base,id:'failure'},profile,{...input,shouldersCm:50,chestWidthCm:54});fail=false;
  assert.equal(unavailable.colorResults[2].size,'2XL');assert.equal(unavailable.providerStatus,'unavailable');
  factory=p=>p.requestedKeys.map(key=>({key,size:'XL',reason:'Synthetic false confirmed claim',clarification:null,basis:'confirmed_fitting',exampleIndexes:[0]}));
  assert((await core.recommendContextualSize({...base,id:'false-confirmed'},profile,input)).colorResults.every(r=>r.size===null));
  console.log('PASS partial answers: invalid color does not erase valid colors; provider failure preserves exact size; false fitting evidence rejected');
  factory=answers;
  const legacy=await core.recommendContextualSize({...base,id:'no-grid'},null,input);assert.equal(legacy.size,'XL');assert.equal(legacy.approximate,true);
  assert.equal(calls.at(-1).payload.product.colors.length,1);
  const child={garment:'other',fabric:'Cotton',cut:'Child fit',stretch:'none',fitNote:'Children sizes',columns:['Рост','Грудь'],columnKeys:['other','chestWidthCm'],rows:[{size:'80',values:[80,30]},{size:'92',values:[92,32]}]};
  factory=p=>p.requestedKeys.map(key=>({key,size:'80',reason:'Synthetic explicit height chart',clarification:null,basis:'size_chart',exampleIndexes:[]}));
  assert.equal((await core.recommendContextualSize({id:'child',name:'Child top',note:'',examples:[],sizes:['80','92']},child,{height:80,weight:10,ageYears:1,fit:'regular'})).size,'80');
  assert.equal(calls.at(-1).payload.customer.ageYears,1);
  const {sizeAiInputSchema}=load('src/lib/sizes-ai.ts');assert(sizeAiInputSchema.safeParse({productId:id,revision:1,height:80,weight:10,ageYears:1,fit:'regular'}).success);
  assert(!sizeAiInputSchema.safeParse({productId:id,revision:1,...input,ageYears:111}).success);
  console.log('PASS age: optional age reaches selected-item context, child inputs accepted, explicit child height grid supports chart basis');
  product={...base,id,active:true,show_in_sizes:true,revision:1,size_profile:profile};factory=answers;
  const apiInput={productId:id,revision:1,...input};session=null;assert.equal((await api.POST(request(apiInput))).status,401);session={role:'employee',sub:'test'};
  assert.equal((await api.POST(request(apiInput,'http://evil.test'))).status,403);
  assert.equal((await api.POST(request({...apiInput,revision:2}))).status,409);
  assert.equal((await api.POST(request({...apiInput,rows:[]}))).status,400);
  product.active=false;assert.equal((await api.POST(request(apiInput))).status,404);product.active=true;
  allowed=false;let response=await api.POST(request({...apiInput,shouldersCm:50,chestWidthCm:54}));assert.equal(response.status,200);let data=await response.json();
  assert.equal(data.result.providerStatus,'limited');assert.equal(data.result.colorResults[2].size,'2XL');assert.equal(data.retryAfterSeconds,5);allowed=true;
  response=await api.POST(request(apiInput));data=await response.json();assert.equal(data.result.providerStatus,'completed');assert.deepEqual(data.result.colorResults.map(r=>r.size),['XL','XL','XL']);
  product.note='configuration check';delete process.env.OPENAI_API_KEY;data=await(await api.POST(request({...apiInput,shouldersCm:50,chestWidthCm:54}))).json();
  assert.equal(data.result.providerStatus,'not_configured');assert.equal(data.result.colorResults[2].size,'2XL');
  console.log('PASS API guards: authentication, origin, strict input, hidden/stale items, shared budget, partial results during limits/configuration failure');
}finally{if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}})().catch(error=>{console.error(error);process.exitCode=1;});
