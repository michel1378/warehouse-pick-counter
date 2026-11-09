// Deterministic server comparisons. No model transport, photos, card cloning or external writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,prepare}=require('../scripts/prepare-existing-size-transfer.cjs');
const {sizeProfileSchema}=load('src/lib/size-profile.ts');
const {spreadBounds,spreadDistance,parseSpread,recommendColorGrids}=load('src/lib/color-size-grids.ts');
const profile=require('../scripts/lib/alpaca-size-profile.cjs')({sizeProfileSchema,spreadBounds});
assert.equal(sizeProfileSchema.safeParse({...profile,garment:'trousers'}).success,false);
const {renderToStaticMarkup}=require('react-dom/server'),{createElement}=require('react');
const table=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridsTable.tsx').ColorGridsTable,{grids:profile.colorGrids}));
assert.match(table,/42\/43\/44/);assert.match(table,/68\/70\/71/);assert.match(table,/Расчётные — не измерены/);
const editor=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridEditor.tsx').ColorGridEditor,{grids:profile.colorGrids,onChange(){}}));
assert.match(editor,/value="42\/43\/44"/);assert.match(editor,/value="calculated" selected/);
const examples=[{height:150,weight:50,fit:'regular',size:'M'},{height:163,weight:60,fit:'regular',size:'L'}];
const customer={height:175,weight:70,fit:'regular'};
assert.deepEqual(profile.colorGrids.colors[0].rows[0].shoulders,{samples:[42,43,44]});
assert.deepEqual(profile.colorGrids.colors[0].rows[4].length,{samples:[68,70,71]});
assert.equal(spreadDistance({samples:[42,43,44]},42.5),0.5);
assert.equal(spreadDistance({min:42,max:44},42.5),0);
assert.deepEqual(parseSpread('48–50'),{min:48,max:50});assert.deepEqual(parseSpread('42/43/44'),{samples:[42,43,44]});
assert.throws(()=>parseSpread('50–48'));assert.throws(()=>parseSpread('42/42'));
const cases=[
  {input:{shouldersCm:42,chestWidthCm:50},expected:['M','M']},
  {input:{shouldersCm:48,chestWidthCm:54},expected:[null,'XL']},
  {input:{shouldersCm:50,chestWidthCm:56},expected:[null,null],calculated:'2XL'},
  {input:{shouldersCm:52,chestWidthCm:58},expected:[null,null],calculated:'3XL'},
  {input:{height:163,weight:60,shouldersCm:47,chestWidthCm:51},expected:['L',null]},
  {input:{},expected:[null,null]},
];
const results=cases.map(test=>{
  const input={...customer,...test.input},result=recommendColorGrids(profile.colorGrids,input,examples);
  assert.deepEqual(result.colorResults.map(r=>r.size),test.expected);
  if(test.calculated){const dark=result.colorResults[1];assert.equal(dark.source,'calculated');assert.equal(dark.requiresWarehouseCheck,true);assert.match(result.summary,/Если тёмная — уточнить замеры на складе/);assert.match(dark.explanation,new RegExp(test.calculated));}
  if(!test.input.shouldersCm){assert.match(result.clarification,/ширина по груди/);assert(!result.clarification.includes('рост'));}
  return {input,summary:result.summary,colors:result.colorResults.map(({name,size,source,explanation,clarification,lengthText})=>({name,size,source,explanation,clarification,lengthText})),realOpenAiCall:false};
});
assert.equal(results[0].summary,'Альпака — M. Если тёмная — M');
assert.match(results[4].colors[0].explanation,/не подтверждённая примерка/);
for(let shouldersCm=40;shouldersCm<=54;shouldersCm+=0.5)for(let chestWidthCm=46;chestWidthCm<=60;chestWidthCm+=0.5){
  const dark=recommendColorGrids(profile.colorGrids,{...customer,shouldersCm,chestWidthCm},examples).colorResults[1];
  assert(!['2XL','3XL'].includes(dark.size));
  if(dark.size)assert.equal(dark.source,'measured');
}
// Export is read only: do not instantiate its cards in any local or remote database.
if(fs.existsSync('source-catalog.json')){
  const source=JSON.parse(fs.readFileSync('source-catalog.json','utf8').replace(/^\uFEFF/,'')),before=structuredClone(source),plan=prepare(source);
  assert.deepEqual(source,before);assert.equal(plan.cards[0].id,'7474f167-d6eb-46b6-82be-f07f2275b18f');
  assert.equal(plan.cards[1].id,'a92d78d6-90c1-4938-8d14-f01859925511');
  assert(plan.cards.every(c=>Object.keys(c.set).join(',')==='size_profile'));
}
fs.writeFileSync('docs/alpaca-size-grid-check-2026-11-09.json',JSON.stringify({test:'server comparisons, no OpenAI and no production updates',results},null,2)+'\n');
console.log('PASS: two independent colors; ranges versus discrete samples; M/M and measured dark XL; dark calculated 2XL/3XL never ship (841 comparisons); old guidance unconfirmed; no-measure clarification; original export unchanged.');
