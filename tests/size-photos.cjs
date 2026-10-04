// Isolated route tests: no database, credentials or network requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
let session = { role: 'employee' }, active = true, revision = 1;
const calls = [];
const id = 'fc3f1719-0a75-44a8-9b8a-c13f6e3290dc';
const photo = 'data:image/jpeg;base64,/9j/2Q==';
const mod = new Module(__filename, module);
mod.filename = __filename; mod.paths = module.paths;
const original = mod.require.bind(mod);
mod.require = name => name === '@/lib/session' ? { getSession: async () => session }
  : name === '@/lib/supabase' ? { createAdminClient: () => ({ from: () => {
    let restricted = false;
    const query = {
      select(fields) { calls.push(fields); return query; },
      eq(field, value) { if (field === 'active') { assert.equal(value, true); restricted = true; } return query; },
      async maybeSingle() { return { data: restricted && !active ? null : { revision, photo, selected: photo }, error: null }; }
    }; return query;
  } }) } : original(name);
mod._compile(ts.transpileModule(fs.readFileSync('src/app/api/sizes/[id]/photo/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, __filename);
const get = (index = 0, etag) => mod.exports.GET(new Request(`http://localhost/api/sizes/${id}/photo?index=${index}`, {
  headers: etag ? { 'if-none-match': etag } : {}
}), { params: Promise.resolve({ id }) });
(async () => {
  let response = await get();
  assert.equal(response.status, 200);
  assert.equal(calls.pop(), 'revision,photo');
  assert.equal(response.headers.get('cache-control'), 'private, no-cache');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from('/9j/2Q==', 'base64'));
  const etag = response.headers.get('etag');
  assert.equal((await get(0, etag)).status, 304);
  revision++;
  response = await get(0, etag);
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get('etag'), etag);
  await get(2); assert.equal(calls.pop(), 'revision,selected:photos->>2');
  active = false; assert.equal((await get(0, etag)).status, 404);
  session = { role: 'admin' }; assert.equal((await get()).status, 200);
  session = null;
  const before = calls.length;
  assert.equal((await get(0, etag)).status, 401);
  assert.equal(calls.length, before);
  console.log('PASS Photo projection, binary response, private revalidation, revision invalidation, gallery selection and authorization before cache reuse');
})().catch(error => { console.error(error); process.exitCode = 1; });
