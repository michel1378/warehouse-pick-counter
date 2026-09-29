const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {NextRequest}=require('next/server');let mode='ready',calls=[];const id='11111111-1111-4111-8111-111111111111';
const mocks={
 '@/lib/env':{env:()=>({SCANNER_AGENT_API_TOKEN:'test',WAREHOUSE_TIMEZONE:'Europe/Moscow'})},
 '@/lib/scanner-agent':{validAgentToken:t=>t==='test',agentRateLimited:()=>false},
 '@/lib/supabase':{logSupabaseError(){},createAdminClient:()=>({
  from:()=>({select(){return this},eq(){return this},then(resolve){return Promise.resolve({data:[],error:{code:'08006'}}).then(resolve)}}),
  rpc:async(name,args)=>{calls.push({name,args});
   if(mode==='schema')return {error:{code:'42703'}};
   if(mode==='db')return {error:{code:'08006'}};
   if(args.p_probe)return {data:{ready:true,scanReady:true,version:2}};
   const q=args.p_request;return {data:{eventId:q.event_id,acknowledged:true,result:mode==='inactive'?'rejected':mode==='duplicate'?'duplicate':load('src/lib/barcode.ts').validBarcode(q.barcode)?'counted':'rejected',reason:mode==='inactive'?'employee_inactive':'fixture'}};
  }
 })}
};
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:n=>mocks[n]??(n.startsWith('@/')?load('src/'+n.slice(2)+'.ts'):require(n)),console:{info(){}},performance});return exports;}
const scan=load('src/app/api/scanner-agent/scan/route.ts'),health=load('src/app/api/scanner-agent/health/route.ts');
const body={event_id:'22222222-2222-4222-8222-222222222222',employee_identifier:id,barcode:'0012345678',duration_ms:100,scanner_device:'fixture',shift_id:'33333333-3333-4333-8333-333333333333',scanned_at:'2026-09-28T08:00:00Z'};
const request=(payload=body,token='test',method='POST')=>new NextRequest('https://example.invalid/api/scanner-agent/scan',{method,headers:{authorization:'Bearer '+token},...(method==='POST'?{body:JSON.stringify(payload)}:{})});
(async()=>{
 assert.equal(health.GET(request(body,'test','GET')).status,200);
 for(const failure of ['schema','db']){mode=failure;const r=await scan.GET(request(body,'test','GET'));assert.equal(r.status,503);assert.equal((await r.json()).ready,false);assert.equal((await scan.POST(request())).status,503);}
 mode='ready';assert.equal((await (await scan.GET(request(body,'test','GET'))).json()).ready,true);
 assert.equal((await scan.GET(request(body,'wrong','GET'))).status,401);assert.equal((await scan.POST(request(body,'wrong'))).status,401);
 for(const [input,normalized,valid] of JSON.parse(fs.readFileSync('tests/fixtures/barcodes.json'))){const policy=load('src/lib/barcode.ts');assert.equal(policy.normalizeBarcode(input),normalized);assert.equal(policy.validBarcode(normalized),valid);if(input.includes('\0'))continue;const r=await scan.POST(request({...body,barcode:input}));assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_request.barcode,normalized);assert.equal((await r.json()).result,valid?'counted':'rejected');}
 mode='inactive';assert.equal((await (await scan.POST(request())).json()).result,'rejected');
 mode='duplicate';assert.equal((await (await scan.POST(request())).json()).result,'duplicate');
 // Legacy PIN lookup database error must be transient, not inactive/403.
 assert.equal((await scan.POST(request({...body,employee_identifier:'1234'}))).status,503);
 assert.equal((await scan.POST(request({...body,event_id:'invalid'}))).status,422);
 console.log('PASS routes: health != readiness, broken RPC/DB, token guard, business acknowledgements, shared barcode vectors, transient lookup errors, malformed envelope');
})().catch(e=>{console.error(e);process.exitCode=1;});
