// Execute the prepared transfer on synthetic, memory-only rows. Never contacts Supabase.
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {prepare}=require('../scripts/prepare-existing-size-transfer.cjs');
const {prepareSql,prepareRollbackSql}=require('../scripts/prepare-size-grid-sql.cjs');
const names=['Брюки Огромнейшие','Лонгслив Альпака пуговицы (в полоску)'];
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const db=new PGlite();
const rows=async()=> (await db.query('select * from size_products order by id')).rows;
async function reset(){
  await db.exec('drop table if exists size_products cascade; create table size_products(id uuid primary key,name text,revision integer not null default 1,size_profile jsonb,updated_at timestamptz default now(),photos jsonb,photo_count integer default 1,examples jsonb,active boolean,show_in_sizes boolean,show_in_availability boolean,sizes jsonb,note text)');
  for(let i=0;i<2;i++)await db.query("insert into size_products(id,name,photos,examples,active,show_in_sizes,show_in_availability,sizes,note) values($1,$2,'[\"unchanged-photo-reference\"]','[{\"height\":163,\"weight\":60,\"fit\":\"regular\",\"size\":\"L\"}]',true,true,false,'[\"M\",\"L\"]','keep note')",[ids[i],names[i]]);
}
async function rejected(sql,pattern){await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');}
(async()=>{try{
  await reset();let before=await rows(),plan=prepare(before),sql=prepareSql(plan);
  assert(!/insert\s+into/i.test(sql));await db.exec(sql);let after=await rows();
  for(let i=0;i<2;i++){
    for(const key of Object.keys(before[i]).filter(k=>!['size_profile','revision','updated_at'].includes(k)))assert.deepEqual(after[i][key],before[i][key],key);
    assert.equal(after[i].revision,before[i].revision+1);assert.deepEqual(after[i].size_profile,plan.cards[i].set.size_profile);
  }
  await reset();plan=prepare(await rows());await db.query('update size_products set revision=2 where id=$1',[ids[1]]);before=await rows();
  await rejected(prepareSql(plan),/Card changed since export/);assert.deepEqual(await rows(),before,'second-card conflict rolls back first grid');
  await reset();plan=prepare(await rows());await db.query('update size_products set size_profile=$1 where id=$2',['{"existing":"keep"}',ids[1]]);before=await rows();
  await rejected(prepareSql(plan),/Existing grid differs/);assert.deepEqual(await rows(),before);
  await reset();plan=prepare(await rows());await db.query('insert into size_products(id,name) values($1,$2)',['33333333-3333-4333-8333-333333333333',names[1]]);before=await rows();
  await rejected(prepareSql(plan),/Missing or ambiguous/);assert.deepEqual(await rows(),before);
  await reset();plan=prepare(await rows());await db.query('delete from size_products where id=$1',[ids[1]]);before=await rows();
  await rejected(prepareSql(plan),/Missing or ambiguous/);assert.deepEqual(await rows(),before);
  assert.throws(()=>prepareSql(prepare([])),/uniquely resolved/);
  // An export omitting size_profile cannot authorize overwriting a grid found later.
  await reset();plan=prepare((await rows()).map(({size_profile,...row})=>row));
  await db.query('update size_products set size_profile=$1 where id=$2',['{"existing":"keep"}',ids[1]]);before=await rows();
  await rejected(prepareSql(plan),/Existing grid differs/);assert.deepEqual(await rows(),before);

  // The diagnostic itself is read-only and exports hashes, not pictures/examples.
  await reset();before=await rows();
  const diagnostics=await db.exec(require('node:fs').readFileSync('supabase/diagnostics/size_grid_transfer_preflight.sql','utf8'));
  const diagnostic=diagnostics.flatMap(result=>result.rows??[]).find(row=>row.size_grid_preflight)?.size_grid_preflight;
  assert(diagnostic);assert.equal(diagnostic.profile_column_exists,true);assert.equal(diagnostic.profile_column_type,'jsonb');
  assert.equal(diagnostic.products.length,2);assert(diagnostic.products.every(row=>Object.hasOwn(row,'size_profile')&&/^[a-f0-9]{32}$/.test(row.protected_fields_md5)));
  assert(diagnostic.products.every(row=>!Object.hasOwn(row,'photos')&&!Object.hasOwn(row,'photo')&&!Object.hasOwn(row,'examples')));
  assert.deepEqual(await rows(),before);
  plan=prepare(diagnostic);sql=prepareSql(plan);const rollback=prepareRollbackSql(plan);
  await db.exec(sql);after=await rows();await db.exec(rollback);const restored=await rows();
  for(let i=0;i<2;i++){
    assert.equal(restored[i].revision,3);
    for(const key of Object.keys(before[i]).filter(k=>!['revision','updated_at'].includes(k)))assert.deepEqual(restored[i][key],before[i][key],key);
  }
  assert(!/\b(insert\s+into|delete\s+from|alter\s+table|drop\s+table)\b/i.test(sql));
  await reset();before=await rows();plan=prepare(before);assert.throws(()=>prepareRollbackSql(prepare(before.map(({size_profile,...rest})=>rest))),/not included/);
  await db.exec(prepareSql(plan));await db.query('update size_products set revision=revision+1 where id=$1',[ids[1]]);before=await rows();
  await rejected(prepareRollbackSql(plan),/Rollback stopped/);assert.deepEqual(await rows(),before,'later edits block rollback of both cards');
  await reset();plan=prepare((await db.exec(require('node:fs').readFileSync('supabase/diagnostics/size_grid_transfer_preflight.sql','utf8'))).flatMap(r=>r.rows??[]).find(r=>r.size_grid_preflight).size_grid_preflight);
  await db.query("update size_products set photos='[\"later photo\"]' where id=$1",[ids[1]]);before=await rows();
  await rejected(prepareSql(plan),/Protected fields changed/);assert.deepEqual(await rows(),before,'photo hash conflict rolls back first grid');
  await reset();
  const oldGrid={garment:'top',fabric:'Старая ткань',stretch:'unknown',cut:'',columns:['Плечи'],rows:[{size:'M',values:[40]}]};
  for(const id of ids)await db.query('update size_products set size_profile=$1 where id=$2',[JSON.stringify(oldGrid),id]);
  before=await rows();plan=prepare(before);await db.exec(prepareSql(plan));await db.exec(prepareRollbackSql(plan));after=await rows();
  assert.deepEqual(after.map(r=>r.size_profile),before.map(r=>r.size_profile),'exact nonempty former grids restored');
  await reset();await db.exec('alter table size_products drop column size_profile');before=await rows();
  const beforeMigration=(await db.exec(require('node:fs').readFileSync('supabase/diagnostics/size_grid_transfer_preflight.sql','utf8'))).flatMap(r=>r.rows??[]).find(r=>r.size_grid_preflight).size_grid_preflight;
  assert.equal(beforeMigration.profile_column_exists,false);assert(beforeMigration.products.every(row=>!Object.hasOwn(row,'size_profile')));assert.deepEqual(await rows(),before);
  // The actual release starts without the column. Adding it must not invalidate
  // the protected-field hashes captured before migration.
  plan=prepare({products:beforeMigration.products.map(row=>({...row,size_profile:null}))});
  await db.exec('create role anon; create role authenticated; create role service_role');
  await db.exec(require('node:fs').readFileSync('supabase/migrations/20261108220243_size_measurements_ai.sql','utf8'));
  await db.exec(prepareSql(plan));assert((await rows()).every(row=>row.size_profile));
  await db.exec(prepareRollbackSql(plan));after=await rows();
  for(let i=0;i<2;i++){
    assert.equal(after[i].size_profile,null);assert.equal(after[i].revision,3);
    for(const key of Object.keys(before[i]).filter(k=>!['revision','updated_at'].includes(k)))assert.deepEqual(after[i][key],before[i][key],key);
  }
  console.log('PASS prepared SQL in memory: ID-only grid updates, original fields retained, stale revision/missing/duplicate/unknown grid fail closed, entire transaction rolls back; no source cards cloned');
  console.log('PASS read-only diagnostic and rollback: photo/example hashes only, former NULL and nonempty grids restored exactly, monotonic revisions, later edits stop both restores, photo changes stop transfer');
  console.log('PASS production-shaped sequence in memory: missing column → full additive migration → fingerprint-guarded transfer → exact NULL rollback; original fields retained');
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
