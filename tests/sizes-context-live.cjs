// Explicit real OpenAI evaluation, never connects to a database or simulates HTTP.
const fs=require('node:fs'),assert=require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
if(!process.env.OPENAI_API_KEY?.trim())throw Error('OPENAI_API_KEY is missing');
if(process.env.WAREHOUSE_SIZE_TEST_ORIGIN||/size-ai-transport/.test(process.env.NODE_OPTIONS||''))throw Error('Mock transport must not be present');
const {load}=require('../scripts/prepare-existing-size-transfer.cjs');
const {recommendContextualSize,CONTEXT_SIZE_MODEL}=load('src/lib/size-context.ts');
const profile=require('../scripts/lib/alpaca-size-profile.cjs')({...load('src/lib/size-profile.ts'),...load('src/lib/color-size-grids.ts')});
const source=JSON.parse(fs.readFileSync('source-catalog.json','utf8').replace(/^\uFEFF/,''));
const products=Array.isArray(source)?source:source.products;
const alpaca=products.find(p=>p.id==='a92d78d6-90c1-4938-8d14-f01859925511');
const trousers=products.find(p=>p.id==='7474f167-d6eb-46b6-82be-f07f2275b18f');
assert(alpaca&&trousers);
let observations=[];const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const response=await nativeFetch(input,init),url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.origin==='https://api.openai.com'&&url.pathname==='/v1/responses'){
    const data=await response.clone().json();observations.push({httpStatus:response.status,model:data.model,status:data.status,
      rawAnswer:data.output?.filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n'),usage:data.usage});
  }
  return response;
};
(async()=>{
  const OpenAI=require('openai').default,model=process.env.OPENAI_MODEL_SIZES?.trim()||CONTEXT_SIZE_MODEL;
  await new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:20000,maxRetries:0}).models.retrieve(model);
  const checks=[];
  for(const [name,product,grid,customer] of [
    ['Alpaca 175/70 without garment measures',alpaca,profile,{height:175,weight:70,fit:'regular'}],
    ['Alpaca 180/75 without garment measures',alpaca,profile,{height:180,weight:75,fit:'regular'}],
    ['Alpaca shoulders 50 chest 54',alpaca,profile,{height:175,weight:70,fit:'regular',shouldersCm:50,chestWidthCm:54}],
    ['Huge trousers 175/67 without waist',trousers,load('src/lib/size-profile.ts').hugeTrousersProfile(),{height:175,weight:67,fit:'regular'}],
    ['Huge trousers 175/67 waist 39, no OpenAI',trousers,load('src/lib/size-profile.ts').hugeTrousersProfile(),{height:175,weight:67,fit:'regular',halfWaistCm:39}],
  ]){
    observations=[];
    const result=await recommendContextualSize(product,grid,customer);
    const record={name,environment:'local saved source metadata and project grids; real OpenAI API; production UI not verified',product:product.name,input:customer,
      result,realApiCalls:observations.length,observations};checks.push(record);console.log(JSON.stringify(record));
    assert.notEqual(result.providerStatus,'unavailable');
    if(customer.shouldersCm===50){const beige=result.colorResults.find(r=>r.key==='light_beige');assert.equal(beige.size,'2XL');assert.equal(beige.approximate,false);}
    if(customer.halfWaistCm===39){assert.equal(result.size,'M');assert.equal(observations.length,0);assert.equal(result.providerStatus,'not_needed');}
    assert(!result.colorResults?.some(r=>r.key==='dark'&&['2XL','3XL'].includes(r.size)));
  }
  fs.writeFileSync('docs/sizes-color-fit-pants-live-2026-11-09.json',JSON.stringify({model,productionDatabaseChanged:false,checks},null,2)+'\n');
})().catch(error=>{console.error(JSON.stringify({status:'live_check_failed',name:error.name,statusCode:error.status??null}));process.exitCode=1;});
