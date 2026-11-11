const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let session;
const Catalog = () => null;
function load(path) {
  const exports = {};
  const mocks = {
    'next/navigation': { redirect: path => { throw Object.assign(new Error(path), { redirect: path }); } },
    'next/link': { default: () => null },
    '@/lib/session': { getSession: async () => session },
    '@/components/sizes/SizeCatalog': { SizeCatalog: Catalog },
    '@/app/actions': { logout() {} },
  };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => mocks[name] ?? require(name) });
  return exports.default;
}
function findCatalog(node) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === Catalog) return node;
  return [node.props?.children].flat().map(findCatalog).find(Boolean);
}
(async () => {
  const preview = load('src/app/admin/sizes-preview/page.tsx');
  const adminCatalog = load('src/app/admin/sizes/page.tsx');
  for (session of [null, { role: 'employee' }, { role: 'online' }]) {
    await assert.rejects(preview, e => e.redirect === '/admin/login');
    await assert.rejects(adminCatalog, e => e.redirect === '/admin/login');
  }
  session = { role: 'admin' };
  assert.equal(findCatalog(await preview()).props.detailed, true);
  assert.equal(findCatalog(await adminCatalog()).props.detailed, true);
  assert.equal(findCatalog(await adminCatalog()).props.admin, true);
  session = { role: 'employee', permissions: [] };
  const ordinary = load('src/app/sizes/page.tsx');
  assert.equal(findCatalog(await ordinary()).props.detailed, true);
  session = null;
  await assert.rejects(ordinary, e => e.redirect === '/');
  console.log('PASS admin and employee catalogs use the same detailed picker; admin routes and employee login remain protected.');
})().catch(error => { console.error(error); process.exitCode = 1; });
