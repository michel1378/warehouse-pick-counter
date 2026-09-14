const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { SignJWT, jwtVerify } = require('jose');

const secret = 'test-session-secret-at-least-32-characters';
const key = new TextEncoder().encode(secret);
const jar = new Map();
let lastCookie, reads = 0;
let employee = { id: 'employee-1', name: 'Employee', active: true, role: 'online', permissions: ['attendance'] };
let dbError = null;
const mocks = {
  'next/headers': { cookies: async () => ({
    get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name, value, options) => { jar.set(name, value); lastCookie = { name, value, options }; },
    delete: name => jar.delete(name),
  }) },
  '@/lib/env': { env: () => ({ SESSION_SECRET: secret }) },
  '@/lib/supabase': {
    logSupabaseError: () => {},
    createAdminClient: () => ({ from: table => {
      assert.equal(table, 'employees'); // Session validation must never write attendance data.
      return { select: columns => {
        assert.ok(!columns.includes('pin'));
        return { eq: (column, id) => {
          assert.equal(column, 'id'); assert.equal(id, 'employee-1');
          return { maybeSingle: async () => { reads++; return { data: employee, error: dbError }; } };
        } };
      } };
    } }),
  },
};
function load() {
  const exports = {};
  const { outputText } = ts.transpileModule(fs.readFileSync('src/lib/session.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  });
  vm.runInNewContext(outputText, { exports, require: name => mocks[name] ?? require(name), TextEncoder, process: { env: { NODE_ENV: 'production' } } });
  return exports;
}

(async () => {
  let session = load();
  await session.createSession({ sub: employee.id, name: employee.name, role: 'employee', permissions: ['picking'] });
  const { payload } = await jwtVerify(lastCookie.value, key);
  assert.equal(lastCookie.name, 'warehouse_session');
  assert.equal(lastCookie.options.maxAge, 14 * 86400);
  assert.equal(lastCookie.options.httpOnly, true);
  assert.equal(lastCookie.options.secure, true);
  assert.equal(lastCookie.options.sameSite, 'lax');
  assert.equal(lastCookie.options.path, '/');
  assert.equal(payload.exp - payload.iat, 14 * 86400);
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'role', 'sub']);
  session = load(); // New request/process with only the persisted cookie.
  assert.equal((await session.getSession()).permissions[0], 'attendance');
  employee.permissions = ['reviews'];
  assert.equal((await session.getSession()).permissions[0], 'reviews');
  employee.active = false;
  assert.equal(await session.getSession(), null);
  employee.active = true;
  dbError = { code: 'offline' };
  assert.equal(await session.getSession(), null);
  dbError = null;
  const savedEmployee = employee;
  employee = null;
  assert.equal(await session.getSession(), null);
  employee = savedEmployee;
  const validToken = jar.get('warehouse_session');
  jar.set('warehouse_session', validToken.slice(0, -8) + 'tampered');
  assert.equal(await session.getSession(), null);
  // Verify expiry with an explicitly past timestamp, without sleeping.
  jar.set('warehouse_session', await new SignJWT({ role: 'employee' }).setProtectedHeader({ alg: 'HS256' }).setSubject(employee.id).setIssuedAt(1).setExpirationTime(2).sign(key));
  assert.equal(await session.getSession(), null);
  jar.set('warehouse_session', validToken);
  const readsBeforeLogout = reads;
  await session.clearSession();
  assert.equal(await session.getSession(), null);
  assert.equal(reads, readsBeforeLogout);
  await session.createSession({ sub: 'admin-1', name: 'Admin', role: 'admin' });
  assert.equal(lastCookie.options.maxAge, 12 * 3600);
  assert.equal(lastCookie.options.sameSite, 'strict');
  assert.equal((await session.getSession()).role, 'admin');
  assert.equal(reads, readsBeforeLogout);
  console.log('Employee session: persistent cookie, minimal signed payload, current permissions, inactive/deleted employees, invalid/expired tokens, logout and unchanged admin policy passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
