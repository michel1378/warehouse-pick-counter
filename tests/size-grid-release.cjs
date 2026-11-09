const assert=require('node:assert/strict');
const {prepareRelease,unwrap}=require('../scripts/prepare-size-grid-release.cjs');
// Metadata-only objects; no source cards are inserted into any database.
const snapshot={captured_at:'2026-11-09T00:00:00Z',profile_column_exists:true,profile_column_type:'jsonb',limits_table_exists:false,limits_function_exists:false,products:[
  {id:'7474f167-d6eb-46b6-82be-f07f2275b18f',name:'Брюки Огромнейшие',revision:8,size_profile:null,protected_fields_md5:'a'.repeat(32),example_count:12,photo_count:2},
  {id:'a92d78d6-90c1-4938-8d14-f01859925511',name:'Лонгслив Альпака пуговицы (в полоску)',revision:2,size_profile:{legacy:'existing value'},protected_fields_md5:'b'.repeat(32),example_count:2,photo_count:2},
]};
const original=structuredClone(snapshot),release=prepareRelease(snapshot);assert.deepEqual(snapshot,original);
assert.equal(release.report.changes[0].before,null);assert.deepEqual(release.report.changes[1].before,{legacy:'existing value'});
assert.match(release.rollback,/existing value/);assert.match(release.forward,/original.revision <> 8/);assert.match(release.rollback,/original.revision <> 9/);
assert.equal(release.report.changes[1].exampleCount,2);
const dark=release.report.changes[1].after.colorGrids.colors.find(c=>c.key==='dark');assert.deepEqual(dark.rows.filter(r=>r.source==='calculated').map(r=>r.size),['2XL','3XL']);
assert.deepEqual(unwrap([{size_grid_preflight:JSON.stringify(snapshot)}]),snapshot);
const omitted=structuredClone(snapshot);delete omitted.products[1].size_profile;assert.throws(()=>prepareRelease(omitted),/omitted/);
const noColumn=structuredClone(omitted);noColumn.profile_column_exists=false;noColumn.profile_column_type=null;delete noColumn.products[0].size_profile;
assert(prepareRelease(noColumn).report.changes.every(c=>c.oldState==='column_missing'&&c.before===null));
const wrongId=structuredClone(snapshot);wrongId.products[0].id='11111111-1111-4111-8111-111111111111';assert.throws(()=>prepareRelease(wrongId),/unexpected/);
const duplicate=structuredClone(snapshot);duplicate.products.push({...duplicate.products[1],id:'11111111-1111-4111-8111-111111111111'});assert.throws(()=>prepareRelease(duplicate),/ambiguous/);
const missingHash=structuredClone(snapshot);delete missingHash.products[0].protected_fields_md5;assert.throws(()=>prepareRelease(missingHash),/fingerprints/);
console.log('PASS release preparation: exact original IDs, full old/new grid diff and rollback, missing live data rejected, original snapshots unchanged, calculated dark rows preserved; files only, no deployment');
