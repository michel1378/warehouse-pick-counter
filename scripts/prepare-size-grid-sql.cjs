// Generate a reviewable SQL file only. No database connection and no execution.
const fs=require('node:fs'),path=require('node:path');
const {prepare}=require('./prepare-existing-size-transfer.cjs');
const literal=value=>"'"+String(value).replace(/'/g,"''")+"'";
const protectedRow="to_jsonb(original)-array['size_profile','revision','updated_at']";
const jsonLiteral=value=>value==null?'null::jsonb':literal(JSON.stringify(value))+'::jsonb';
const protectedGuard=card=>card.expectedProtectedFieldsMd5 ? `
  if md5((${protectedRow})::text) is distinct from ${literal(card.expectedProtectedFieldsMd5)} then
    raise exception 'Protected fields changed since snapshot: ${card.id}';
  end if;` : '';
function prepareSql(plan) {
  if(plan.cards.length!==2||plan.cards.some(c=>!['identity_resolved_review_only','existing_card_grid_already_matches'].includes(c.status)))
    throw new Error('Both existing cards must be uniquely resolved; no SQL generated.');
  const statements=plan.cards.filter(c=>c.set).map(c=>{
    if(Object.keys(c.set).join(',')!=='size_profile') throw new Error('Only size_profile may be changed.');
    const target=literal(JSON.stringify(c.set.size_profile))+'::jsonb';
    const expected=c.currentProfileIncluded
      ? `original.size_profile is distinct from ${jsonLiteral(c.expectedProfile)}`
      : 'original.size_profile is not null';
    return `do $grid_transfer$
declare original public.size_products%rowtype; changed public.size_products%rowtype;
begin
  if (select count(*) from public.size_products where lower(regexp_replace(trim(name),'\\s+',' ','g')) = lower(${literal(c.expectedName)})) <> 1 then
    raise exception 'Missing or ambiguous source card: ${c.id}';
  end if;
  select * into strict original from public.size_products where id=${literal(c.id)}::uuid for update;
  if original.name is distinct from ${literal(c.expectedName)} or original.revision <> ${c.expectedRevision} then
    raise exception 'Card changed since export: ${c.id}. Refresh the catalog and regenerate this plan.';
  end if;${protectedGuard(c)}
  if original.size_profile is distinct from ${target} then
    if ${expected} then
      raise exception 'Existing grid differs from exported state: ${c.id}. Read and review current grid first.';
    end if;
    update public.size_products set size_profile=${target}, revision=revision+1, updated_at=now()
      where id=original.id and revision=original.revision returning * into strict changed;
    if changed.revision <> original.revision+1 or changed.size_profile is distinct from ${target} then
      raise exception 'Unexpected grid or revision after update: ${c.id}';
    end if;
    if (to_jsonb(changed)-array['size_profile','revision','updated_at']) is distinct from
       (to_jsonb(original)-array['size_profile','revision','updated_at']) then
      raise exception 'Protected card fields changed: ${c.id}';
    end if;
  end if;
end $grid_transfer$;`;
  });
  const readiness=plan.cards.some(c=>!c.currentProfileIncluded)
    ? '-- REVIEW DRAFT: current grids were omitted from the source export. Obtain the production preflight snapshot before release.\n'
    : '-- Grid values are pinned to the supplied snapshot; review it and the paired rollback before release.\n';
  return '-- PREPARED ONLY. Not applied. Review schema and current revisions before execution.\n'+readiness+'-- Updates only existing IDs; preserves every column except grid/revision/update timestamp.\n-- Any failed guard rolls back BOTH cards. No photos or examples are included here.\nbegin;\nset transaction isolation level serializable;\n'+statements.join('\n')+'\ncommit;\n';
}
function prepareRollbackSql(plan) {
  // Validate the same identities and patch scope as the forward transaction.
  prepareSql(plan);
  const cards=plan.cards.filter(c=>c.set);
  if(cards.some(c=>!c.currentProfileIncluded||c.expectedProfile===undefined))
    throw new Error('Rollback blocked: current production grids were not included in the snapshot. Do not assume NULL.');
  const blocks=cards.map(c=>`do $grid_restore$
declare original public.size_products%rowtype; changed public.size_products%rowtype;
begin
  select * into strict original from public.size_products where id=${literal(c.id)}::uuid for update;
  if original.name is distinct from ${literal(c.expectedName)} or original.revision <> ${c.expectedRevision+1}
     or original.size_profile is distinct from ${jsonLiteral(c.set.size_profile)} then
    raise exception 'Rollback stopped: card changed after grid transfer: ${c.id}';
  end if;${protectedGuard(c)}
  update public.size_products set size_profile=${jsonLiteral(c.expectedProfile)}, revision=revision+1, updated_at=now()
    where id=original.id and revision=original.revision returning * into strict changed;
  if changed.size_profile is distinct from ${jsonLiteral(c.expectedProfile)} or changed.revision <> original.revision+1
     or (to_jsonb(changed)-array['size_profile','revision','updated_at']) is distinct from (${protectedRow}) then
    raise exception 'Unexpected field changes during grid rollback: ${c.id}';
  end if;
end $grid_restore$;`);
  return '-- PREPARED ONLY. Restores exact prior grid values from the reviewed snapshot.\n-- Leaves photos/examples/flags intact. Versions increase; old revisions are never reused.\n-- Refuses to overwrite edits made after transfer. Schema additions stay in place.\nbegin;\nset transaction isolation level serializable;\n'+blocks.join('\n')+'\ncommit;\n';
}
module.exports={prepareSql,prepareRollbackSql};
if(require.main===module){
  try {
    if(fs.existsSync('source-size-preflight.json')||fs.existsSync('data/size-transfers/release-review.local.json'))
      throw new Error('A production snapshot/release package exists. Use scripts/prepare-size-grid-release.cjs to keep forward SQL and rollback paired.');
    const source=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'source-catalog.json'),'utf8').replace(/^\uFEFF/,''));
    const plan=prepare(source);
    const target=path.resolve(process.argv[3]||'data/size-transfers/existing-card-grids.sql');
    const sql=prepareSql(plan); fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,sql);
    console.log(JSON.stringify({preparedOnly:true,executed:false,file:path.relative(process.cwd(),target),cards:plan.cards.map(c=>c.id)}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
