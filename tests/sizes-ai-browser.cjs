// Browser → real Next routes → real supabase-js → local SQL; OpenAI transport is synthetic.
// npm exec --yes --package playwright -- node tests/sizes-ai-browser.cjs
// Real form verification: append --live-form (two real OpenAI calls; isolated database).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net');
const { spawn } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const pilotForm = process.argv.includes('--pilot-form');
const colorForm = process.argv.includes('--color-form');
const keepOpen = process.argv.includes('--keep-open');
const liveForm = process.argv.includes('--live-form') || pilotForm;
if (liveForm) {
  require('@next/env').loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is missing; live form test cannot start');
}
const bin = process.env.PATH.split(path.delimiter).find(p => fs.existsSync(path.resolve(p, '..', 'playwright', 'index.js')));
if (!bin) throw new Error('Run with npm exec --package playwright as documented');
const { chromium } = require(path.resolve(bin, '..', 'playwright'));
const id = 'e5f81908-0a6a-4514-af98-54770af6d601', employee = 'e5f81908-0a6a-4514-af98-54770af6d602';
const topId = 'e5f81908-0a6a-4514-af98-54770af6d603';
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
      assert.equal(input.product.name, 'Брюки Огромнейшие');
      assert.equal(input.product.rows.length, 6);
      await new Promise(resolve => setTimeout(resolve, providerDelay));
      const result = providerMode === 'clarification'
        ? { size: null, explanation: 'Тестовый ответ: нужно различить варианты.', clarification: 'Какой полупояс у подходящих брюк, в сантиметрах?' }
        : { size: 'M', explanation: 'Тестовый предварительный ответ для проверки интерфейса, не оценка качества модели.', clarification: null };
      data = { id: 'resp_browser_fixture', object: 'response', created_at: 1, status: 'completed', output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(result), annotations: [] }] }] };
    } else if (url.pathname === '/rest/v1/rpc/take_size_ai_slot') {
      const input = await readBody(req); data = (await db.query('select take_size_ai_slot($1) as allowed', [input.p_subject])).rows[0].allowed;
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
    const ownerRows = pilotForm ? JSON.parse(fs.readFileSync('tests/fixtures/size-catalog-20261028.json','utf8')).find(p => p.name === 'Брюки Огромнейшие').examples
      : liveForm ? [] : [{ height: 175, weight: 70, fit: 'regular', size: 'M' }];
    await db.query("insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active,show_in_sizes,show_in_availability) values ($1,'Брюки Огромнейшие','Маломерит на размер',$2,$3,$4,$5,2,true,true,true)", [id, JSON.stringify(['M','L','XL','2XL','3XL']), JSON.stringify(ownerRows), image, JSON.stringify([image, image])]);
    await db.exec(fs.readFileSync('supabase/migrations/20261108220243_size_measurements_ai.sql', 'utf8'));
    const {load}=require('../scripts/prepare-existing-size-transfer.cjs');
    await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify(load('src/lib/size-profile.ts').hugeTrousersProfile()),id]);
    await db.exec('create table employees (id uuid, name text, active boolean, role text, permissions jsonb)');
    await db.query("insert into employees values ($1,'Тестовый сотрудник',true,'warehouse','[\"picking\"]')", [employee]);
    if (pilotForm || colorForm) await db.query("insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active,show_in_sizes,show_in_availability) values ($1,'Тестовый верх','Не маломерит','[\"S\",\"M\",\"L\"]','[]',$2,$3,1,true,true,false)", [topId, image, JSON.stringify([image])]);
    if (colorForm) await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify({garment:'top',fabric:'',stretch:'none',cut:'Прямой',fitNote:'',columns:['Плечи','Грудь','Длина'],columnKeys:['shouldersCm','chestWidthCm','lengthCm'],rows:[{size:'M',values:[44,48,64]}]}),topId]);
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
      const child=spawn(process.execPath,['tests/color-size-form.cjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,SIZE_TEST_ENTRY:fixtureOrigin,SIZE_TEST_BASE:baseURL}});
      const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
      assert.equal(code,0,'All-color browser checks must pass');
      assert.equal(providerCalls,0,'Color comparisons do not use OpenAI transport');
      return;
    }
    browser = await chromium.launch({ channel: 'msedge', headless: !liveForm });
    const context = await browser.newContext();
    await context.route('**/*', route => [baseURL, ...(pilotForm ? [fixtureOrigin] : [])].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const { SignJWT } = await import('jose');
    async function login(role) {
      const token = await new SignJWT(role === 'admin' ? { role, name: 'Тестовый администратор' } : { role }).setProtectedHeader({ alg: 'HS256' }).setSubject(employee).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
      await context.addCookies([{ name: 'warehouse_session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
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
    await page.getByLabel('Полупояс, строка сетки 2', { exact: true }).fill('39.5');
    await page.getByRole('button', { name: 'Сохранить вещь', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Сохранено' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    assert.equal(await page.getByLabel('Ткань и состав').inputValue(), 'Ткань после проверки сохранения');
    assert.equal(await page.getByLabel('Полупояс, строка сетки 2', { exact: true }).inputValue(), '39.5');
    const persisted = (await db.query('select * from size_products')).rows[0];
    for (const key of ['photos','photo','photo_count','examples','sizes','stock_details']) assert.deepEqual(persisted[key], original[key]);
    assert(!persisted.sizes.includes('S'));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'warehouse-size-ai-admin.png'), fullPage: true });
    console.log('PASS browser admin: edit numeric chart/fabric, save, reload, exact values persisted; photos, examples, range and stock retained');

    await login('employee'); await page.goto(baseURL + '/sizes');
    await page.getByRole('button', { name: /Брюки Огромнейшие/ }).click();
    const picker=page.locator('.size-picker');
    assert.equal(await picker.locator('input[type=number]').count(),3);
    assert.equal(await picker.getByLabel('Полупояс',{exact:true}).getAttribute('required'),null);
    assert.equal(await picker.getByRole('button',{name:'Подобрать',exact:true}).count(),0);
    assert.equal(await picker.locator('details').count(),0);
    const waitingResponse=()=>page.waitForResponse(r=>r.url()===baseURL+'/api/sizes/recommend'&&r.request().method()==='POST');
    async function answer(response,text){
      assert.equal(response.status(),200);await picker.locator('.size-final-choice').getByText(text,{exact:true}).waitFor();
      assert.equal(await picker.locator('.size-answer').innerText(),text);
    }
    let waiting=waitingResponse();
    await picker.getByLabel('Рост',{exact:true}).fill('175');await picker.getByLabel('Вес',{exact:true}).fill('70');
    assert.equal(providerCalls,0);await answer(await waiting,'Размер: M');assert.equal(providerCalls,1);
    await picker.getByRole('button',{name:'Новый клиент',exact:true}).click();
    assert.equal(await picker.getByLabel('Рост',{exact:true}).inputValue(),'');
    assert.equal(await picker.locator('.size-final-choice').count(),0);
    waiting=waitingResponse();
    await picker.getByLabel('Рост',{exact:true}).fill('175');await picker.getByLabel('Вес',{exact:true}).fill('70');
    await picker.getByLabel('Полупояс',{exact:true}).fill('39.5');
    await answer(await waiting,'Размер: M');assert.equal(providerCalls,1);
    for(const [waist,size] of [['42','L'],['44','XL']]){
      waiting=waitingResponse();await picker.getByLabel('Полупояс',{exact:true}).fill(waist);
      assert.equal(await picker.locator('.size-final-choice').count(),0);await answer(await waiting,'Размер: '+size);
      assert.equal(providerCalls,1);
    }
    await db.exec('delete from size_ai_limits');providerMode='clarification';
    waiting=waitingResponse();await picker.getByLabel('Полупояс',{exact:true}).fill('');
    await answer(await waiting,'Размер: —');assert.equal(providerCalls,2);
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
    console.log('PASS compact single-grid stale response cancellation, reset, mobile viewport; all OpenAI transport mocked');
  } finally {
    await browser?.close();
    if (next && next.exitCode === null) await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(next.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve);
    });
    await new Promise(resolve => fixture.close(resolve)); await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
