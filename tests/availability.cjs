// Isolated API/security checks plus real additive SQL in PGlite. No live credentials or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const id = 'fc3f1719-0a75-44a8-9b8a-c13f6e3290dc';
const image = 'data:image/jpeg;base64,/9j/2Q==';
const fields = { composition: '', material: '', stretch: '', colors: [] };
let session = null, active = true, revision = 1, conflict = false, saved, dbCalls = 0;
const cache = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name === '@/lib/session' ? { getSession: async () => session }
    : name === '@/lib/supabase' ? { logSupabaseError() {}, createAdminClient: () => ({ from(table) {
      assert.equal(table, 'size_products'); dbCalls++; let restricted = false, update;
      const q = {
        select() { return q; }, order() { return q; }, range() { return q; },
        eq(field, value) { if (field === 'active') { assert.equal(value, true); restricted = true; } return q; },
        update(row) { saved = update = row; return q; },
        async maybeSingle() { return { data: (restricted && !active) || (update && conflict) ? null : { id, sizes: ['M','L'], revision, selected: image, stock_details: fields }, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: restricted && !active ? [] : [{ id }], error: null }).then(resolve, reject); },
      }; return q;
    } }) }
    : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const api = load('src/app/api/availability/route.ts');
const photos = load('src/app/api/availability/[id]/photo/route.ts');
const schema = load('src/lib/availability.ts').availabilitySaveSchema;
const payload = () => ({ id, revision, stock_details: fields });
const post = (body = payload(), origin = 'https://warehouse.test') => api.POST(new Request('https://warehouse.test/api/availability', { method: 'POST', headers: { origin, host: 'warehouse.test', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const photo = (query = 'kind=chart', etag) => photos.GET(new Request(`https://warehouse.test/api/availability/${id}/photo?${query}`, { headers: etag ? { 'if-none-match': etag } : {} }), { params: Promise.resolve({ id }) });
(async () => {
  assert.equal((await api.GET()).status, 401); assert.equal((await post()).status, 401); assert.equal((await photo()).status, 401); assert.equal(dbCalls, 0);
  session = { role: 'employee' };
  assert.equal((await post()).status, 403); assert.equal(dbCalls, 0);
  active = false; assert.deepEqual((await (await api.GET()).json()).products, []); assert.equal((await photo()).status, 404);
  active = true; assert.equal((await api.GET()).status, 200);
  const response = await photo(); assert.equal(response.status, 200); assert.equal(response.headers.get('vary'), 'Cookie');
  const etag = response.headers.get('etag'); assert.equal((await photo('kind=chart', etag)).status, 304);
  active = false; assert.equal((await photo('kind=chart', etag)).status, 404);
  session = null; assert.equal((await photo('kind=chart', etag)).status, 401);
  session = { role: 'admin' }; assert.equal((await photo()).status, 200); assert.equal((await photo('kind=model&index=5')).status, 200); assert.equal((await photo('kind=model&index=6')).status, 400);
  assert.equal((await post(payload(), 'https://evil.test')).status, 403);
  assert.equal((await post({ ...payload(), name: 'overwrite' })).status, 400);
  assert.equal((await post({ ...payload(), stock_details: { ...fields, colors: [{ name: 'Красный', sizes: ['XL'] }] } })).status, 400);
  assert.equal((await post({ ...payload(), revision: 99 })).status, 409);
  conflict = true; assert.equal((await post()).status, 409); conflict = false;
  for (const sizes of [null, [], ['M']]) {
    assert.equal((await post({ ...payload(), stock_details: { ...fields, colors: [{ name: 'Красный', sizes }] } })).status, 200);
    assert.deepEqual(saved.stock_details.colors[0].sizes, sizes);
    for (const field of ['name','photo','photos','examples','sizes','active','stock_chart','stock_models']) assert.equal(field in saved, false);
    assert.equal(saved.revision, revision + 1);
  }
  assert.equal((await post({ ...payload(), stock_chart: image, stock_models: [image] })).status, 200);
  assert.equal(saved.stock_has_chart, true); assert.equal(saved.stock_model_count, 1);
  assert.equal((await post({ ...payload(), stock_chart: null, stock_models: [] })).status, 200);
  assert.equal(saved.stock_has_chart, false); assert.equal(saved.stock_model_count, 0);
  assert.equal(schema.safeParse({ ...payload(), stock_chart: 'data:image/jpeg;base64,AAAA' }).success, false);
  assert.equal(schema.safeParse({ ...payload(), stock_details: { ...fields, colors: [{ name: 'Синий', sizes: null }, { name: 'синий', sizes: [] }] } }).success, false);
  assert.equal((await post({ ...payload(), stock_details: { ...fields, material: 'x'.repeat(2900000) } })).status, 413);
  console.log('PASS API: sessions, employee read-only, active visibility, Origin, bounded body, validation, conflicts, independent images and untouched catalog fields');

  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(fs.readFileSync('supabase/migrations/20261004_size_catalog.sql', 'utf8'));
    await db.query("insert into size_products(id,name,note,sizes,examples,photo,photos,photo_count,active) values ($1,'Existing','note','[\"M\"]','[{\"height\":175,\"weight\":70,\"size\":\"M\",\"fit\":\"regular\"}]',$2,$3,1,true)", [id, image, JSON.stringify([image])]);
    const before = (await db.query('select * from size_products')).rows[0];
    const migration = fs.readFileSync('supabase/migrations/20261102_availability.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    const after = (await db.query('select * from size_products')).rows[0];
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key);
    assert.deepEqual(after.stock_details, fields); assert.equal(after.stock_chart, null); assert.deepEqual(after.stock_models, []);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}', 'size_products', 'SELECT') as allowed`)).rows[0].allowed, false);
      assert.equal((await db.query(`select has_table_privilege('${role}', 'size_products', 'UPDATE') as allowed`)).rows[0].allowed, false);
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='size_products'::regclass")).rows[0].relrowsecurity, true);
    console.log('PASS SQL: actual additive migration, repeat application, all original data preserved, unspecified defaults, RLS and direct access denied');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
