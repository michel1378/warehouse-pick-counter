const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');

// Exercise the server components without requiring production credentials.
function load(file, responses, role = 'admin') {
  const calls = [], logs = [];
  const db = { from(table) {
    const call = { table, methods: [] };
    calls.push(call);
    const chain = { then(resolve, reject) { return Promise.resolve(responses[table]).then(resolve, reject); } };
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'range', 'maybeSingle']) {
      chain[method] = (...args) => { call.methods.push([method, ...args]); return chain; };
    }
    return chain;
  } };
  const mocks = {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { redirect: () => { throw new Error('REDIRECT'); } },
    '@/lib/session': { getSession: async () => role ? { role } : null },
    '@/lib/env': { env: () => ({ WAREHOUSE_TIMEZONE: 'Europe/Moscow' }) },
    '@/lib/dates': {
      formatWarehouseDateTime: value => require('date-fns-tz').formatInTimeZone(value, 'Europe/Moscow', 'dd.MM.yyyy HH:mm:ss'),
      utcRange: () => ({ fromUtc: '2026-09-13T21:00:00.000Z', toUtc: '2026-09-14T21:00:00.000Z' }),
    },
    '@/lib/supabase': { createAdminClient: () => db, logSupabaseError: (...args) => logs.push(args) },
  };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => mocks[name] ?? require(name), URLSearchParams });
  return { exports, calls, logs };
}

const searchFile = 'src/app/admin/order-search/page.tsx';
const orderFile = 'src/components/EmployeeOrders.tsx';
const scan = { id: 's1', barcode: 'P00119280697', employee_id: 'e1', scanned_at: '2026-09-14T10:42:18Z', shift_id: 'shift1', order_interval_seconds: 30 };
const backendError = { code: '42703', message: 'column scan_attempts.shift_id does not exist', details: '', hint: '' };
const ok = data => ({ data, error: null });
const empty = { scans: ok(null), scan_attempts: { ...ok([]), count: 0 } };
const runSearch = async (fixture, barcode = 'P00119280697', role) => {
  const context = load(searchFile, fixture, role);
  const tree = await context.exports.default({ searchParams: Promise.resolve({ barcode }) });
  return { ...context, html: renderToStaticMarkup(tree) };
};

(async () => {
  for (const role of ['employee', null]) {
    const context = load(searchFile, empty, role);
    await assert.rejects(() => context.exports.default({ searchParams: Promise.resolve({ barcode: scan.barcode }) }), /REDIRECT/);
    assert.equal(context.calls.length, 0);
    const orders = load(orderFile, {}, role);
    await assert.rejects(() => orders.exports.EmployeeOrders({ employeeId: 'e1', from: '2026-09-14', to: '2026-09-14' }), /REDIRECT/);
    assert.equal(orders.calls.length, 0);
  }
  for (const barcode of ['  00119280697  ', '  P00119280697  ', '  P00_%+&  ']) {
    const result = await runSearch(empty, barcode);
    assert.match(result.html, /Заказ с таким штрихкодом не найден/);
    assert.equal(result.logs.length, 0);
    for (const call of result.calls) assert.equal(call.methods.find(m => m[0] === 'eq')[2], barcode.trim());
  }
  const attempts = ['counted', 'duplicate', 'too_fast', 'manual'].map((reason, i) => ({
    id: `a${i}`, barcode: scan.barcode, employee_id: 'e1', attempted_at: scan.scanned_at,
    success: reason === 'counted', duplicate_of: reason === 'duplicate' ? 's1' : null, reason, shift_id: null,
  }));
  const fixture = { scans: ok(scan), scan_attempts: { ...ok(attempts), count: 4 }, employees: ok([{ id: 'e1', name: 'Артём' }]) };
  const found = await runSearch(fixture);
  for (const status of ['successful', 'duplicate', 'too_fast', 'manual']) assert.ok(found.html.includes(status));
  assert.match(found.html, /14.09.2026 13:42:18/);
  assert.match(found.html, /from=2026-09-14&amp;to=2026-09-14#collected-orders/);
  assert.ok(found.html.indexOf('Собирал:') < found.html.indexOf('Все попытки:'));
  const partial = await runSearch({ ...fixture, scan_attempts: { data: null, error: backendError } });
  assert.match(partial.html, /Собирал:/);
  assert.doesNotMatch(partial.html, /Заказ с таким штрихкодом не найден/);
  assert.equal(partial.logs[0][0], 'admin order search: scan_attempts');
  assert.equal(partial.logs[0][1], backendError);
  assert.ok(!partial.html.includes(backendError.message));
  const namesError = await runSearch({ ...fixture, employees: { data: null, error: backendError } });
  assert.match(namesError.html, /employee_id/);
  assert.match(namesError.html, /Собирал:/);
  const orders = load(orderFile, { scans: { ...ok([scan]), count: 101 } });
  const html = renderToStaticMarkup(await orders.exports.EmployeeOrders({ employeeId: 'e1', from: '2026-09-14', to: '2026-09-14', barcode: '  P00119280697 ', page: '2' }));
  assert.match(html, /order-search\?barcode=P00119280697/);
  assert.match(html, /13:42:18/);
  const methods = orders.calls[0].methods;
  assert.equal(methods.find(m => m[0] === 'eq' && m[1] === 'employee_id')[2], 'e1');
  assert.equal(methods.find(m => m[0] === 'eq' && m[1] === 'barcode')[2], scan.barcode);
  assert.equal(JSON.stringify(methods.find(m => m[0] === 'range')), JSON.stringify(['range', 50, 99]));
  assert.match(html, /ordersPage=3/);
  console.log('Order search and employee orders: authorization, empty results, exact barcodes, partial errors, links and pagination passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
