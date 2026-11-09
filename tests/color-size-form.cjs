// Browser test on the already running isolated stand. Never loads source cards,
// inserts products or contacts production. Temporarily edits its generic top,
// then restores that fixture's original profile in finally.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('../scripts/prepare-existing-size-transfer.cjs');
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'..','playwright','index.js')));
if(!bin)throw new Error('Run with npm exec --package playwright -- node tests/color-size-form.cjs');
const {chromium}=require(path.resolve(bin,'..','playwright'));
const entry=process.env.SIZE_TEST_ENTRY||'http://127.0.0.1:64919';
const base=process.env.SIZE_TEST_BASE||'http://127.0.0.1:64920';
if(![entry,base].every(url=>new URL(url).hostname==='127.0.0.1'))throw new Error('Isolated loopback stand only');
const id='e5f81908-0a6a-4514-af98-54770af6d603';
const profile=require('../scripts/lib/alpaca-size-profile.cjs')({...load('src/lib/size-profile.ts'),...load('src/lib/color-size-grids.ts')});
profile.colorGrids.colors=profile.colorGrids.colors.slice(0,2);
let browser,admin,original,touched=false;const checks=[];
const payload=(row,grid)=>({id,revision:row.revision,name:row.name,note:row.note,sizes:row.sizes,examples:row.examples,
  active:row.active,show_in_sizes:row.show_in_sizes,show_in_availability:row.show_in_availability,size_profile:grid});
