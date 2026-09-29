const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID:uuid}=require('node:crypto');
const order=['20260830_scanner_input_metadata.sql','20260830_scanner_agent.sql','20260830_work_shifts.sql','20260830_order_assembly_intervals.sql','20260831_scanner_client_time.sql','20260901_too_fast_antifraud.sql','20260906_employee_attendance.sql','20260907_ai_reviews.sql','20260910_employee_time_session_edits.sql','20260914_order_search.sql','20260915_global_barcode_uniqueness.sql','20260928_scanner_reliability.sql'];
async function run(db,connect){
 await db.query('create role anon;create role authenticated;create role service_role;');
 await db.query(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 for(const name of order) {
  if(name==='20260928_scanner_reliability.sql') await db.query('alter table scan_attempts drop column reason, drop column shift_id; alter table scanner_agent_events drop column reason, drop column barcode');
  await db.query(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 }
 const ready=()=>db.query("select scanner_scan_v2('{}',true) r");
 await db.query('set role service_role');
 await db.query('begin read only'); assert.equal((await ready()).rows[0].r.ready,true);await db.query('rollback');await db.query('reset role');
 for(const [input,normalized,valid] of JSON.parse(fs.readFileSync('tests/fixtures/barcodes.json'))){
  if(input.includes('\0'))continue; // PostgreSQL text cannot represent NUL; HTTP/C# reject it.
  const r=(await db.query("select normalize_scan_barcode($1) n, (length(normalize_scan_barcode($1))<=512 and (normalize_scan_barcode($1) ~ '^[0-9]{8,}$' or normalize_scan_barcode($1) ~ '^P[0-9]{8,}$')) v",[input])).rows[0];assert.equal(r.n,normalized);assert.equal(r.v,valid);
 }
 const [a,b]=(await db.query("insert into employees(name,pin_hash) values('Natasha','fixture'),('Artem','fixture') returning id")).rows.map(r=>r.id);
 const action=async(client,e,act,s=null,op=uuid())=>(await client.query('select scanner_shift_action($1,$2,$3,$4) r',[e,act,op,s])).rows[0].r;
 const wa=await action(db,a,'start'),wb=await action(db,b,'start');
 const make=(employee,shift,barcode,event=uuid())=>({employee_id:employee,shift_id:shift,barcode,event_id:event,duration_ms:100,scanner_device:'fixture',scanned_at:new Date().toISOString(),timezone:'Europe/Moscow'});
 const scan=async(client,body)=>(await client.query('select scanner_scan_v2($1,false) r',[JSON.stringify(body)])).rows[0].r;
 const x=make(a,wa.id,'p00119280697');const first=await scan(db,x);assert.equal(first.result,'counted');assert.deepEqual(await scan(db,x),first);
 const duplicate=await scan(db,make(b,wb.id,'P00119280697'));assert.equal(duplicate.result,'duplicate');assert.equal(duplicate.ordersToday,0);assert.equal(duplicate.earningsToday,0);
 const fast=make(a,wa.id,'0012345678');fast.scanned_at=new Date(new Date(x.scanned_at).getTime()+1000).toISOString();assert.equal((await scan(db,fast)).result,'counted');
 const invalid=make(a,wa.id,'0012 345678');const invalidResult=await scan(db,invalid);assert.equal(invalidResult.reason,'invalid_barcode');assert.deepEqual(await scan(db,{...invalid,barcode:'99999999'}),invalidResult);
 const inactive=make(b,wb.id,'88888888');await db.query('update employees set active=false where id=$1',[b]);const rejected=await scan(db,inactive);assert.equal(rejected.reason,'employee_inactive');await db.query('update employees set active=true where id=$1',[b]);assert.deepEqual(await scan(db,inactive),rejected);
 const op=uuid();const paused=await action(db,a,'pause',wa.id,op);assert.equal(paused.status,'paused');assert.deepEqual(await action(db,a,'pause',wa.id,op),paused);assert.equal((await action(db,a,'resume',wa.id)).status,'active');
 const finished=await action(db,a,'finish',wa.id);assert.equal(finished.orders_count,2);assert.equal((await action(db,a,'finish',wa.id)).id,wa.id);
 const late=make(a,wa.id,'77777777');assert.equal((await scan(db,late)).reason,'shift_inactive');
 // An insert failure must roll back the shift transition and operation receipt.
 await db.query("create function fail_pause() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$; create trigger fail_pause before insert on work_shift_pauses for each row execute function fail_pause();");
 await assert.rejects(action(db,b,'pause',wb.id),/fixture/);assert.equal((await db.query('select status from work_shifts where id=$1',[wb.id])).rows[0].status,'active');await db.query('drop trigger fail_pause on work_shift_pauses');
 await db.query('begin; alter table scan_attempts rename column reason to missing_reason');await assert.rejects(ready());await db.query('rollback');
 await db.query('begin; drop function shift_order_metrics(uuid) cascade');await assert.rejects(ready());await db.query('rollback');
 if(connect){
  const c1=await connect(),c2=await connect();try{
   const e=(await db.query("insert into employees(name,pin_hash) values('Concurrent','fixture') returning id")).rows[0].id;
   const starts=await Promise.all([action(c1,e,'start'),action(c2,e,'start')]);assert.equal(starts[0].id,starts[1].id);
   const results=await Promise.all([scan(c1,make(e,starts[0].id,'66666666')),scan(c2,make(b,wb.id,'66666666'))]);assert.deepEqual(results.map(r=>r.result).sort(),['counted','duplicate']);
   const retry=make(e,starts[0].id,'55555555');const replies=await Promise.all([scan(c1,retry),scan(c2,retry)]);assert.deepEqual(replies[0],replies[1]);
   const race=await Promise.all([scan(c1,make(e,starts[0].id,'44444444')),action(c2,e,'finish',starts[0].id)]);assert.ok(['counted','rejected'].includes(race[0].result));
   const total=Number((await db.query('select count(*) n from scans where shift_id=$1',[starts[0].id])).rows[0].n);assert.equal(race[1].orders_count,total);
   // Force both scan/finish lock orderings using an open transaction.
   for(const winner of ['scan','finish']) {
    const shift=await action(db,e,'start');
    await c1.query('begin');
    const packet=make(e,shift.id,winner==='scan'?'33333333':'22222222');
    const first=winner==='scan'?await scan(c1,packet):await action(c1,e,'finish',shift.id);
    let settled=false;
    const waiting=(winner==='scan'?action(c2,e,'finish',shift.id):scan(c2,packet)).finally(()=>settled=true);
    await db.query('select pg_sleep(0.05)');assert.equal(settled,false,'second transaction waits for employee lock');
    await c1.query('commit');const second=await waiting;
    assert.equal((winner==='scan'?first:second).result,winner==='scan'?'counted':'rejected');
    assert.equal((winner==='scan'?second:first).orders_count,winner==='scan'?1:0);
   }
   console.log('PASS real PostgreSQL: parallel starts, cross-client duplicate, same event concurrency, scan/finish atomic totals');
  }finally{await c1.end();await c2.end();}
 }
 console.log('PASS schema install, read-only readiness, missing column/RPC, shared barcode vectors, receipts, business rejections, no cooldown, shift rollback');
}
(async()=>{
 if(process.argv.includes('--postgres')){
  const {execFileSync}=require('node:child_process'),{Client}=require('pg');
  const root=path.join(require('node:os').tmpdir(),'warehouse-postgres-'+uuid());fs.mkdirSync(root,{recursive:true});
  const native=path.join(root,'native'); fs.cpSync(path.resolve('node_modules/@embedded-postgres/windows-x64/native'),native,{recursive:true});
  const bin=path.join(native,'bin');const data=path.join(root,'data');
  const net=require('node:net');const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const exec=(name,args)=>{const fd=fs.openSync(path.join(root,'commands.log'),'a');try{return execFileSync(path.join(bin,name+'.exe'),args,{windowsHide:true,stdio:['ignore',fd,fd],timeout:60000});}finally{fs.closeSync(fd);}};
  exec('initdb',['-D',data,'-U','fixture','-A','trust','--no-locale','--encoding=UTF8']);
  exec('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);
  const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'fixture',database:'postgres'});await c.connect();await c.query("set statement_timeout='15s'");return c;};let db;
  try{db=await connect();await run(db,connect);}finally{if(db)await db.end();exec('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
 }else{const {PGlite}=require('@electric-sql/pglite');const p=new PGlite();try{await run({query:(sql,params)=>params?p.query(sql,params):p.exec(sql).then(r=>r.at(-1))});}finally{await p.close();}}
})().catch(e=>{console.error(e);process.exitCode=1;});
