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
const id=process.env.SIZE_TEST_PRODUCT_ID||'e5f81908-0a6a-4514-af98-54770af6d603';
const preliminarySizes=id==='a92d78d6-90c1-4938-8d14-f01859925511'?['XL','L','XL']:['XL','XL','XL']; // Explicit mock, not model quality.
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
  const staff=await employee.newPage();await staff.setViewportSize({width:360,height:900});await staff.goto(entry+'/enter/employee');
  const staffCard=staff.locator('article').filter({has:staff.getByText('Тестовый верх',{exact:true})});
  await staffCard.getByRole('button',{name:/Тестовый верх/}).click();
  const picker=staffCard.locator('.size-picker');
  assert.equal(await picker.getByRole('button',{name:'Подобрать',exact:true}).count(),0);
  assert.equal(await picker.locator('details,select').count(),0);
  assert.equal(await picker.locator('input[type=number]').count(),5);
  assert.equal(await picker.getByLabel('Плечи',{exact:true}).getAttribute('required'),null);
  let requests=0;const sent=[];staff.on('request',r=>{if(r.url()===base+'/api/sizes/recommend'){requests++;sent.push({at:Date.now(),input:r.postDataJSON()});}});
  const waitResponse=()=>staff.waitForResponse(r=>r.url()===base+'/api/sizes/recommend'&&r.request().method()==='POST');
  const lines=picker.locator('.size-color-result');
  async function verifyResponse(response,expected,before){
    assert.equal(response.status(),200);assert.equal(requests-before,1);
    const {result}=await response.json();assert.deepEqual(result.colorResults.map(r=>r.size),expected);
    assert.equal(response.request().postDataJSON().colorKey,undefined);
    await lines.first().waitFor();
    const actual=await lines.allTextContents();
    assert.deepEqual(actual,result.colorResults.map(r=>r.name+' — '+(r.size&&r.approximate?'≈ ':'')+(r.size??r.clarification)));
    assert(!/предвар|ближайш|налич|рукав|ткань|владел|длина/i.test(await picker.locator('.size-answer').innerText()));
    return actual;
  }
  let before=requests,waiting=waitResponse();
  await picker.getByLabel('Рост',{exact:true}).pressSequentially('175',{delay:40});
  await picker.getByLabel('Вес',{exact:true}).pressSequentially('70',{delay:40});
  let actual=await verifyResponse(await waiting,preliminarySizes,before);
  assert.deepEqual(actual,['Основной цвет','Тёмный цвет','Светло-бежевый'].map((name,i)=>name+' — ≈ '+preliminarySizes[i]));
  assert.equal(sent.at(-1).input.shouldersCm,undefined);assert.equal(sent.at(-1).input.chestWidthCm,undefined);
  const preliminaryScreenshot=path.join(require('node:os').tmpdir(),'warehouse-alpaca-adjusted-preliminary.png');
  await picker.screenshot({path:preliminaryScreenshot});
  checks.push({test:'height weight and fit alone produce shared approximate owner anchor, no fabricated item measurements',input:{height:175,weight:70,fit:'regular'},actual,screenshot:preliminaryScreenshot,passed:true,realOpenAiCall:false});
  before=requests;waiting=waitResponse();await picker.getByLabel('Возраст',{exact:true}).fill('35');
  await verifyResponse(await waiting,preliminarySizes,before);assert.equal(sent.at(-1).input.ageYears,35);
  before=requests;waiting=waitResponse();await picker.getByLabel('Возраст',{exact:true}).fill('');
  await verifyResponse(await waiting,preliminarySizes,before);
  checks.push({test:'optional age transmitted and cleared; adult age does not force a UI size offset',passed:true,realOpenAiCall:false});
  before=requests;waiting=waitResponse();
  await picker.getByLabel('Плечи',{exact:true}).pressSequentially('50',{delay:40});
  await picker.getByLabel('Грудь',{exact:true}).pressSequentially('54',{delay:40});
  const stoppedAt=Date.now();
  await staff.waitForTimeout(200);assert.equal(requests,before);
  actual=await verifyResponse(await waiting,['3XL','XL','2XL'],before);
  assert(sent.at(-1).at-stoppedAt>=400,'Debounce must wait after the last digit');
  assert.deepEqual(actual,['Основной цвет — ≈ 3XL','Тёмный цвет — ≈ XL','Светло-бежевый — 2XL']);
  assert.equal(await staff.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const bounds=await picker.boundingBox();assert(bounds.width<=330);
  for(const line of await lines.all())assert((await line.boundingBox()).x+(await line.boundingBox()).width<=360);
  const styles=await lines.first().evaluate(el=>{
    const name=el.querySelector('.size-color-name'),value=el.querySelector('.size-result-value'),a=getComputedStyle(name),b=getComputedStyle(value);
    return {nameWeight:a.fontWeight,nameColor:a.color,sizeWeight:b.fontWeight,sizeColor:b.color,sizePx:b.fontSize,sameLine:Math.abs(name.getBoundingClientRect().bottom-value.getBoundingClientRect().bottom)<5};
  });
  assert.equal(styles.nameWeight,'400');assert.equal(styles.sizeWeight,'700');assert.equal(styles.sizePx,'24px');assert.notEqual(styles.sizeColor,styles.nameColor);assert(styles.sameLine);
  const screenshot=path.join(require('node:os').tmpdir(),'warehouse-alpaca-measured-green.png');
  await picker.screenshot({path:screenshot});
  checks.push({test:'narrow card, measured grid overrides owner anchor; exact beige 2XL and green 24px size',width:bounds.width,input:{height:175,weight:70,fit:'regular',shouldersCm:50,chestWidthCm:54},actual,styles,requests:requests-before,screenshot,passed:true,realOpenAiCall:false});
  for(const [shoulders,chest,expected] of [['48','54',[null,'XL','XL']],['50','56',['3XL',null,null]],['52','58',['3XL',null,'3XL']],['','',preliminarySizes]]){
    before=requests;waiting=waitResponse();
    await picker.getByLabel('Плечи',{exact:true}).fill(shoulders);
    assert.equal(await lines.count(),0,'Old result disappears immediately');
    await picker.getByLabel('Грудь',{exact:true}).fill(chest);
    actual=await verifyResponse(await waiting,expected,before);
    checks.push({input:{shouldersCm:shoulders||null,chestWidthCm:chest||null},actual,passed:true,realOpenAiCall:false});
  }
  for(const row of beige.rows){
    before=requests;waiting=waitResponse();
    await picker.getByLabel('Плечи',{exact:true}).fill(String(row.shoulders));
    await picker.getByLabel('Грудь',{exact:true}).fill(String(row.chest));
    const response=await waiting;assert.equal(response.status(),200);assert.equal(requests-before,1);
    const {result}=await response.json();assert.equal(result.colorResults.length,3);assert.equal(result.colorResults.find(c=>c.key===savedBeige.key).size,row.size);
    await lines.filter({hasText:'Светло-бежевый — '+row.size}).waitFor();
    checks.push({test:'automatic beige exact row',input:{shouldersCm:row.shoulders,chestWidthCm:row.chest},actual:await lines.allTextContents(),passed:true,realOpenAiCall:false});
  }
  before=requests;waiting=waitResponse();await picker.getByRole('radio',{name:'Немного оверсайз',exact:true}).check();
  const fitResponse=await waiting;assert.equal(fitResponse.request().postDataJSON().fit,'loose');await verifyResponse(fitResponse,['3XL',null,'3XL'],before);
  checks.push({test:'fit change triggers automatic recalculation',passed:true});
  before=requests;await picker.getByLabel('Плечи',{exact:true}).fill('5');assert.equal(await lines.count(),0);
  await staff.waitForTimeout(650);assert.equal(requests,before);
  checks.push({test:'invalid partial measurement sends no request and clears result',passed:true});
  // Delay an obsolete response; the newer parameters must win even if the old request finishes last.
  let releaseOld,oldSeen;const hold=new Promise(resolve=>{releaseOld=resolve;}),seen=new Promise(resolve=>{oldSeen=resolve;});
  await employee.route('**/api/sizes/recommend',async route=>{
    const input=route.request().postDataJSON();
    if(input.shouldersCm===51){const response=await route.fetch();oldSeen();await hold;await route.fulfill({response}).catch(()=>{});}
    else await route.continue();
  });
  await picker.getByLabel('Плечи',{exact:true}).fill('51');await seen;
  waiting=waitResponse();await picker.getByLabel('Плечи',{exact:true}).fill('50');await picker.getByLabel('Грудь',{exact:true}).fill('54');
  await waiting;await lines.filter({hasText:'Светло-бежевый — 2XL'}).waitFor();
  releaseOld();await staff.waitForTimeout(150);
  assert.deepEqual(await lines.allTextContents(),['Основной цвет — ≈ 3XL','Тёмный цвет — ≈ XL','Светло-бежевый — 2XL']);
  checks.push({test:'delayed obsolete response cannot replace current result',passed:true});
  // Reset before debounce and while a request is in flight.
  before=requests;await picker.getByLabel('Вес',{exact:true}).fill('71');await picker.getByRole('button',{name:'Новый клиент',exact:true}).click();
  await staff.waitForTimeout(650);assert.equal(requests,before);assert.equal(await lines.count(),0);
  for(const input of await picker.locator('input[type=number]').all())assert.equal(await input.inputValue(),'');
  assert.equal(await picker.getByRole('radio',{name:'В размер',exact:true}).isChecked(),true);
  checks.push({test:'new customer clears all fields, result and pending debounce',passed:true});
  const beforeLayout=await getCard();
  for(const key of Object.keys(withThird).filter(k=>!['revision','updated_at'].includes(k)))assert.deepEqual(beforeLayout[key],withThird[key],key);
  await employee.close();
}finally{
  try{
    if(touched){const current=await getCard();await save(current,original.size_profile);const restored=await getCard();assert.deepEqual(restored.size_profile,original.size_profile);}
  }finally{if(browser)await browser.close();}
}
fs.writeFileSync('docs/sizes-context-form-check-2026-11-09.json',JSON.stringify({environment:'synthetic in-memory top with grids and two unconfirmed owner anchors; OpenAI transport explicitly mocked; no source card or photos copied; original profile restored; fixture revision advanced by saves',productionChanged:false,realOpenAiCalls:0,checks},null,2)+'\n');
console.log('PASS compact browser: automatic three-color results in narrow card; debounce, optional measurements, fit updates, partial dashes, stale response guard and reset; original fixture restored');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