async function getCard(){const response=await admin.request.get(base+'/api/sizes');assert(response.ok());return(await response.json()).products.find(p=>p.id===id);}
async function save(row,grid){const response=await admin.request.post(base+'/api/sizes',{headers:{origin:base},data:payload(row,grid)});assert.equal(response.status(),200,await response.text());}
(async()=>{try{
  browser=await chromium.launch({channel:'msedge',headless:true});admin=await browser.newContext();
  await admin.route('**/*',route=>{
    const url=new URL(route.request().url());
    return [base,entry].includes(url.origin)&&!url.pathname.endsWith('/photo')?route.continue():route.abort();
  });
  const page=await admin.newPage();await page.goto(entry+'/enter/admin');original=await getCard();
  assert(original&&original.name==='Тестовый верх','Only the existing generic fixture is allowed');
  await save(original,profile);touched=true;await page.reload();
  const card=page.locator('article').filter({has:page.getByText('Тестовый верх',{exact:true})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  assert.equal(await card.getByLabel('Основной цвет: Плечи, M',{exact:true}).inputValue(),'42/43/44');
  assert.equal(await card.getByLabel('Тёмный цвет: источник, 2XL',{exact:true}).inputValue(),'calculated');
  const sleeve=card.getByLabel('Основной цвет: Рукав, M',{exact:true});
  await sleeve.fill('64–62');assert.equal(await sleeve.evaluate(el=>el.checkValidity()),false);
  await sleeve.fill('62–64');assert.equal(await sleeve.evaluate(el=>el.checkValidity()),true);
  const saving=page.waitForResponse(r=>r.url()===base+'/api/sizes'&&r.request().method()==='POST');
  await card.getByRole('button',{name:'Сохранить вещь',exact:true}).click();assert.equal((await saving).status(),200);
  const saved=await getCard();assert.deepEqual(saved.size_profile.colorGrids.colors[0].rows[0].sleeve,{min:62,max:64});
  for(const key of ['id','name','note','examples','sizes','photo_count','active','show_in_sizes','show_in_availability'])assert.deepEqual(saved[key],original[key],key);
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();assert.equal(await card.getByLabel('Основной цвет: Рукав, M',{exact:true}).inputValue(),'62–64');
  checks.push({test:'admin edits, saves and reopens ranges; calculated status retained; original fixture metadata unchanged',passed:true});
  const beforeThird=await getCard();
  await card.getByRole('button',{name:'+ Добавить цвет',exact:true}).click();
  await card.getByLabel('Название цвета',{exact:true}).fill('Светло-бежевый');
  const beige=load('src/lib/size-color-presets.ts').alpacaLightBeigeColor();
  for(const row of beige.rows)for(const [key,label] of [['shoulders','Плечи'],['chest','Грудь'],['length','Длина'],['sleeve','Рукав']])
    await card.getByLabel(`Светло-бежевый: ${label}, ${row.size}`,{exact:true}).fill(String(row[key]));
  const savingThird=page.waitForResponse(r=>r.url()===base+'/api/sizes'&&r.request().method()==='POST');
  await card.getByRole('button',{name:'Сохранить вещь',exact:true}).click();assert.equal((await savingThird).status(),200);
  const withThird=await getCard();assert.equal(withThird.size_profile.colorGrids.colors.length,3);
  assert.deepEqual(withThird.size_profile.colorGrids.colors.slice(0,2),beforeThird.size_profile.colorGrids.colors);
  const {colorGrids:priorColors,...priorProfileSettings}=beforeThird.size_profile;
  const {colorGrids:afterColors,...afterProfileSettings}=withThird.size_profile;
  assert.deepEqual(afterProfileSettings,priorProfileSettings);
  for(const key of ['id','name','note','examples','sizes','photo_count','active','show_in_sizes','show_in_availability'])assert.deepEqual(withThird[key],beforeThird[key],key);
  const savedBeige=withThird.size_profile.colorGrids.colors.find(c=>c.name==='Светло-бежевый');assert.deepEqual(savedBeige.rows,beige.rows);
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();assert.equal(await card.getByLabel('Светло-бежевый: Плечи, M',{exact:true}).inputValue(),'44');
  checks.push({test:'third color added through editor, saved and reopened; two earlier grids and metadata retained',passed:true});
  const employee=await browser.newContext();await employee.route('**/*',route=>{
    const url=new URL(route.request().url());return [base,entry].includes(url.origin)&&!url.pathname.endsWith('/photo')?route.continue():route.abort();
  });
  const staff=await employee.newPage();await staff.goto(entry+'/enter/employee');
  const staffCard=staff.locator('article').filter({has:staff.getByText('Тестовый верх',{exact:true})});
  await staffCard.getByRole('button',{name:/Тестовый верх/}).click();
  await staffCard.getByLabel('Рост, см',{exact:true}).fill('175');await staffCard.getByLabel('Вес, кг',{exact:true}).fill('70');
  for(const [shoulders,chest,expected] of [['42','50','Альпака — M. Если тёмная — M'],['48','54','Альпака — уточнить замеры на складе. Если тёмная — XL'],['50','56','Альпака — уточнить замеры на складе. Если тёмная — уточнить замеры на складе'],['52','58','Альпака — уточнить замеры на складе. Если тёмная — уточнить замеры на складе'],['','','Альпака — уточнить мерку. Если тёмная — уточнить мерку']]){
    await staffCard.getByLabel('Плечи любимой вещи, см (необязательно)',{exact:true}).fill(shoulders);
    await staffCard.getByLabel('Ширина по груди любимой вещи, см (необязательно)',{exact:true}).fill(chest);
    const waiting=staff.waitForResponse(r=>r.url()===base+'/api/sizes/recommend');
    await staffCard.getByRole('button',{name:'Подобрать',exact:true}).click();const response=await waiting;assert.equal(response.status(),200);
    const {result}=await response.json();const expectedThree=expected+`. Светло-бежевый — ${shoulders?'уточнить замеры на складе':'уточнить мерку'}`;assert.equal(result.summary,expectedThree);
    await staffCard.locator('.size-final-choice').filter({hasText:expectedThree}).waitFor();
    const actual=await staffCard.locator('.size-final-choice').innerText();assert.equal(actual,expectedThree);
    checks.push({input:{height:175,weight:70,fit:'regular',shouldersCm:shoulders||null,chestWidthCm:chest||null},expected:expectedThree,actual,explanations:result.colorResults.map(r=>({color:r.name,explanation:r.explanation,clarification:r.clarification})),passed:true,realOpenAiCall:false});
  }
  const colorSelect=staffCard.getByLabel('Цвет для подбора',{exact:true});assert.equal(await colorSelect.locator('option').count(),4);
  await colorSelect.selectOption({label:'Светло-бежевый'});
  for(const row of beige.rows){
    await staffCard.getByLabel('Плечи любимой вещи, см (необязательно)',{exact:true}).fill(String(row.shoulders));
    await staffCard.getByLabel('Ширина по груди любимой вещи, см (необязательно)',{exact:true}).fill(String(row.chest));
    const waiting=staff.waitForResponse(r=>r.url()===base+'/api/sizes/recommend');await staffCard.getByRole('button',{name:'Подобрать',exact:true}).click();
    const response=await waiting;assert.equal(response.status(),200);assert.equal(response.request().postDataJSON().colorKey,savedBeige.key);
    const {result}=await response.json();assert.equal(result.size,row.size);assert.equal(result.colorResults.length,1);assert.equal(result.colorResults[0].key,savedBeige.key);
    await staffCard.locator('.size-final-choice').filter({hasText:`Светло-бежевый — ${row.size}`}).waitFor();
    checks.push({test:'selected beige grid',input:{shouldersCm:row.shoulders,chestWidthCm:row.chest,colorKey:savedBeige.key},actual:result.summary,passed:true,realOpenAiCall:false});
  }
  await employee.close();
}finally{
  if(touched){const current=await getCard();await save(current,original.size_profile);const restored=await getCard();assert.deepEqual(restored.size_profile,original.size_profile);}
  if(browser)await browser.close();
}
fs.writeFileSync('docs/alpaca-beige-form-check-2026-11-09.json',JSON.stringify({environment:'existing isolated generic test fixture, source cards not cloned; photo requests blocked; original profile restored; fixture revision advanced by saves',productionChanged:false,realOpenAiCalls:0,checks},null,2)+'\n');
console.log('PASS browser: third grid added in existing fixture editor, saved and reopened; three color choices, five beige recommendations and prior-color scenarios; original grids and metadata retained, fixture restored');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
