const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

module.exports = async ({ page, baseURL, fixtureOrigin, observations, login }) => {
  const report = { date:'2026-11-09', environment:'Isolated local Next.js + PGlite; real OpenAI transport',
    employeeURL:fixtureOrigin+'/enter/employee', adminURL:fixtureOrigin+'/enter/admin', localSite:baseURL,
    productionDatabaseUsed:false, published:false, checks:[] };
  async function save() {
    await page.getByRole('button',{name:'Сохранить вещь',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Сохранено'}).waitFor();
  }
  async function submit(name) {
    const before = observations.length;
    const promise = page.waitForResponse(r=>r.url().endsWith('/api/sizes/recommend') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Подобрать',exact:true}).click();
    const response=await promise, body=await response.json();
    await page.getByRole('button',{name:'Подобрать',exact:true}).waitFor();
    const rendered=await page.locator('.size-answer').innerText();
    const evidence=observations.slice(before);
    const screenshot=path.join(os.tmpdir(),'warehouse-size-pilot-'+name+'.png');
    await page.screenshot({path:screenshot,fullPage:true});
    const check={name,actualSiteResponse:body,renderedAnswer:rendered,realOpenAi:evidence.length>0,openAiEvidence:evidence,screenshot};
    report.checks.push(check); console.log(JSON.stringify(check));
    fs.writeFileSync(path.resolve('docs/size-pilot-updated-form-2026-11-09.json'),JSON.stringify(report,null,2)+'\n');
    assert.equal(response.status(),200); return body;
  }
  await login('admin'); await page.goto(baseURL+'/admin/sizes');
  let card=page.locator('.size-card').filter({has:page.getByRole('button',{name:/Брюки Огромнейшие/})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  assert.equal(await card.locator('.size-editor').count(),1);
  await page.getByLabel('Крой',{exact:true}).fill('Широкий — тест редактирования');
  await page.getByLabel('Маломерность и особенности посадки').fill('Маломерит на размер; тест сохранения');
  await page.getByLabel('Полупояс, строка сетки 3',{exact:true}).fill('42.2');
  await save(); await page.reload();
  card=page.locator('.size-card').filter({has:page.getByRole('button',{name:/Брюки Огромнейшие/})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  assert.equal(await page.getByLabel('Полупояс, строка сетки 3',{exact:true}).inputValue(),'42.2');
  assert.equal(await page.getByLabel('Крой',{exact:true}).inputValue(),'Широкий — тест редактирования');
  assert.match(await page.getByLabel('Маломерность и особенности посадки').inputValue(),/тест сохранения/);
  await page.getByLabel('Полупояс, строка сетки 3',{exact:true}).fill('42');
  await page.getByLabel('Крой',{exact:true}).fill('Широкий');
  await page.getByLabel('Маломерность и особенности посадки').fill('Маломерит на размер');
  await save();
  report.trousersSaveReloadEdit=true;

  card=page.locator('.size-card').filter({has:page.getByRole('button',{name:/Тестовый верх/})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  await page.getByRole('button',{name:'Сетка верха',exact:true}).click();
  await page.getByLabel('Крой',{exact:true}).fill('Прямой');
  await page.getByLabel('Растяжимость',{exact:true}).selectOption('slight');
  await page.getByLabel('Ткань и состав').fill('Тестовая ткань, состав не задан');
  for(let i=0;i<3;i++) {
    if(i) await page.getByRole('button',{name:'+ Строка сетки',exact:true}).click();
    await page.getByLabel(`Бирка, строка сетки ${i+1}`,{exact:true}).fill(['S','M','L'][i]);
    for(const [column,value]of [['Плечи',46+i*2],['Ширина по груди',54+i*2],['Длина',70+i*2]])
      await page.getByLabel(`${column}, строка сетки ${i+1}`,{exact:true}).fill(String(value));
  }
  await save(); await page.reload();
  card=page.locator('.size-card').filter({has:page.getByRole('button',{name:/Тестовый верх/})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  assert.equal(await page.getByLabel('Вид вещи',{exact:true}).inputValue(),'top');
  assert.equal(await page.getByLabel('Ширина по груди, строка сетки 2',{exact:true}).inputValue(),'56');
  await page.getByLabel('Ширина по груди, строка сетки 2',{exact:true}).fill('56.5'); await save(); await page.reload();
  card=page.locator('.size-card').filter({has:page.getByRole('button',{name:/Тестовый верх/})});
  await card.getByRole('button',{name:'Редактировать',exact:true}).click();
  assert.equal(await page.getByLabel('Ширина по груди, строка сетки 2',{exact:true}).inputValue(),'56.5');
  await page.getByLabel('Ширина по груди, строка сетки 2',{exact:true}).fill('56'); await save();
  report.topCreateSaveReloadEdit=true;
  console.log('PASS inline admin editing: numeric grids, cut, stretch and sizing note persist across reload; upper grid created and edited');

  await login('employee'); await page.goto(baseURL+'/sizes');
  await page.getByRole('button',{name:/Брюки Огромнейшие/}).click();
  await page.getByLabel('Рост, см',{exact:true}).fill('175'); await page.getByLabel('Вес, кг',{exact:true}).fill('70');
  await page.getByLabel('Полупояс подходящих брюк, см (необязательно)').fill('40.5');
  let body=await submit('tie');
  assert.equal(body.result.size,null); assert.match(body.result.explanation,/M на 1,5 см уже, L на 1,5 см шире/);
  assert.match(body.result.clarification,/впритык или с запасом/);
  assert.deepEqual(body.comparison.nearest,['M','L']);
  await page.getByRole('radio',{name:'Впритык',exact:true}).check();
  body=await submit('snug'); assert.equal(body.result.size,'L'); assert.equal(await page.locator('.size-answer strong').innerText(),'Положить: L');
  await page.getByRole('button',{name:'Новый клиент',exact:true}).click();
  await page.getByLabel('Рост, см',{exact:true}).fill('175'); await page.getByLabel('Вес, кг',{exact:true}).fill('70');
  body=await submit('no-measurements');
  assert(!/средний|точнее всего|точно подойд/.test(body.result.explanation));
  assert(body.result.size===null ? !!body.result.clarification : /ориентир.*не по подтверждённой/.test(body.result.explanation));
  assert.equal(report.checks.at(-1).openAiEvidence.length,1);
  await page.getByRole('button',{name:/Брюки Огромнейшие/}).click();
  await page.getByRole('button',{name:/Тестовый верх/}).click();
  await page.getByLabel('Рост, см',{exact:true}).fill('175'); await page.getByLabel('Вес, кг',{exact:true}).fill('70');
  assert.equal(await page.getByLabel('Полупояс подходящих брюк, см (необязательно)').count(),0);
  await page.getByLabel('Плечи любимой вещи, см (необязательно)').fill('48');
  await page.getByLabel('Ширина по груди любимой вещи, см (необязательно)').fill('56');
  body=await submit('top'); assert.equal(body.result.size,'M');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  report.mobileViewportPassed=true; report.passed=true;
  fs.writeFileSync(path.resolve('docs/size-pilot-updated-form-2026-11-09.json'),JSON.stringify(report,null,2)+'\n');
  await page.goto(fixtureOrigin+'/enter/employee');
  console.log('PASS pilot forms: both failed scenarios corrected, single final choice, upper measurements and mobile viewport');
};
