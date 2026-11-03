// Run route handlers against real local SQL; no production credentials or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const image = 'data:image/jpeg;base64,/9j/2Q==';
let session = { role: 'admin' }, calls = 0;
const cache = new Map();
function client() {
  return { from(table) {
    assert.equal(table, 'size_products'); calls++;
    let fields = '*', operation = 'select', values, filters = [], paging = '', ordering = '';
    const params = [];
    const arg = value => { params.push(value && typeof value === 'object' ? JSON.stringify(value) : value); return '$' + params.length; };
    const q = {
      select(value) { fields = value.replace(/selected:([a-z_]+)(->>\d+)?/g, '$1$2 as selected'); return q; },
      eq(key, value) { filters.push(`${key} = ${arg(value)}`); return q; },
      neq(key, value) { filters.push(`${key} <> ${arg(value)}`); return q; },
      gt(key, value) { filters.push(`${key} > ${arg(value)}`); return q; },
      or(expression) { assert.equal(expression, 'show_in_availability.eq.true,show_in_sizes.eq.true'); filters.push('(show_in_availability or show_in_sizes)'); return q; },
      order(key) { ordering += (ordering ? ',' : ' order by ') + key; return q; },
      range(start, end) { paging = ` limit ${end - start + 1} offset ${start}`; return q; },
      insert(row) { operation = 'insert'; values = row; return q; },
      update(row) { operation = 'update'; values = row; return q; },
      async run(single) {
        let sql;
        const where = filters.length ? ' where ' + filters.join(' and ') : '';
        if (operation === 'insert') sql = `insert into size_products (${Object.keys(values)}) values (${Object.values(values).map(arg)}) returning ${fields}`;
        else if (operation === 'update') sql = `update size_products set ${Object.entries(values).map(([key, value]) => `${key}=${arg(value)}`).join(',')}${where} returning ${fields}`;
        else sql = `select ${fields} from size_products${where}${ordering}${paging}`;
        try { const result = await db.query(sql, params); return { data: single ? result.rows[0] ?? null : result.rows, error: null }; }
        catch (error) { return { data: null, error }; }
      },
      single() { return q.run(true); }, maybeSingle() { return q.run(true); },
      then(resolve, reject) { return q.run(false).then(resolve, reject); },
    }; return q;
  } };
}
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name === '@/lib/session' ? { getSession: async () => session }
    : name === '@/lib/supabase' ? { createAdminClient: client, logSupabaseError(_context, error) { console.error(error.message); } }
    : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const api = load('src/app/api/availability/route.ts');
