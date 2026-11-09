// Real local SQL + actual OpenAI SDK parsing with a fake transport. No live keys, DB or API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const id = 'c3c7680d-31ba-46b2-b350-704a538e4901', other = 'c3c7680d-31ba-46b2-b350-704a538e4902';
const subject = 'c3c7680d-31ba-46b2-b350-704a538e4903';
const migration = fs.readFileSync('supabase/migrations/20261108220243_size_measurements_ai.sql', 'utf8');
let session = { role: 'admin', sub: subject }, output = { size: 'M', explanation: 'Полупояс M — 39 см, как у подходящих брюк. Посадка предварительная.', clarification: null };
let providerCalls = [], failProvider = false, providerStatus = 'completed', refusal = false;
const cache = new Map();
function client() {
  return {
    async rpc(name, args) {
      assert.equal(name, 'take_size_ai_slot');
      try { return { data: (await db.query('select take_size_ai_slot($1) as allowed', [args.p_subject])).rows[0].allowed, error: null }; }
      catch (error) { return { data: null, error }; }
    },
    from(table) {
      assert.equal(table, 'size_products');
      let fields = '*', operation = 'select', values, filters = [], paging = '', ordering = '';
      const params = [], arg = value => { params.push(value && typeof value === 'object' ? JSON.stringify(value) : value); return '$' + params.length; };
      const q = {
        select(value) { fields = value; return q; },
        eq(key, value) { filters.push(`${key} = ${arg(value)}`); return q; },
        neq(key, value) { filters.push(`${key} <> ${arg(value)}`); return q; },
        gt(key, value) { filters.push(`${key} > ${arg(value)}`); return q; },
        order(key) { ordering += (ordering ? ',' : ' order by ') + key; return q; },
        range(start, end) { paging = ` limit ${end - start + 1} offset ${start}`; return q; },
        insert(row) { operation = 'insert'; values = row; return q; },
        update(row) { operation = 'update'; values = row; return q; },
        async run(single) {
          const where = filters.length ? ' where ' + filters.join(' and ') : '';
          const sql = operation === 'insert' ? `insert into size_products (${Object.keys(values)}) values (${Object.values(values).map(arg)}) returning ${fields}`
            : operation === 'update' ? `update size_products set ${Object.entries(values).map(([k, v]) => `${k}=${arg(v)}`).join(',')}${where} returning ${fields}`
            : `select ${fields} from size_products${where}${ordering}${paging}`;
          try { const result = await db.query(sql, params); return { data: single ? result.rows[0] ?? null : result.rows, error: null }; }
          catch (error) { return { data: null, error }; }
        },
        single() { return q.run(true); }, maybeSingle() { return q.run(true); }, then(resolve, reject) { return q.run(false).then(resolve, reject); },
      }; return q;
    },
  };
}
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name === '@/lib/session' ? { getSession: async () => session }
    : name === '@/lib/supabase' ? { createAdminClient: client, logSupabaseError() {} }
    : name === 'openai' ? class extends require('openai').default {
      constructor(options) { super({ ...options, fetch: async (url, request) => {
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        providerCalls.push(JSON.parse(request.body));
        if (failProvider) throw new Error('PRIVATE_PROVIDER_ERROR');
        return Response.json({ id: 'resp_fixture', object: 'response', created_at: 1, status: providerStatus,
          output: [{ id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant',
            content: refusal ? [{ type: 'refusal', refusal: 'fixture' }] : [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }] });
      } }); }
    }
    : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const sizes = load('src/app/api/sizes/route.ts'), api = load('src/app/api/sizes/recommend/route.ts');
const { hugeTrousersProfile, sizeProfileSchema, sizeLengthAssessment } = load('src/lib/size-profile.ts');
const { sizeProductSchema } = load('src/lib/sizes-validation.ts');
const { compareSizeMeasurements, sizeOwnerGuidance } = load('src/lib/size-evidence.ts');
const { sizeMeasurementDecision } = load('src/lib/sizes-ai.ts');
const request = (url, body, headers = {}) => new Request('https://warehouse.test/api/sizes' + url, { method: 'POST', headers: { origin: 'https://warehouse.test', host: 'warehouse.test', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const getRow = async () => (await db.query('select * from size_products where id=$1', [id])).rows[0];
const resetLimit = () => db.exec('delete from size_ai_limits');
(async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of ['20261004_size_catalog.sql', '20261102_availability.sql', '20261102_availability_create.sql', '20261103064143_independent_catalog_visibility.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    const image = 'data:image/jpeg;base64,/9j/2Q==';
    const examples = [{ height: 175, weight: 70, fit: 'regular', size: 'M' }];
    for (const [key, name] of [[id, 'Брюки Огромнейшие'], [other, 'Другая вещь']]) await db.query('insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active,show_in_sizes,show_in_availability,stock_details) values ($1,$2,$3,$4,$5,$6,$7,1,true,true,true,$8)',
      [key, name, 'Маломерит на размер', JSON.stringify(['M','L','XL','2XL','3XL']), JSON.stringify(examples), image, JSON.stringify([image, image]), JSON.stringify({ composition: 'Исходный состав', material: 'Исходная ткань', stretch: '', colors: [{ name: 'Чёрный', sizes: ['M'] }] })]);
    const before = await getRow();
    await db.exec(migration);
    assert.equal((await getRow()).size_profile,null);
    await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify(hugeTrousersProfile()),id]);
    let row = await getRow();
    assert.deepEqual(row.size_profile, hugeTrousersProfile());
    for (const key of Object.keys(before).filter(key => !['revision','updated_at'].includes(key))) assert.deepEqual(row[key], before[key], key);
    assert.equal((await db.query('select size_profile from size_products where id=$1', [other])).rows[0].size_profile, null);
    assert.equal(row.sizes.includes('S'), false); assert.equal(row.stock_details.colors[0].sizes.includes('S'), false);
    const after = await getRow(); await db.exec(migration); assert.deepEqual(await getRow(), after);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}','size_ai_limits','SELECT') as ok`)).rows[0].ok, false);
      assert.equal((await db.query(`select has_function_privilege('${role}','take_size_ai_slot(uuid)','EXECUTE') as ok`)).rows[0].ok, false);
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='size_ai_limits'::regclass")).rows[0].relrowsecurity, true);
    console.log('PASS migration: requested chart, exact label sizes, S not in stock, other products/photos/examples/stock preserved, repeatable, RLS and function permissions');

    const edit = { id, revision: row.revision, name: row.name, note: row.note, sizes: row.sizes, examples: row.examples, active: true, show_in_sizes: true,
      size_profile: { ...row.size_profile, fabric: 'Состав уточнён владельцем' } };
    let response = await sizes.POST(request('', edit)); assert.equal(response.status, 200);
    row = await getRow(); assert.equal(row.size_profile.fabric, edit.size_profile.fabric);
    assert.deepEqual(row.photos, before.photos); assert.deepEqual(row.examples, before.examples); assert.deepEqual(row.stock_details, before.stock_details);
    assert.equal((await sizes.POST(request('', edit))).status, 409);
    let catalog = await (await sizes.GET()).json(); assert.equal(catalog.products.find(p => p.id === id).size_profile.fabric, edit.size_profile.fabric);
    const invalid = hugeTrousersProfile(); invalid.rows[0].values[0] = 0; assert.equal(sizeProfileSchema.safeParse(invalid).success, false);
    invalid.rows[0].values[0] = 38; invalid.rows.push(invalid.rows[0]); assert.equal(sizeProfileSchema.safeParse(invalid).success, false);
    assert.equal(sizeProductSchema.safeParse({ ...edit, revision: row.revision, examples: [] }).success, true);
    session = { role: 'employee', sub: subject }; assert.equal((await sizes.POST(request('', { ...edit, revision: row.revision }))).status, 403);
    await db.query('update size_products set examples=$1 where id=$2', ['[]', id]);
    catalog = await (await sizes.GET()).json(); assert(catalog.products.some(p => p.id === id));
    console.log('PASS saving: real SQL save/reload, optimistic conflicts, validation, employee access denied, table-only picker visible, existing data retained');

    const input = { productId: id, revision: row.revision, height: 175, weight: 70, fit: 'regular', halfWaistCm: 39.5 };
    delete process.env.OPENAI_API_KEY;
    response = await api.POST(request('/recommend', { ...input, halfWaistCm: 40.5 }));
    let tied = await response.json(); assert.equal(tied.result.size, null); assert.match(tied.result.clarification, /впритык или с запасом/);
    assert.deepEqual(tied.comparison.nearest, ['M','L']);
    assert.equal(tied.comparison.rows.find(row => row.size === 'M').measurements[0].deltaCm, -1.5);
    assert.equal(tied.comparison.rows.find(row => row.size === 'L').measurements[0].deltaCm, 1.5);
    for (const [beltFit, size] of [['snug','L'], ['roomy','M']]) {
      response = await api.POST(request('/recommend', { ...input, halfWaistCm: 40.5, beltFit }));
      assert.equal((await response.json()).result.size, size);
    }
    for (const [halfWaistCm, size] of [[39, 'M'], [42, 'L'], [44, 'XL']]) {
      for (const fit of ['tight', 'regular', 'loose']) {
        response = await api.POST(request('/recommend', { ...input, height: 190, weight: 85, halfWaistCm, fit }));
        assert.equal(response.status, 200); assert.equal((await response.json()).result.size, size);
      }
    }
    assert.equal(providerCalls.length, 0);
    assert.match(sizeLengthAssessment(row.size_profile, 'M'), /106 см/);
    assert.match(sizeLengthAssessment(row.size_profile, 'L'), /107 см/);
    assert.match(sizeLengthAssessment(row.size_profile, 'XL'), /108 см/);
    assert.match(sizeLengthAssessment(row.size_profile, 'M'), /По одному росту нельзя/);
    console.log('PASS chart rule: exact 39→M, 42→L, 44→XL across all fit choices, no model/key or automatic offset; length assessed independently');
    assert.equal((await api.POST(request('/recommend', input))).status, 503); assert.equal(providerCalls.length, 0);
    assert.equal((await api.POST(request('/recommend', { ...input, halfWaistCm: undefined }))).status, 503); assert.equal(providerCalls.length, 0);
    process.env.OPENAI_API_KEY = 'synthetic-test-key';
    response = await api.POST(request('/recommend', input)); assert.equal(response.status, 200); assert.equal((await response.json()).result.size, 'M');
    const sent = providerCalls.at(-1), payload = JSON.parse(sent.input);
    assert.equal(sent.store, false); assert.equal(sent.max_output_tokens, 650); assert.equal(sent.model, 'gpt-5.4-mini-2026-03-17');
    assert.deepEqual(payload.product.rows, row.size_profile.rows); assert.equal(payload.customer.halfWaistCm, 39.5);
    assert.deepEqual(Object.keys(payload), ['product','customer']); assert(!sent.input.includes('Другая вещь')); assert(!sent.input.includes(image));
    assert(!sent.input.includes(subject)); assert(!sent.input.includes('synthetic-test-key')); assert(!sent.input.includes('Исходный состав'));
    assert.equal(sent.text.format.type, 'json_schema'); assert.equal(sent.text.format.strict, true);
    assert.equal((await api.POST(request('/recommend', input))).status, 429);
    const paidCalls = providerCalls.length;
    await resetLimit(); response = await api.POST(request('/recommend', { ...input, halfWaistCm: undefined }));
    assert.equal(response.status, 200); assert.equal((await response.json()).result.size, null);
    assert.equal(providerCalls.length, paidCalls + 1);
    assert.equal(JSON.parse(providerCalls.at(-1).input).customer.halfWaistCm, null);
    await resetLimit(); output = { size: '', explanation: 'Нужна одна прямая мерка.', clarification: '' };
    response = await api.POST(request('/recommend', { ...input, halfWaistCm: undefined }));
    assert.equal(response.status, 200); assert.match((await response.json()).result.clarification, /Какой полупояс/);
    await resetLimit(); output = { size: null, explanation: 'Нельзя обоснованно различить два размера по этим параметрам.', clarification: 'Какой полупояс у подходящих брюк в сантиметрах?' };
    response = await api.POST(request('/recommend', { ...input, halfWaistCm: undefined }));
    assert.equal(response.status, 200); const unclear = (await response.json()).result; assert.equal(unclear.size, null); assert.equal(unclear.clarification, output.clarification);
    assert.equal(providerCalls.length, paidCalls + 3);
    await resetLimit(); await db.query('update size_products set examples=$1 where id=$2', [JSON.stringify(before.examples), id]);
    output = { size: 'M', explanation: 'Есть близкий старый ориентир владельца.', clarification: null };
    response = await api.POST(request('/recommend', { ...input, halfWaistCm: undefined }));
    let guided = (await response.json()).result; assert.equal(guided.size, 'M'); assert.match(guided.explanation, /не по подтверждённой примерке/);
    assert.equal(JSON.parse(providerCalls.at(-1).input).product.ownerGuidance.status, 'unconfirmed_owner_recommendations');
    const top = { garment: 'top', fabric: '', stretch: 'none', cut: 'Прямой', columns: ['Плечи','Ширина по груди','Длина'],
      columnKeys: ['shouldersCm','chestWidthCm','lengthCm'], rows: [{size:'M', values:[48,56,72]}, {size:'L', values:[50,58,74]}] };
    assert.equal(sizeProfileSchema.safeParse(top).success, true);
    assert.equal(sizeMeasurementDecision(top, { ...input, halfWaistCm: undefined, shouldersCm: 48, chestWidthCm: 56 }).size, 'M');
    assert.equal(compareSizeMeasurements(top, { ...input, halfWaistCm: undefined, shouldersCm: 49, chestWidthCm: 57 }).nearest.length, 2);
    assert.equal(sizeProfileSchema.safeParse({ ...hugeTrousersProfile(), garment: 'jeans' }).success, true);
    assert.equal(sizeOwnerGuidance({ name:'test', note:'', examples:[] }, hugeTrousersProfile(), input).usable, false);
    console.log('PASS evidence: signed server differences/tie, snug→L and roomy→M, unconfirmed owner guidance, top shoulders/chest and jeans schema');
    await resetLimit(); response = await api.POST(request('/recommend', { ...input, halfWaistCm: 60 }));
    assert.equal((await response.json()).result.size, null);
    assert.equal(providerCalls.length, paidCalls + 4);
    await resetLimit(); output = { size: null, explanation: 'Нужно сравнить длину.', clarification: 'Какова длина подходящих брюк по внешнему шву?' };
    response = await api.POST(request('/recommend', input)); assert.equal((await response.json()).result.clarification, output.clarification);
    console.log('PASS integration (mock transport, not quality): SDK/schema, selected product only, missing waist reaches provider and accepts size or clarification, out-of-range guard, rate limit');

    await resetLimit(); output = { size: 'M', explanation: ' Полупояс совпадает с таблицей. ', clarification: ' ' };
    response = await api.POST(request('/recommend', input)); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, { size: 'M', explanation: 'Полупояс совпадает с таблицей.', clarification: null });
    await resetLimit(); output = { size: ' ', explanation: 'Нужна прямая мерка.', clarification: 'Какой полупояс любимых брюк?' };
    response = await api.POST(request('/recommend', { ...input, halfWaistCm: undefined })); assert.equal(response.status, 200);
    assert.equal((await response.json()).result.size, null);

    for (const bad of [{ size: '4XL', explanation: 'Нельзя', clarification: null }, { size: 'M', explanation: '', clarification: null }, { size: null, explanation: 'Нельзя', clarification: null }, { size: null, explanation: 'Нельзя', clarification: ' ' }, { size: ' ', explanation: 'Нельзя', clarification: '' }]) {
      await resetLimit(); output = bad; assert.equal((await api.POST(request('/recommend', input))).status, 502);
    }
    for (const mode of ['refusal','incomplete','network']) {
      await resetLimit(); refusal = mode === 'refusal'; providerStatus = mode === 'incomplete' ? 'incomplete' : 'completed'; failProvider = mode === 'network';
      response = await api.POST(request('/recommend', input)); assert.equal(response.status, 502); assert(!(await response.text()).includes('PRIVATE_PROVIDER_ERROR'));
    }
    refusal = false; providerStatus = 'completed'; failProvider = false;
    const callsBefore = providerCalls.length;
    assert.equal((await api.POST(request('/recommend', input, { origin: 'https://evil.test' }))).status, 403);
    assert.equal((await api.POST(request('/recommend', { ...input, height: 0 }))).status, 400);
    assert.equal((await api.POST(request('/recommend', { ...input, size_profile: {} }))).status, 400);
    assert.equal((await api.POST(request('/recommend', '{'))).status, 400);
    assert.equal((await api.POST(request('/recommend', ' '.repeat(2049)))).status, 413);
    assert.equal((await api.POST(request('/recommend', { ...input, revision: 1 }))).status, 409);
    await db.query('update size_products set active=false where id=$1', [id]); assert.equal((await api.POST(request('/recommend', input))).status, 404);
    session = null; assert.equal((await api.POST(request('/recommend', input))).status, 401);
    assert.equal(providerCalls.length, callsBefore);
    await resetLimit(); assert.equal((await client().rpc('take_size_ai_slot', { p_subject: subject })).data, true);
    await db.exec("update size_ai_limits set request_count=50,last_request_at=now()-interval '10 seconds'");
    assert.equal((await client().rpc('take_size_ai_slot', { p_subject: subject })).data, false);
    await db.query("insert into size_products(name,sizes,photo) values ('Брюки Огромнейшие','[\"M\"]',$1)", [image]);
    const preserved = await getRow(); await db.exec(migration);
    assert.deepEqual(await getRow(), preserved);
    assert.equal((await db.query("select size_profile from size_products where name='Брюки Огромнейшие' and id<>$1", [id])).rows[0].size_profile, null);
    console.log('PASS guards: malformed, refused and incomplete AI output, provider failure, CSRF, bounded input, server-owned chart, stale/hidden product, authentication, daily shared budget');

    // Color grid integration on an existing generic fixture, not a clone of a source card.
    session={role:'admin',sub:subject};
    const colorTools=load('src/lib/color-size-grids.ts');
    const colorProfile=require('../scripts/lib/alpaca-size-profile.cjs')({sizeProfileSchema,...colorTools});
    const originalOther=(await db.query('select * from size_products where id=$1',[other])).rows[0];
    response=await sizes.POST(request('',{id:other,revision:originalOther.revision,name:originalOther.name,note:originalOther.note,
      sizes:originalOther.sizes,examples:originalOther.examples,active:originalOther.active,show_in_sizes:originalOther.show_in_sizes,
      show_in_availability:originalOther.show_in_availability,size_profile:colorProfile}));
    assert.equal(response.status,200);
    let savedOther=(await db.query('select * from size_products where id=$1',[other])).rows[0];
    assert.deepEqual(savedOther.size_profile,colorProfile);
    for(const field of ['id','name','note','photos','photo','photo_count','examples','sizes','active','show_in_sizes','show_in_availability','stock_details'])
      assert.deepEqual(savedOther[field],originalOther[field],field);
    const editedColor=structuredClone(colorProfile);editedColor.colorGrids.colors[0].rows[0].sleeve={min:62,max:64};
    response=await sizes.POST(request('',{id:other,revision:savedOther.revision,name:savedOther.name,note:savedOther.note,
      sizes:savedOther.sizes,examples:savedOther.examples,active:savedOther.active,show_in_sizes:savedOther.show_in_sizes,size_profile:editedColor}));
    assert.equal(response.status,200);
    savedOther=(await db.query('select * from size_products where id=$1',[other])).rows[0];
    assert.deepEqual(savedOther.size_profile.colorGrids.colors[0].rows[0].sleeve,{min:62,max:64});
    session={role:'employee',sub:subject};delete process.env.OPENAI_API_KEY;
    const beforeColorCalls=providerCalls.length;
    for(const [shouldersCm,chestWidthCm,sizesExpected] of [[42,50,['M','M']],[48,54,[null,'XL']],[50,56,[null,null]],[52,58,[null,null]]]){
      response=await api.POST(request('/recommend',{productId:other,revision:savedOther.revision,height:175,weight:70,fit:'regular',shouldersCm,chestWidthCm}));
      assert.equal(response.status,200);const result=(await response.json()).result;
      assert.deepEqual(result.colorResults.map(r=>r.size),sizesExpected);
      if(shouldersCm>=50)assert.match(result.summary,/Если тёмная — уточнить замеры на складе/);
    }
    assert.equal(providerCalls.length,beforeColorCalls);
    assert.deepEqual((await db.query('select photos,examples from size_products where id=$1',[other])).rows[0],{photos:originalOther.photos,examples:originalOther.examples});
    console.log('PASS color API: admin saves and edits/reloads full range grids on existing fixture; employee receives separate colors; calculated rows blocked; no photo payload, provider calls or source-card copies');
  } finally { if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
