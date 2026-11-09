// Review-only package. Reads local snapshots, writes SQL/diff files; never executes SQL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepare}=require('./prepare-existing-size-transfer.cjs');
const {prepareSql,prepareRollbackSql}=require('./prepare-size-grid-sql.cjs');
const targets={
  'Брюки Огромнейшие':'7474f167-d6eb-46b6-82be-f07f2275b18f',
  'Лонгслив Альпака пуговицы (в полоску)':'a92d78d6-90c1-4938-8d14-f01859925511',
};
function unwrap(value){
  for(let i=0;i<6;i++){
    if(typeof value==='string'){value=JSON.parse(value);continue;}
    if(Array.isArray(value)&&value.length===1&&value[0]?.size_grid_preflight){value=value[0].size_grid_preflight;continue;}
    if(value?.size_grid_preflight){value=value.size_grid_preflight;continue;}
    return value;
  }
  throw new Error('Unrecognized SQL result format');
}
function prepareRelease(snapshot){
  snapshot=unwrap(snapshot);
  if(!Number.isFinite(Date.parse(snapshot.captured_at))||typeof snapshot.profile_column_exists!=='boolean'||!Array.isArray(snapshot.products))
    throw new Error('Expected the complete read-only SQL preflight JSON, including schema and capture time.');
  if(snapshot.profile_column_exists&&snapshot.profile_column_type!=='jsonb')throw new Error('Unexpected size_profile column type. Inspect schema first.');
  const products=snapshot.products.map(card=>{
    if(!/^[0-9a-f]{32}$/.test(card.protected_fields_md5??''))throw new Error('Protected row fingerprints are missing. Use the supplied read-only query.');
    if(snapshot.profile_column_exists&&!Object.hasOwn(card,'size_profile'))throw new Error('Current grid omitted from snapshot; rollback cannot be prepared.');
    return snapshot.profile_column_exists?card:{...card,size_profile:null};
  });
  const plan=prepare({products});
  for(const card of plan.cards)if(card.id!==targets[card.name])throw new Error('Missing, ambiguous or unexpected existing card ID. No release SQL prepared.');
  const forward=prepareSql(plan),rollback=prepareRollbackSql(plan);
  const changes=plan.cards.map(card=>({id:card.id,name:card.expectedName,revision:card.expectedRevision,
    oldState:snapshot.profile_column_exists?'column_exists':'column_missing',before:card.expectedProfile,
    after:card.set?.size_profile??card.expectedProfile,willUpdate:!!card.set,
    photoCount:card.photoCount,exampleCount:card.exampleCount,protectedFieldsMd5:card.expectedProtectedFieldsMd5}));
  return {forward,rollback,report:{preparedAt:new Date().toISOString(),snapshotCapturedAt:snapshot.captured_at,
    source:'read-only database snapshot supplied locally; guards recheck at execution',
    schemaMigrationNeeded:!snapshot.profile_column_exists||!snapshot.limits_table_exists||!snapshot.limits_function_exists,
    productionMutations:false,published:false,changes}};
}
module.exports={unwrap,prepareRelease};
if(require.main===module){try{
  const source=path.resolve(process.argv[2]||'source-size-preflight.json');
  if(!fs.existsSync(source))throw new Error('BLOCKED: source-size-preflight.json is missing. Current production grids and exact rollback values are unknown. Existing SQL remains a guarded draft; nothing executed.');
  const sourceBytes=fs.readFileSync(source),raw=sourceBytes.toString('utf8').replace(/^\uFEFF/,''),result=prepareRelease(JSON.parse(raw));
  result.report.sourceFile=path.relative(process.cwd(),source);
  result.report.snapshotSha256=crypto.createHash('sha256').update(sourceBytes).digest('hex');
  result.report.forwardSqlSha256=crypto.createHash('sha256').update(result.forward).digest('hex');
  result.report.rollbackSqlSha256=crypto.createHash('sha256').update(result.rollback).digest('hex');
  fs.mkdirSync('data/size-transfers',{recursive:true});
  fs.writeFileSync('data/size-transfers/existing-card-grids.sql',result.forward);
  fs.writeFileSync('data/size-transfers/existing-card-grids.rollback.sql',result.rollback);
  fs.writeFileSync('data/size-transfers/release-review.local.json',JSON.stringify(result.report,null,2)+'\n');
  console.log(JSON.stringify({preparedOnly:true,executed:false,report:'data/size-transfers/release-review.local.json',
    cards:result.report.changes.map(c=>({id:c.id,revision:c.revision,willUpdate:c.willUpdate})),rollbackPrepared:true}));
}catch(error){console.error(error.message);process.exitCode=1;}}
