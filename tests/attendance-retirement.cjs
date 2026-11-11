const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let current, created;
const redirect = path => { throw Object.assign(new Error(path), { redirect: path }); };
function load(path) {
  const exports = {};
  const mocks = {
    'next/navigation': { redirect },
    'next/cache': { revalidatePath() {} },
    'bcryptjs': { default: { compare: async () => true } },
    '@/lib/session': { getSession: async () => current, createSession: async value => { created = value; } },
    '@/lib/supabase': { createAdminClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: [{ id: 'worker', name: 'Worker', role: 'online', pin_hash: 'hash', permissions: current.permissions }] }) }) }) }) },
  };
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(js, { exports, require: name => mocks[name] ?? (name.startsWith('@/') ? {} : require(name)) });
  return exports;
}
const destination = async (call, expected) => assert.rejects(call, error => error.redirect === expected);
(async () => {
  const loginPage = load('src/app/page.tsx').default;
  const scanPage = load('src/app/scan/page.tsx').default;
  const actions = load('src/app/actions.ts');
  const form = new FormData(); form.set('pin', '1234');
  for (const [permissions, expected] of [
    [['attendance'], '/sizes'], [[], '/sizes'], [['reviews'], '/sizes'],
    [['attendance', 'picking'], '/scan'], [['picking', 'reviews'], '/scan'],
  ]) {
    current = { sub: 'worker', name: 'Worker', role: 'employee', permissions };
    await destination(() => loginPage(), expected);
    await destination(() => actions.loginEmployee({}, form), expected);
    assert.equal(created.sub, 'worker');
  }
  current.permissions = [];
  await destination(() => scanPage(), '/sizes');
  current.permissions = ['reviews'];
  await destination(() => scanPage(), '/sizes');
  current.permissions = ['picking'];
  current = { role: 'admin' };
  await destination(() => loginPage(), '/admin');
  for (const path of ['src/app/reviews/page.tsx', 'src/app/admin/reviews/page.tsx', 'src/app/api/reviews/generate/route.ts', 'src/components/ReviewsWorkspace.tsx', 'src/lib/reviews-ai.ts']) assert.equal(fs.existsSync(path), false);
  assert.equal(actions.startTimeSession, undefined);
  assert.equal(actions.finishTimeSession, undefined);
  console.log('PASS retired attendance: existing and new logins, catalog-only access, redirects without loops, removed mutations.');
})().catch(error => { console.error(error); process.exitCode = 1; });
