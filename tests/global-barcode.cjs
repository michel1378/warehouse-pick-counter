const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');
const read = file => fs.readFileSync(file, 'utf8');

(async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated;');
    await db.exec(read('supabase/schema.sql').replace('create extension if not exists pgcrypto;', ''));
    for (const file of ['20260830_scanner_input_metadata.sql', '20260830_scanner_agent.sql',
      '20260830_work_shifts.sql', '20260830_order_assembly_intervals.sql',
      '20260831_scanner_client_time.sql', '20260901_too_fast_antifraud.sql']) {
      await db.exec(read(`supabase/migrations/${file}`));
    }
    const employees = (await db.query("insert into employees(name,pin_hash) values ('Artem','test'),('Dasha','test') returning id")).rows;
    const [a, b] = employees.map(row => row.id);
    const migration = read('supabase/migrations/20260915_global_barcode_uniqueness.sql');
    await db.query("insert into scans(barcode,employee_id) values ('p00119280697',$1),('P00119280697',$2)", [a,b]);
    await assert.rejects(db.exec(migration), /1 groups, 2 rows, 1 excess rows/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from scans')).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='scans' and column_name='normalized_barcode'")).rows[0].n, 0);
    // Disposable test fixtures only; production migration never deletes rows.
    await db.exec('delete from scans');
    // Reproduce a deployment that lost the global raw constraint.
    await db.exec('alter table scans drop constraint scans_barcode_key; create unique index employee_barcode_test on scans(employee_id,barcode)');
    await db.exec(migration);
    for (const [input, expected] of [['\t p00119280697\r\n','P00119280697'], ['0012345678','0012345678'], ['12345678','12345678'], ['12 345678','12 345678'], ['pAbc12345','pAbc12345'], ['\u00a0p00119280697\ufeff','P00119280697']]) {
      assert.equal((await db.query('select normalize_scan_barcode($1) value',[input])).rows[0].value, expected);
    }
    const shifts = [];
    for (const employee of [a,b]) shifts.push((await db.query('insert into work_shifts(employee_id) values ($1) returning id',[employee])).rows[0].id);
    const uuid = () => require('node:crypto').randomUUID();
    const at = new Date().toISOString();
    const older = new Date(Date.now()-60000).toISOString();
    async function scan(employee,shift,barcode,event=uuid(),time=at) {
      return (await db.query("select * from register_agent_scan($1,$2,$3,100,'test-device','Europe/Moscow',$4,$5,'{}')",[event,barcode,employee,shift,time])).rows[0];
    }
    const event = uuid();
    const first = await scan(a,shifts[0],' p00119280697 ',event);
    assert.equal(first.result,'counted');
    const second = await scan(b,shifts[1],'P00119280697',uuid(),older);
    assert.equal(second.result,'duplicate');
    assert.equal(Number(second.orders_today),0);
    assert.equal(Number(second.earnings_today),0);
    assert.equal(second.last_interval_seconds,null);
    assert.deepEqual(await scan(a,shifts[0],' p00119280697 ',event),first);
    assert.equal((await db.query('select count(*)::int n from scans')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from scan_attempts')).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from scan_attempts where employee_id=$1 and reason='duplicate' and not success and duplicate_of is not null",[b])).rows[0].n,1);
    assert.equal(new Date((await db.query('select scanned_at from scans')).rows[0].scanned_at).toISOString(),at);
    assert.equal((await db.query('select * from register_scan($1,$2,100,false)',['p00119280697',b])).rows[0].success,false);
    assert.equal((await db.query('select * from register_scan($1,$2,100,false)',['0012345678',a])).rows[0].success,true);
    assert.equal((await scan(b,shifts[1],'0012345678')).result,'duplicate');
    assert.equal((await scan(b,shifts[1],'12345678')).result,'counted');
    const metrics = (await db.query('select * from shift_order_metrics($1)',[shifts[1]])).rows;
    assert.equal((await scan(b,shifts[1],'12345678')).result,'duplicate');
    assert.equal((await scan(b,shifts[1],'99999999')).result,'rejected');
    assert.deepEqual((await db.query('select * from shift_order_metrics($1)',[shifts[1]])).rows,metrics);
    await assert.rejects(db.query("insert into scans(barcode,employee_id) values ('\tP00119280697 ',$1)",[b]),e=>e.code==='23505');
    await assert.rejects(db.query("update scans set barcode='p00119280697' where barcode='12345678'"),e=>e.code==='23505');
    // The original raw UNIQUE may also remain: both arbiters must coexist.
    await db.exec('alter table scans add constraint scans_barcode_key unique(barcode)');
    assert.equal((await db.query('select * from register_scan($1,$2,100,false)',['0012345678',b])).rows[0].success,false);
    assert.equal((await scan(b,shifts[1],'P00119280697')).result,'duplicate');
    console.log('PASS: collision audit rollback, restored global uniqueness, normalization, cross-employee/shift duplicate, offline timestamps, retries, both RPCs, audit, +0 earnings, cooldown, metrics, direct writes.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
