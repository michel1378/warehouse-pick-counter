// Browser → real Next routes → real supabase-js → local SQL; OpenAI transport is synthetic.
// npm exec --yes --package playwright -- node tests/sizes-ai-browser.cjs
// Real form verification: append --live-form (two real OpenAI calls; isolated database).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net');
const { spawn } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const pilotForm = process.argv.includes('--pilot-form');
const colorForm = process.argv.includes('--color-form');
const employeeLiveForm = process.argv.includes('--employee-live-form');
const keepOpen = process.argv.includes('--keep-open');
const liveForm = process.argv.includes('--live-form') || pilotForm || employeeLiveForm;
if (liveForm) {
  require('@next/env').loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is missing; live form test cannot start');
}
const bin = process.env.PATH.split(path.delimiter).find(p => fs.existsSync(path.resolve(p, '..', 'playwright', 'index.js')));
if (!bin) throw new Error('Run with npm exec --package playwright as documented');
const { chromium } = require(path.resolve(bin, '..', 'playwright'));
const id = 'e5f81908-0a6a-4514-af98-54770af6d601', employee = 'e5f81908-0a6a-4514-af98-54770af6d602';
// Identity alone activates the policy on a synthetic in-memory top; no source card is copied.
const topId = colorForm ? 'a92d78d6-90c1-4938-8d14-f01859925511' : 'e5f81908-0a6a-4514-af98-54770af6d603';
const fixtureSecret = 'synthetic-browser-test-secret-for-isolated-db-only';
let siteBaseURL = '';
const db = new PGlite();
const realApiObservations = [];
let providerCalls = 0, providerDelay = 0, providerMode = 'size';
let image = 'data:image/jpeg;base64,/9j/2Q==';
async function readBody(req) { const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString() || '{}'); }
const fixture = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture.test');
    // Local fixture server only; these entry links never exist in the product application.
    if ((pilotForm || colorForm) && ['/enter/employee','/enter/admin'].includes(url.pathname)) {
      const role = url.pathname.endsWith('/admin') ? 'admin' : 'employee';
      const { SignJWT } = await import('jose');
      const token = await new SignJWT(role === 'admin' ? { role, name: 'Тестовый администратор' } : { role })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(employee).setIssuedAt().setExpirationTime('8h').sign(new TextEncoder().encode(fixtureSecret));
      res.writeHead(302, { location: siteBaseURL + (role === 'admin' ? '/admin/sizes' : '/sizes'),
        'Set-Cookie': `warehouse_session=${token}; Path=/; HttpOnly; SameSite=Lax`, 'Cache-Control': 'no-store' }); res.end(); return;
    }
    let data;
    if (url.pathname === '/real-openai-observation' && liveForm) {
      const observation = await readBody(req);
      assert.equal(observation.origin, 'https://api.openai.com');
      realApiObservations.push(observation); data = { ok: true };
      if (pilotForm) console.log('REAL_OPENAI ' + JSON.stringify(observation));
    } else if (url.pathname === '/mock-openai') {
      assert(!liveForm, 'Mock OpenAI is disabled for live form checks');
      const sent = await readBody(req); providerCalls++;
      const input = JSON.parse(sent.input);
      assert(['Брюки Огромнейшие','Тестовый верх'].includes(input.product.name));
      await new Promise(resolve => setTimeout(resolve, providerDelay));
      const measured=input.customer.shouldersCm!==null||input.customer.chestWidthCm!==null||input.customer.halfWaistCm!==null;
      const result={results:input.requestedKeys.map(key=>{
        const color=input.product.colors.find(row=>row.key===key);
        const clarify=providerMode==='clarification'||measured&&color.allowedSizes.length>1;
        const size=measured?color.allowedSizes[0]:input.product.colors.some(row=>row.fitRule)?'L':input.product.examples.length>=2?'XL':'M';
        return {key,size:clarify?null:size,baseSize:clarify?null:size,fitAdjustmentIncluded:false,reason:'Synthetic response for UI testing, not model quality',clarification:clarify?'Уточните замеры вещи':null,
          basis:measured?'measurements':'owner_examples',exampleIndexes:measured?[]:input.product.examples.map(row=>row.index)};
      })};
      data = { id: 'resp_browser_fixture', object: 'response', created_at: 1, status: 'completed', output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(result), annotations: [] }] }] };
    } else if (url.pathname === '/rest/v1/rpc/take_size_ai_slot') {
      const input = await readBody(req); data = colorForm?true:(await db.query('select take_size_ai_slot($1) as allowed', [input.p_subject])).rows[0].allowed;
    } else {
      const table = url.pathname.split('/').at(-1);
      assert(['size_products', 'employees'].includes(table));
      const params = [], arg = v => { params.push(v && typeof v === 'object' ? JSON.stringify(v) : v); return '$' + params.length; };
      const filters = [];
      for (const [key, value] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        if (key === 'or') { assert.equal(value, '(show_in_availability.eq.true,show_in_sizes.eq.true)'); filters.push('(show_in_availability or show_in_sizes)'); continue; }
        assert(/^[a-z_]+$/.test(key));
        const dot = value.indexOf('.'), op = value.slice(0, dot), operators = { eq: '=', neq: '<>', gt: '>' };
        assert(operators[op]); filters.push(`${key} ${operators[op]} ${arg(value.slice(dot + 1))}`);
      }
      const where = filters.length ? ' where ' + filters.join(' and ') : '';
      const fields = (url.searchParams.get('select') || '*').replace(/selected:photos->>(\d)/g, 'photos->>$1 as selected');
      assert(/^[a-z_*,\s:>\-0-9]+$/i.test(fields));
      let sql;
      if (req.method === 'PATCH') {
        const values = await readBody(req);
        for (const key of Object.keys(values)) assert(/^[a-z_]+$/.test(key));
        sql = `update ${table} set ${Object.entries(values).map(([k, v]) => `${k}=${arg(v)}`).join(',')}${where} returning ${fields}`;
      } else {
        assert.equal(req.method, 'GET');
        const order = url.searchParams.get('order')?.split(',').map(x => x.split('.')[0]).join(',');
        if (order) assert(/^[a-z_,]+$/.test(order));
        sql = `select ${fields} from ${table}${where}${order ? ' order by ' + order : ''} limit ${Number(url.searchParams.get('limit') || 200)} offset ${Number(url.searchParams.get('offset') || 0)}`;
      }
      const rows = (await db.query(sql, params)).rows;
      data = req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows;
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: error.message })); }
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
(async () => {
  let next, browser; let logs = '';
  try {
    if (liveForm) {
      const art = Buffer.from('<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="600" fill="#edf1eb"/><path d="M190 120H410L440 500H315L300 270L285 500H160Z" fill="#879489"/><text x="300" y="560" text-anchor="middle" font-size="22" fill="#324739">LOCAL TEST PHOTO</text></svg>');
      image = 'data:image/jpeg;base64,' + (await require('sharp')(art).jpeg().toBuffer()).toString('base64');
    }
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of ['20261004_size_catalog.sql', '20261102_availability.sql', '20261102_availability_create.sql', '20261103064143_independent_catalog_visibility.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    const ownerRows = pilotForm || employeeLiveForm ? JSON.parse(fs.readFileSync('tests/fixtures/size-catalog-20261028.json','utf8')).find(p => p.name === 'Брюки Огромнейшие').examples
      : liveForm ? [] : [{ height: 175, weight: 70, fit: 'regular', size: 'M' }];
    await db.query("insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active,show_in_sizes,show_in_availability) values ($1,'Брюки Огромнейшие','Маломерит на размер',$2,$3,$4,$5,2,true,true,true)", [id, JSON.stringify(['M','L','XL','2XL','3XL']), JSON.stringify(ownerRows), image, JSON.stringify([image, image])]);
    await db.exec(fs.readFileSync('supabase/migrations/20261108220243_size_measurements_ai.sql', 'utf8'));
    const {load}=require('../scripts/prepare-existing-size-transfer.cjs');
    await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify(load('src/lib/size-profile.ts').hugeTrousersProfile()),id]);
    await db.exec('create table employees (id uuid, name text, active boolean, role text, permissions jsonb)');
    await db.query("insert into employees values ($1,'Тестовый сотрудник',true,'warehouse','[\"picking\"]')", [employee]);
    if (pilotForm || colorForm) await db.query("insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active,show_in_sizes,show_in_availability) values ($1,'Тестовый верх','Не маломерит','[\"S\",\"M\",\"L\"]','[]',$2,$3,1,true,true,false)", [topId, image, JSON.stringify([image])]);
    if (colorForm) await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify({garment:'top',fabric:'',stretch:'none',cut:'Прямой',fitNote:'',columns:['Плечи','Грудь','Длина'],columnKeys:['shouldersCm','chestWidthCm','lengthCm'],rows:[{size:'M',values:[44,48,64]}]}),topId]);
    if (colorForm) await db.query('update size_products set examples=$1 where id=$2',[JSON.stringify([{height:150,weight:50,fit:'regular',size:'M'},{height:163,weight:60,fit:'regular',size:'L'}]),topId]);
    const original = (await db.query('select * from size_products where id=$1', [id])).rows[0];
    const fixtureOrigin = 'http://127.0.0.1:' + await listen(fixture);
    const portProbe = net.createServer(); const port = await listen(portProbe); await new Promise(resolve => portProbe.close(resolve));
    const baseURL = 'http://127.0.0.1:' + port;
    siteBaseURL = baseURL;
    const secret = fixtureSecret;
    next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-service-key', SESSION_SECRET: secret,
        SCANNER_AGENT_API_TOKEN: 'synthetic-scanner-token-for-local-test-only', OPENAI_API_KEY: liveForm ? process.env.OPENAI_API_KEY : 'synthetic-key-no-real-provider', OPENAI_MODEL_SIZES: 'gpt-5.4-mini-2026-03-17', WAREHOUSE_SIZE_TEST_ORIGIN: fixtureOrigin,
        ...(liveForm ? { OPENAI_BASE_URL: 'https://api.openai.com/v1' } : {}),
        NODE_OPTIONS: `--require="${path.resolve(liveForm ? 'tests/fixtures/size-ai-live-transport.cjs' : 'tests/fixtures/size-ai-transport.cjs').replace(/\\/g, '/')}"` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    next.stdout.on('data', data => { logs += data; }); next.stderr.on('data', data => { logs += data; });
    for (let i = 0; ; i++) {
      try { if ((await fetch(baseURL + '/admin/login')).ok) break; } catch {}
      if (i > 90 || next.exitCode !== null) throw new Error('Local test server did not start: ' + logs.slice(-1200));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (colorForm) {
      const child=spawn(process.execPath,['tests/color-size-form.cjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,SIZE_TEST_ENTRY:fixtureOrigin,SIZE_TEST_BASE:baseURL,SIZE_TEST_PRODUCT_ID:topId}});
      const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
      assert.equal(code,0,'All-color browser checks must pass');
      assert(providerCalls>0,'Ambiguous colors must use the explicitly mocked model transport');
      return;
    }
    browser = await chromium.launch({ channel: 'msedge', headless: !liveForm || employeeLiveForm });
    const context = await browser.newContext();
    await context.route('**/*', route => [baseURL, ...(pilotForm ? [fixtureOrigin] : [])].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const { SignJWT } = await import('jose');
    async function login(role) {
      const token = await new SignJWT(role === 'admin' ? { role, name: 'Тестовый администратор' } : { role }).setProtectedHeader({ alg: 'HS256' }).setSubject(employee).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      await context.addCookies([{ name: 'warehouse_session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
    }
    if(employeeLiveForm){
      await login('employee');const page=await context.newPage();await page.setViewportSize({width:360,height:844});
      await page.goto(baseURL+'/sizes');assert.equal(await page.getByRole('button',{name:'Редактировать',exact:true}).count(),0);
      await page.getByRole('button',{name:/Брюки Огромнейшие/}).click();const picker=page.locator('.size-picker');
      const nextResponse=()=>page.waitForResponse(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.request().method()==='POST');
      let pending=nextResponse();await picker.getByLabel('Рост',{exact:true}).fill('175');await picker.getByLabel('Вес',{exact:true}).fill('67');
      let response=await pending;assert.equal(response.status(),200);const first=await response.json();
      assert.equal(first.result.providerStatus,'completed');assert.equal(realApiObservations.length,1);
      await picker.locator('.size-final-choice').waitFor();
      const checks=[{input:response.request().postDataJSON(),httpStatus:200,result:first.result,realOpenAiCalls:1,observations:[...realApiObservations]}];
      const before=realApiObservations.length;pending=nextResponse();await picker.getByLabel('Полупояс',{exact:true}).fill('39');
      response=await pending;assert.equal(response.status(),200);const second=await response.json();
      assert.equal(second.result.size,'M');assert.equal(second.result.providerStatus,'not_needed');assert.equal(realApiObservations.length,before);
      await picker.getByText('Размер: M',{exact:true}).waitFor();
      checks.push({input:response.request().postDataJSON(),httpStatus:200,result:second.result,realOpenAiCalls:0});
      const screenshot=path.join(require('node:os').tmpdir(),'warehouse-pants-employee-real-M.png');await picker.screenshot({path:screenshot});
      assert.deepEqual((await db.query('select * from size_products where id=$1',[id])).rows[0],original);
      fs.writeFileSync('docs/pants-employee-real-form-2026-11-09.json',JSON.stringify({environment:'local isolated Next app, employee session validated by SQL fixture, real unchanged OpenAI HTTP transport',productionVerified:false,productionDatabaseChanged:false,checks,screenshot},null,2)+'\n');
      console.log(JSON.stringify({passed:true,environment:'local_employee_form_real_OpenAI',checks:checks.map(c=>({input:c.input,status:c.httpStatus,size:c.result.size,clarification:c.result.clarification,realOpenAiCalls:c.realOpenAiCalls})),screenshot}));
      return;
    }
    if (pilotForm) {
      const page = await context.newPage();
      const run = require('./helpers/size-pilot-form.cjs');
      await run({ page, baseURL, fixtureOrigin, observations: realApiObservations, login });
      const current = (await db.query('select * from size_products where id=$1', [id])).rows[0];
      for (const key of ['id','name','examples','sizes','photo','photos','photo_count','stock_details']) assert.deepEqual(current[key], original[key], key);
      console.log('PASS pilot: original examples, photos, range and stock preserved in isolated DB');
      console.log('STAND_READY ' + JSON.stringify({ employee: fixtureOrigin + '/enter/employee', admin: fixtureOrigin + '/enter/admin', localSite: baseURL, inMemoryTestDatabase: true }));
      if (keepOpen) await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
      return;
    }
    if (liveForm) {
      await login('employee');
      const page = await context.newPage();
      const run = require('./helpers/size-form-live.cjs');
      await run({ page, baseURL, observations: realApiObservations });
      assert.deepEqual((await db.query('select * from size_products')).rows[0], original);
      console.log('PASS isolated fixture: original numeric chart and product row unchanged; no production DB configured');
      return;
    }
    await login('admin'); const page = await context.newPage();
    await page.goto(baseURL + '/admin/sizes');
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await page.getByLabel('Ткань и состав').fill('Ткань после проверки сохранения');
    await page.getByLabel('Полупояс, строка сетки 1', { exact: true }).fill('38.5');
    await page.getByRole('button', { name: 'Сохранить вещь', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Сохранено' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    assert.equal(await page.getByLabel('Ткань и состав').inputValue(), 'Ткань после проверки сохранения');
    assert.equal(await page.getByLabel('Полупояс, строка сетки 1', { exact: true }).inputValue(), '38.5');
    const persisted = (await db.query('select * from size_products')).rows[0];
    for (const key of ['photos','photo','photo_count','examples','sizes','stock_details']) assert.deepEqual(persisted[key], original[key]);
    assert(!persisted.sizes.includes('S'));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'warehouse-size-ai-admin.png'), fullPage: true });
    console.log('PASS browser admin: edit numeric chart/fabric, save, reload, exact values persisted; photos, examples, range and stock retained');

    await login('employee'); await page.goto(baseURL + '/sizes');
    assert.equal(await page.getByRole('button',{name:'Редактировать',exact:true}).count(),0);
    await page.getByRole('button', { name: /Брюки Огромнейшие/ }).click();
    const picker=page.locator('.size-picker');
    assert.equal(await picker.locator('input[type=number]').count(),4);
    assert.equal(await picker.getByLabel('Полупояс',{exact:true}).getAttribute('required'),null);
    assert.equal(await picker.getByRole('button',{name:'Подобрать',exact:true}).count(),0);
    assert.equal(await picker.locator('details').count(),0);
    const waitingResponse=()=>page.waitForResponse(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.request().method()==='POST');
    const traces=[];
    async function answer(response,text){
      traces.push({input:response.request().postDataJSON(),status:response.status(),response:await response.json(),realOpenAiCall:false});
      assert.equal(response.status(),200);await picker.locator('.size-final-choice').getByText(text,{exact:true}).waitFor();
      assert.equal(await picker.locator('.size-answer').innerText(),text);
    }
    let waiting=waitingResponse();
    await picker.getByLabel('Рост',{exact:true}).fill('175');await picker.getByLabel('Вес',{exact:true}).fill('67');
    assert.equal(providerCalls,0);await answer(await waiting,'Размер: ≈ M');assert.equal(providerCalls,1);
    await picker.getByRole('button',{name:'Новый клиент',exact:true}).click();
    assert.equal(await picker.getByLabel('Рост',{exact:true}).inputValue(),'');
    assert.equal(await picker.locator('.size-final-choice').count(),0);
    waiting=waitingResponse();
    await picker.getByLabel('Рост',{exact:true}).fill('175');await picker.getByLabel('Вес',{exact:true}).fill('67');
    await picker.getByLabel('Полупояс',{exact:true}).fill('39');
    await answer(await waiting,'Размер: M');assert.equal(providerCalls,1);
    assert.equal(traces.at(-1).response.result.providerStatus,'not_needed');
    await page.setViewportSize({width:360,height:844});
    await picker.screenshot({path:path.join(require('node:os').tmpdir(),'warehouse-pants-175-67-waist39.png')});
    // A concurrent card edit used to be swallowed by the UI as a generic failure.
    await db.query('update size_products set revision=revision+1 where id=$1',[id]);
    const stale=page.waitForResponse(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.status()===409);
    const recovered=page.waitForResponse(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.status()===200);
    await picker.getByLabel('Вес',{exact:true}).fill('68');
    const staleResponse=await stale;traces.push({test:'stale card',status:409,input:staleResponse.request().postDataJSON(),response:await staleResponse.json()});
    await answer(await recovered,'Размер: M');assert.equal(providerCalls,1);
    assert(traces.at(-1).input.revision>traces.at(-2).input.revision);
    // Expired employee login must be visible, rather than looking like missing measurements.
    await page.route('**/api/sizes/recommend',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Войдите на сайт заново.'})}));
    await picker.getByLabel('Вес',{exact:true}).fill('69');
    await picker.getByText('Войдите на сайт заново',{exact:true}).waitFor();
    await page.unroute('**/api/sizes/recommend');
    for(const [waist,size] of [['42','L'],['44','XL']]){
      waiting=waitingResponse();await picker.getByLabel('Полупояс',{exact:true}).fill(waist);
      assert.equal(await picker.locator('.size-final-choice').count(),0);await answer(await waiting,'Размер: '+size);
      assert.equal(providerCalls,1);
    }
    await db.exec('delete from size_ai_limits');providerMode='clarification';
    waiting=waitingResponse();await picker.getByLabel('Вес',{exact:true}).fill('72');await picker.getByLabel('Полупояс',{exact:true}).fill('');
    await answer(await waiting,'Уточните замеры вещи');assert.equal(providerCalls,2);
    console.log('PASS compact single-grid browser: automatic size, optional waist, clarification as dash, original editor/photo/example data retained');
    await db.exec('delete from size_ai_limits');providerDelay=1000;providerMode='size';
    const oldRequest=page.waitForRequest(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.method()==='POST');
    await picker.getByLabel('Вес',{exact:true}).fill('71');await oldRequest;
    waiting=waitingResponse();await picker.getByLabel('Полупояс',{exact:true}).fill('42');
    await answer(await waiting,'Размер: L');await page.waitForTimeout(1100);
    assert.equal(await picker.locator('.size-answer').innerText(),'Размер: L');
    await picker.getByRole('button',{name:'Новый клиент',exact:true}).click();
    await page.waitForTimeout(600);assert.equal(await picker.locator('.size-answer').innerText(),'');
    await page.setViewportSize({width:360,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await picker.screenshot({path:path.join(require('node:os').tmpdir(),'warehouse-compact-pants-auto.png')});
    fs.writeFileSync('docs/pants-employee-form-check-2026-11-09.json',JSON.stringify({environment:'isolated local Next app and SQL fixture, employee session, OpenAI transport explicitly mocked',productionVerified:false,checks:['175/67 without waist','175/67 waist39 → M, zero provider calls','409 auto refresh and retry','401 shown clearly','stale-response cancellation','reset'],traces},null,2)+'\n');
    console.log('PASS compact single-grid stale response cancellation, reset, mobile viewport; all OpenAI transport mocked');
  } finally {
    await browser?.close();
    if (next && next.exitCode === null) await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(next.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve);
    });
    await new Promise(resolve => fixture.close(resolve)); await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
