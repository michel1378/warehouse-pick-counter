// Deterministic server comparisons. No model transport, photos, card cloning or external writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,prepare}=require('../scripts/prepare-existing-size-transfer.cjs');
const {sizeProfileSchema}=load('src/lib/size-profile.ts');
const {spreadBounds,spreadDistance,parseSpread,recommendColorGrids}=load('src/lib/color-size-grids.ts');
const fullProfile=require('../scripts/lib/alpaca-size-profile.cjs')({sizeProfileSchema,spreadBounds});
// Keep coverage for cards saved before the third color was added.
const profile={...fullProfile,colorGrids:{...fullProfile.colorGrids,colors:fullProfile.colorGrids.colors.slice(0,2)}};
assert.equal(sizeProfileSchema.safeParse({...profile,garment:'trousers'}).success,false);
const {renderToStaticMarkup}=require('react-dom/server'),{createElement}=require('react');
const table=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridsTable.tsx').ColorGridsTable,{grids:profile.colorGrids}));
assert.match(table,/42\/43\/44/);assert.match(table,/68\/70\/71/);assert.match(table,/Расчётные — не измерены/);
const editor=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridEditor.tsx').ColorGridEditor,{grids:profile.colorGrids,onChange(){}}));
assert.match(editor,/value="42\/43\/44"/);assert.match(editor,/value="calculated" selected/);
const examples=[{height:150,weight:50,fit:'regular',size:'M'},{height:163,weight:60,fit:'regular',size:'L'}];
const customer={height:175,weight:70,fit:'regular'};
const {ALPACA_PRODUCT_ID,appendAlpacaLightBeige,alpacaLightBeigeColor}=load('src/lib/size-color-presets.ts');
const prior=structuredClone(profile.colorGrids),threeColors=appendAlpacaLightBeige(profile.colorGrids,ALPACA_PRODUCT_ID);
assert.deepEqual(profile.colorGrids,prior);assert.deepEqual(threeColors.colors.slice(0,2),prior.colors);assert.equal(threeColors.colors.length,3);
assert.strictEqual(appendAlpacaLightBeige(threeColors,ALPACA_PRODUCT_ID),threeColors);
assert.throws(()=>appendAlpacaLightBeige(prior,'another-product'),/существующей карточки/);
const presetEditor=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridEditor.tsx').ColorGridEditor,{grids:prior,productId:ALPACA_PRODUCT_ID,onChange(){}}));
assert.match(presetEditor,/Добавить сетку «Светло-бежевый»/);assert(!editor.includes('Добавить сетку «Светло-бежевый»'));
const savedEditor=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridEditor.tsx').ColorGridEditor,{grids:threeColors,productId:ALPACA_PRODUCT_ID,onChange(){}}));
assert.match(savedEditor,/disabled=""[^>]*>Светло-бежевый уже добавлен/);
assert.deepEqual(alpacaLightBeigeColor().rows.map(r=>[r.size,r.shoulders,r.chest,r.length,r.sleeve,r.source]),[
  ['M',44,48,64,60,'measured'],['L',47,52,66,62,'measured'],['XL',47,54,70,65,'measured'],['2XL',50,54,70,65,'measured'],['3XL',52,56,71,66,'measured']]);
