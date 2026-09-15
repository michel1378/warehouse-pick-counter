const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");
let calls = [], result = "counted";
const employeeId = "11111111-1111-4111-8111-111111111111";
const chain = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: employeeId } }) };
const mocks = {
  "@/lib/env": { env: () => ({ SCANNER_AGENT_API_TOKEN: "test-token", WAREHOUSE_TIMEZONE: "Europe/Moscow" }) },
  "@/lib/scanner-agent": { validAgentToken: token => token === "test-token", agentRateLimited: () => false },
  "@/lib/supabase": {
    logSupabaseError() {},
    createAdminClient: () => ({
      from: () => chain,
      rpc: async (name, args) => { calls.push({ name, args }); return { data: [{ result, orders_today: 1, earnings_today: 23, message: "ok" }] }; },
    }),
  },
};
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? require(name) });
  return exports;
}
const scan = load("src/app/api/scanner-agent/scan/route.ts");
const body = {
  event_id: "22222222-2222-4222-8222-222222222222",
  employee_identifier: employeeId, barcode: "0012345678", duration_ms: 100,
  scanner_device: "HID-test", scanned_at: "2026-09-14T10:42:18Z",
  shift_id: "33333333-3333-4333-8333-333333333333",
  input_metadata: { average_interval_ms: 10, source: "windows-agent" },
};
(async () => {
  for (const barcode of ["0012345678", "12345678901234567890", "P00119280697", " p00119280697 "]) {
    const response = await scan.POST(new NextRequest("https://example.invalid/api/scanner-agent/scan", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ ...body, barcode }) }));
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).args.p_barcode, barcode.trim().replace(/^p(?=[0-9]+$)/, "P"));
    assert.equal(calls.at(-1).args.p_scanned_at_client, body.scanned_at);
    assert.equal(calls.at(-1).args.p_event_id, body.event_id);
  }
  const before = calls.length;
  for (const barcode of ["p00 119280697", "0012 345678", "ABC123", "TEST123", "P1234567", "Р00119280697", "P0011928069A"]) {
    const response = await scan.POST(new NextRequest("https://example.invalid/api/scanner-agent/scan", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ ...body, barcode }) }));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, before);
  const unauthorized = await scan.POST(new NextRequest("https://example.invalid/api/scanner-agent/scan", { method: "POST", body: JSON.stringify(body) }));
  assert.equal(unauthorized.status, 401);
  result = "duplicate";
  const duplicate = await scan.POST(new NextRequest("https://example.invalid/api/scanner-agent/scan", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ ...body, barcode: "P00119280697" }) }));
  assert.equal((await duplicate.json()).result, "duplicate");
  const health = load("src/app/api/scanner-agent/health/route.ts");
  assert.equal(health.GET(new NextRequest("https://example.invalid/api/scanner-agent/health")).status, 401);
  assert.equal(health.GET(new NextRequest("https://example.invalid/api/scanner-agent/health", { headers: { authorization: "Bearer test-token" } })).status, 200);
  const shift = load("src/app/api/scanner-agent/shift/route.ts");
  const shiftRequest = () => new NextRequest(`https://example.invalid/api/scanner-agent/shift?employee_identifier=${employeeId}`, { headers: { authorization: "Bearer test-token" } });
  chain.maybeSingle = async () => ({ data: null, error: { code: "offline" } });
  assert.equal((await shift.GET(shiftRequest())).status, 503);
  chain.maybeSingle = async () => ({ data: null, error: null });
  assert.equal((await shift.GET(shiftRequest())).status, 403);
  const bcrypt = require("bcryptjs");
  let employeeData = [{ id: employeeId, name: "Worker", role: "warehouse", permissions: ["picking"], pin_hash: bcrypt.hashSync("1234", 4) }];
  chain.then = resolve => Promise.resolve({ data: employeeData, error: null }).then(resolve);
  const employee = load("src/app/api/scanner-agent/employee/route.ts");
  const loginRequest = pin => new NextRequest("https://example.invalid/api/scanner-agent/employee", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ pin }) });
  const login = await employee.POST(loginRequest("1234"));
  assert.equal(login.status, 200);
  const mapping = await login.json();
  assert.equal(mapping.id, employeeId); assert.equal(mapping.pin_hash, undefined); assert.equal(mapping.pin, undefined);
  assert.equal((await employee.POST(loginRequest("9999"))).status, 403);
  employeeData[0].permissions = ["attendance"];
  assert.equal((await employee.POST(loginRequest("1234"))).status, 403);
  console.log("PASS: backend barcode validation, token guard, health, event_id/scanned_at, duplicate contract, transient DB vs missing employee, PIN resolve and picking permissions.");
})().catch(error => { console.error(error); process.exitCode = 1; });