const sizes = load('src/app/api/sizes/route.ts');
const editor = load('src/app/api/availability/[id]/route.ts');
const productPhotos = load('src/app/api/sizes/[id]/photo/route.ts');
const extraPhotos = load('src/app/api/availability/[id]/photo/route.ts');
const post = body => api.POST(new Request('https://warehouse.test/api/availability', { method: 'POST', headers: { origin: 'https://warehouse.test', host: 'warehouse.test' }, body: JSON.stringify(body) }));
const details = { composition: 'Хлопок', material: 'Трикотаж', stretch: 'Тянется', colors: [{ name: 'Красный', sizes: ['M'] }] };
(async () => {
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    for (const file of ['20261004_size_catalog.sql', '20261102_availability.sql']) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    await db.query("insert into size_products(name,sizes,examples,photo,photos,photo_count,active) values ('Original','[\"M\"]','[{\"height\":175,\"weight\":70,\"size\":\"M\",\"fit\":\"regular\"}]',$1,$2,1,true)", [image, JSON.stringify([image])]);
    await db.exec(fs.readFileSync('supabase/migrations/20261103064143_independent_catalog_visibility.sql', 'utf8'));
    const original = (await db.query('select * from size_products')).rows[0];
    const migration = fs.readFileSync('supabase/migrations/20261102_availability_create.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query('select * from size_products')).rows[0], original);
    let response = await post({ name: '  Новая позиция  ' }); assert.equal(response.status, 201);
    const created = (await response.json()).product;
    assert.equal(created.name, 'Новая позиция'); assert.equal(created.photo_count, 0); assert.deepEqual(created.sizes, []);
    const persisted = (await db.query('select * from size_products where id=$1', [created.id])).rows[0];
    assert.deepEqual(persisted.examples, []); assert.equal(persisted.photo, ''); assert.equal(persisted.active, true);
    // A fresh GET models the page reload: reads the persisted row, not client state.
    assert((await (await api.GET()).json()).products.some(p => p.id === created.id));
    assert((await (await sizes.GET()).json()).products.some(p => p.id === created.id)); // Admin can complete examples.
    session = { role: 'employee' };
    assert((await (await api.GET()).json()).products.some(p => p.id === created.id));
    assert(!(await (await sizes.GET()).json()).products.some(p => p.id === created.id));
    const beforeCalls = calls;
    assert.equal((await post({ name: 'Forbidden' })).status, 403);
    assert.equal((await post({ id: created.id, revision: 1, stock_details: details })).status, 403);
    assert.equal(calls, beforeCalls);
    session = null; assert.equal((await post({ name: 'Forbidden' })).status, 401);
    session = { role: 'admin' };
    for (const name of ['', '  ', 'x'.repeat(121)]) assert.equal((await post({ name })).status, 400);
    assert.equal((await post({ name: 'Unsafe', examples: [{}], active: true })).status, 400);
    assert.equal((await post({ name: 'Invalid image', photos: ['data:image/jpeg;base64,AAAA'] })).status, 400);
    assert.equal((await post({ name: 'Invalid sizes', sizes: ['M'], stock_details: { ...details, colors: [{ name: 'Red', sizes: ['XL'] }] } })).status, 400);
    response = await post({ name: 'Полная позиция', sizes: ['M','L'], photos: [image], stock_details: details, stock_chart: image, stock_models: [image] });
    assert.equal(response.status, 201); const full = (await response.json()).product;
    assert.equal(full.stock_has_chart, true); assert.equal(full.stock_model_count, 1); assert.equal(full.photo_count, 1);
    assert.equal((await db.query('select count(*)::int as count from size_products')).rows[0].count, 3);
    response = await post({ id: created.id, revision: created.revision, name: 'Дополнено позже', sizes: ['M'], photos: [image], stock_details: details, stock_chart: image });
    assert.equal(response.status, 200);
    const updated = (await response.json()).product;
    const reloaded = (await (await api.GET()).json()).products.find(p => p.id === created.id);
    assert.equal(reloaded.name, 'Дополнено позже'); assert.deepEqual(reloaded.stock_details, details); assert.equal(reloaded.photo_count, 1); assert.equal(reloaded.stock_has_chart, true);
    assert.deepEqual((await db.query('select examples from size_products where id=$1', [created.id])).rows[0].examples, []);
    session = { role: 'employee' }; assert(!(await (await sizes.GET()).json()).products.some(p => p.id === created.id));
    session = { role: 'admin' };
    const sizeRequest = body => sizes.POST(new Request('https://warehouse.test/api/sizes', { method: 'POST', headers: { origin: 'https://warehouse.test', host: 'warehouse.test' }, body: JSON.stringify(body) }));
    response = await sizeRequest({ id: updated.id, revision: updated.revision, name: updated.name, sizes: ['M'], examples: original.examples, note: '', active: true, show_in_sizes: true });
    assert.equal(response.status, 200);
    session = { role: 'employee' }; assert((await (await sizes.GET()).json()).products.some(p => p.id === created.id));
    session = { role: 'admin' };
    assert.equal((await post({ id: original.id, revision: original.revision, sizes: [], stock_details: original.stock_details })).status, 400);
    assert.deepEqual((await db.query('select * from size_products where id=$1', [original.id])).rows[0], original);
    console.log('PASS creation: name-only and complete forms, real SQL persistence and reload, later edits, one shared catalog, admin-only mutations, picker excluded until ready, original examples/photos untouched, repeatable migration');

    const imageB = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,255,217]).toString('base64');
    const imageC = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,2,255,217]).toString('base64');
    const context = { params: Promise.resolve({ id: original.id }) };
    const getEditor = () => editor.GET(new Request('https://warehouse.test/api/availability/' + original.id), context);
    const getPhoto = (index, etag) => productPhotos.GET(new Request(`https://warehouse.test/api/sizes/${original.id}/photo?index=${index}`, { headers: etag ? { 'if-none-match': etag } : {} }), context);
    const getExtra = kind => extraPhotos.GET(new Request(`https://warehouse.test/api/availability/${original.id}/photo?kind=${kind}`), context);
    const row = async () => (await db.query('select * from size_products where id=$1', [original.id])).rows[0];
    async function edit(patch) {
      const response = await getEditor(); assert.equal(response.status, 200);
      const product = (await response.json()).product;
      assert.equal(product.id, original.id);
      const saved = await post({ id: product.id, revision: product.revision, stock_details: product.stock_details, ...patch });
      assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
      assert.equal((await saved.json()).product.id, original.id);
      const persisted = await row();
      for (const key of ['examples','sizes','note','active']) assert.deepEqual(persisted[key], original[key], key);
      assert.equal((await db.query('select count(*)::int as count from size_products')).rows[0].count, 3);
      return persisted;
    }
    let changed = await edit({ photos: [{ index: 0 }, imageB] });
    assert.deepEqual(changed.photos, [image,imageB]); assert.equal(changed.photo, image);
    let binary = await getPhoto(1); assert.equal(binary.status, 200);
    assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from(imageB.split(',')[1], 'base64'));
    const etag = (await getPhoto(0)).headers.get('etag');
    changed = await edit({ photos: [{ index: 1 }, { index: 0 }] });
    assert.deepEqual(changed.photos, [imageB,image]); assert.equal(changed.photo, imageB);
    assert.equal((await getPhoto(0, etag)).status, 200);
    binary = await getPhoto(0); assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from(imageB.split(',')[1], 'base64'));
    changed = await edit({ photos: [{ index: 0 }, imageC] }); assert.deepEqual(changed.photos, [imageB,imageC]);
    changed = await edit({ photos: [{ index: 1 }], stock_chart: image, stock_models: [image,imageB] });
    assert.deepEqual(changed.photos, [imageC]); assert.equal(changed.photo, imageC); assert.equal(changed.photo_count, 1);
    changed = await edit({ stock_chart: imageB, stock_models: [{ index: 1 }, imageC] });
    assert.deepEqual(changed.stock_models, [imageB,imageC]); assert.equal(changed.stock_chart, imageB);
    const beforeRename = changed;
    changed = await edit({ name: 'Переименовано', stock_details: details });
    for (const key of ['photo','photos','photo_count','stock_chart','stock_has_chart','stock_models','stock_model_count']) assert.deepEqual(changed[key], beforeRename[key], key);
    assert.equal(changed.name, 'Переименовано'); assert.deepEqual(changed.stock_details, details);
    const adminReload = (await (await getEditor()).json()).product;
    assert.equal(adminReload.name, 'Переименовано'); assert.equal(adminReload.stock_model_count, 2);
    let latest = await row();
    assert.equal((await post({ id: original.id, revision: latest.revision, stock_details: details, photos: [{ index: 5 }] })).status, 400);
    assert.equal((await post({ id: original.id, revision: 1, stock_details: details, photos: [{ index: 0 }] })).status, 409);
    assert.deepEqual(await row(), latest);
    session = { role: 'employee' };
    assert.equal((await getEditor()).status, 403);
    const beforeEmployee = calls;
    assert.equal((await post({ id: original.id, revision: latest.revision, stock_details: details, photos: [] })).status, 403);
    assert.equal(calls, beforeEmployee);
    assert.equal((await getPhoto(0)).status, 200); assert.equal((await getExtra('chart')).status, 200); assert.equal((await getExtra('model')).status, 200);
    const pickerProduct = (await (await sizes.GET()).json()).products.find(p => p.id === original.id);
    assert.equal(pickerProduct.name, 'Переименовано'); assert.equal(pickerProduct.photo_count, 1); assert.deepEqual(pickerProduct.examples, original.examples);
    session = null; assert.equal((await getEditor()).status, 401);
    session = { role: 'admin' };
    changed = await edit({ photos: [], stock_chart: null, stock_models: [] });
    assert.deepEqual(changed.photos, []); assert.equal(changed.photo, ''); assert.equal(changed.photo_count, 0);
    assert.deepEqual(changed.stock_models, []); assert.equal(changed.stock_model_count, 0); assert.equal(changed.stock_chart, null); assert.equal(changed.stock_has_chart, false);
    assert.equal((await getPhoto(0)).status, 404); assert.equal((await getExtra('chart')).status, 404); assert.equal((await getExtra('model')).status, 404);
    // Legacy single-photo rows must survive appending without requiring a re-upload.
    await db.query('update size_products set photo=$1, photos=\'[]\'::jsonb, photo_count=1 where id=$2', [image, original.id]);
    changed = await edit({ photos: [{ index: 0 }, imageB] });
    assert.deepEqual(changed.photos, [image,imageB]); assert.equal(changed.photo, image);
    console.log('PASS editing: fresh admin-only editor, append/reorder/replace/delete product and model photos, chart replacement/deletion, legacy photo fallback, persisted reload, shared picker photo bytes, revision conflicts, unchanged examples and no copies');

    // Independent flags, creation in sizes, persisted reload, and recovery from both off.
    response = await sizeRequest({ name: 'Sizes only', note: '', sizes: ['M'], examples: original.examples, photos: [image], active: true });
    assert.equal(response.status, 200);
    const sizeOnly = (await response.json()).product;
    assert.equal(sizeOnly.show_in_sizes, true); assert.equal(sizeOnly.show_in_availability, false);
    assert.equal(created.show_in_availability, true); assert.equal(created.show_in_sizes, false);
    response = await sizeRequest({ id: sizeOnly.id, revision: sizeOnly.revision, name: sizeOnly.name, note: '', sizes: sizeOnly.sizes, examples: sizeOnly.examples, active: true, show_in_availability: true, show_in_sizes: false });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).product.show_in_sizes, false);
    const baseline = (await db.query('select * from size_products where id=$1', [sizeOnly.id])).rows[0];
    for (const availability of [false, true]) for (const sizing of [false, true]) {
      session = { role: 'admin' };
      const current = (await db.query('select * from size_products where id=$1', [sizeOnly.id])).rows[0];
      response = await post({ id: current.id, revision: current.revision, stock_details: current.stock_details, show_in_availability: availability, show_in_sizes: sizing });
      assert.equal(response.status, 200);
      session = { role: 'employee' };
      assert.equal((await (await api.GET()).json()).products.some(p => p.id === sizeOnly.id), availability);
      assert.equal((await (await sizes.GET()).json()).products.some(p => p.id === sizeOnly.id), sizing);
      const beforeDenied = calls;
      assert.equal((await sizeRequest({ ...sizeOnly, show_in_sizes: !sizing })).status, 403);
      assert.equal(calls, beforeDenied);
      session = { role: 'admin' };
      const reload = (await (await api.GET()).json()).products.find(p => p.id === sizeOnly.id);
      assert.equal(reload.show_in_availability, availability); assert.equal(reload.show_in_sizes, sizing);
      assert((await (await sizes.GET()).json()).products.some(p => p.id === sizeOnly.id));
      const persisted = (await db.query('select * from size_products where id=$1', [sizeOnly.id])).rows[0];
      for (const key of Object.keys(baseline).filter(k => !['show_in_availability', 'show_in_sizes', 'revision', 'updated_at'].includes(k))) assert.deepEqual(persisted[key], baseline[key], key);
    }
    // Saved examples must never re-enable a flag after the one-time migration.
    await db.query('update size_products set show_in_sizes=false, show_in_availability=false where id=$1', [sizeOnly.id]);
    const snapshot = (await db.query('select * from size_products order by id')).rows;
    await db.exec(fs.readFileSync('supabase/migrations/20261103064143_independent_catalog_visibility.sql', 'utf8'));
    assert.deepEqual((await db.query('select * from size_products order by id')).rows, snapshot);
    console.log('PASS independent visibility: both creation defaults, four persisted combinations, hidden admin recovery, server rejects employee writes, data unchanged, migration never resets choices');
    const legacyDb = new PGlite();
    try {
      await legacyDb.exec('create role anon; create role authenticated; create role service_role;');
      for (const file of ['20261004_size_catalog.sql', '20261102_availability.sql', '20261102_availability_create.sql']) await legacyDb.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
      for (const active of [true, false]) for (const examples of [[], original.examples]) {
        await legacyDb.query('insert into size_products(name,sizes,examples,photo,photos,photo_count,active) values ($1,$2,$3,$4,$5,1,$6)', ['Legacy', JSON.stringify(['M']), JSON.stringify(examples), image, JSON.stringify([image]), active]);
      }
      const before = (await legacyDb.query('select * from size_products order by id')).rows;
      await legacyDb.exec(fs.readFileSync('supabase/migrations/20261103064143_independent_catalog_visibility.sql', 'utf8'));
      const after = (await legacyDb.query('select * from size_products order by id')).rows;
      assert.equal(after.length, before.length);
      after.forEach((row, i) => {
        const { show_in_availability, show_in_sizes, ...unchanged } = row;
        assert.deepEqual(unchanged, before[i]);
        assert.equal(show_in_availability, true); assert.equal(show_in_sizes, row.examples.length > 0);
      });
      console.log('PASS legacy distribution: active/inactive with/without examples, unchanged IDs and every original column');
    } finally { await legacyDb.close(); }
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