for(const [shouldersCm,chestWidthCm,size] of [[44,48,'M'],[47,52,'L'],[47,54,'XL'],[50,54,'2XL'],[52,56,'3XL']]){
  const result=recommendColorGrids(threeColors,{...customer,colorKey:'light_beige',shouldersCm,chestWidthCm},examples);
  assert.equal(result.size,size);assert.equal(result.colorResults.length,1);assert.equal(result.colorResults[0].key,'light_beige');assert.equal(result.colorResults[0].source,'measured');
}
assert.throws(()=>recommendColorGrids(threeColors,{...customer,colorKey:'missing'}),/SIZE_COLOR_NOT_FOUND/);
const selectedTable=renderToStaticMarkup(createElement(load('src/components/sizes/ColorGridsTable.tsx').ColorGridsTable,{grids:threeColors,colorKey:'light_beige'}));
assert.match(selectedTable,/Светло-бежевый/);assert(!selectedTable.includes('Основной цвет'));assert(!selectedTable.includes('Тёмный цвет'));
assert.deepEqual(profile.colorGrids.colors[0].rows[0].shoulders,{samples:[42,43,44]});
assert.deepEqual(profile.colorGrids.colors[0].rows[4].length,{samples:[68,70,71]});
assert.equal(spreadDistance({samples:[42,43,44]},42.5),0.5);
assert.equal(spreadDistance({min:42,max:44},42.5),0);
assert.deepEqual(parseSpread('48–50'),{min:48,max:50});assert.deepEqual(parseSpread('42/43/44'),{samples:[42,43,44]});
assert.throws(()=>parseSpread('50–48'));assert.throws(()=>parseSpread('42/42'));
const cases=[
  {input:{shouldersCm:42,chestWidthCm:50},expected:['M','M']},
  {input:{shouldersCm:48,chestWidthCm:54},expected:[null,'XL']},
  {input:{shouldersCm:50,chestWidthCm:56},expected:['3XL',null],calculated:'2XL'},
  {input:{shouldersCm:52,chestWidthCm:58},expected:['3XL',null],calculated:'3XL'},
  {input:{height:163,weight:60,shouldersCm:47,chestWidthCm:51},expected:['L','L']},
  {input:{},expected:['L','L']},
];
const results=cases.map(test=>{
  const input={...customer,...test.input},result=recommendColorGrids(profile.colorGrids,input,examples);
  assert.deepEqual(result.colorResults.map(r=>r.size),test.expected);
  if(test.calculated){const dark=result.colorResults[1];assert.equal(dark.source,'calculated');assert.equal(dark.requiresWarehouseCheck,true);assert.match(result.summary,/Тёмный цвет — уточнить замеры на складе/);assert.match(dark.explanation,new RegExp(test.calculated));}
  if(!test.input.shouldersCm){assert(result.colorResults.every(r=>r.approximate));assert(result.colorResults.every(r=>r.comparisons.length===0));}
  return {input,summary:result.summary,colors:result.colorResults.map(({name,size,source,explanation,clarification,lengthText})=>({name,size,source,explanation,clarification,lengthText})),realOpenAiCall:false};
});
assert.equal(results[0].summary,'Основной цвет — M\nТёмный цвет — M');
const allColors=recommendColorGrids(threeColors,{...customer,shouldersCm:50,chestWidthCm:54},examples);
assert.deepEqual(allColors.colorResults.map(r=>r.size),['3XL','XL','2XL']);
assert(allColors.colorResults.slice(0,2).every(r=>r.shortNote.includes('ближайший')));
assert.equal(allColors.colorResults[2].shortNote,undefined);
const answers=renderToStaticMarkup(createElement(load('src/components/sizes/ColorSizeAnswers.tsx').ColorSizeAnswers,{colors:allColors.colorResults}));
assert.equal((answers.match(/class="size-color-result"/g)||[]).length,3);
const answerText=answers.replace(/<[^>]+>/g,'');
assert.match(answerText,/Светло-бежевый — 2XL/);assert.match(answerText,/Основной цвет — ≈ 3XL/);
assert.match(answers,/class="size-result-value"/);
assert(!/ближайший|Предварительно|Обоснование|details/.test(answers));
const partialAnswers=renderToStaticMarkup(createElement(load('src/components/sizes/ColorSizeAnswers.tsx').ColorSizeAnswers,{colors:[{key:'a',name:'Первый цвет',size:null},{key:'b',name:'Второй',size:'M'}]}));
assert.match(partialAnswers.replace(/<[^>]+>/g,''),/Первый цвет — —/);assert.match(partialAnswers.replace(/<[^>]+>/g,''),/Второй — M/);
const ownerOnly=recommendColorGrids(threeColors,customer,examples);
assert.deepEqual(ownerOnly.colorResults.map(r=>r.size),['L','L','L']);
assert(ownerOnly.colorResults.every(r=>r.approximate&&r.comparisons.length===0));
assert.equal(ownerOnly.size,'L');assert.equal(ownerOnly.clarification,null);
const beforePolicy=structuredClone({grids:threeColors,input:customer,examples});
for(let repeat=0;repeat<3;repeat++){
  const adjusted=recommendColorGrids(threeColors,customer,examples,ALPACA_PRODUCT_ID);
  assert.deepEqual(adjusted.colorResults.map(r=>r.size),['XL','XL','XL']);
  assert(adjusted.colorResults.every(r=>r.approximate));
}
assert.deepEqual({grids:threeColors,input:customer,examples},beforePolicy);
assert.deepEqual(recommendColorGrids(threeColors,customer,examples,'another-card').colorResults.map(r=>r.size),['L','L','L']);
const measuredPolicy=recommendColorGrids(threeColors,{...customer,shouldersCm:50,chestWidthCm:54},examples,ALPACA_PRODUCT_ID);
assert.deepEqual(measuredPolicy.colorResults.map(r=>r.size),['3XL','XL','2XL']);
assert.equal(measuredPolicy.colorResults[2].approximate,false);
assert.equal(recommendColorGrids(threeColors,{...customer,shouldersCm:50},examples,ALPACA_PRODUCT_ID).colorResults[2].size,'2XL');
for(const baseSize of ['XL','2XL']){
  const policy=recommendColorGrids(threeColors,customer,[{...customer,size:baseSize}],ALPACA_PRODUCT_ID);
  assert.equal(policy.colorResults[1].size,null);assert.equal(policy.colorResults[1].source,'calculated');assert(policy.colorResults[1].requiresWarehouseCheck);
}
assert(recommendColorGrids(threeColors,customer,[{...customer,size:'3XL'}],ALPACA_PRODUCT_ID).colorResults.every(r=>r.size===null));
assert(recommendColorGrids(threeColors,customer,[],ALPACA_PRODUCT_ID).colorResults.every(r=>r.size===null));
for(const [input,rows] of [[customer,[]],[{...customer,fit:'loose'},examples],[{...customer,height:220,weight:140},examples],[customer,[{...customer,size:'L'},{...customer,size:'XL'}]]]){
  assert(recommendColorGrids(threeColors,input,rows).colorResults.every(r=>r.size===null));
}
const calculatedAnchor=recommendColorGrids(threeColors,customer,[{...customer,size:'2XL'}]);
assert.equal(calculatedAnchor.colorResults[1].size,null);assert.equal(calculatedAnchor.colorResults[1].source,'calculated');
const partial=recommendColorGrids(threeColors,{...customer,shouldersCm:50},examples);
assert.equal(partial.colorResults[2].size,'2XL');assert.equal(partial.colorResults[2].approximate,true);
assert.equal(allColors.colorResults[2].approximate,false);
const renamed=structuredClone(threeColors);renamed.colors[0].name='Белый';
assert.match(recommendColorGrids(renamed,{...customer,shouldersCm:50,chestWidthCm:54}).summary,/^Белый —/);
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
console.log('PASS beige: exact five measured rows, append-only preset bound to original ID, duplicate blocked, prior colors unchanged, selected color only used and rendered');
