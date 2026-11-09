// Read-only preparation. Resolves existing IDs from an authenticated catalog export.
// No database/client connection, inserts, updates or deployment commands exist here.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
  return mod.exports;
}
const normalize = name => String(name).normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const testSeedIds = new Set(['e5f81908-0a6a-4514-af98-54770af6d601','e5f81908-0a6a-4514-af98-54770af6d603']);
function prepare(catalog) {
  const products = Array.isArray(catalog) ? catalog : catalog.products;
  if (!Array.isArray(products)) throw new Error('Expected a products array from /api/sizes');
  const alpaca = JSON.parse(fs.readFileSync(path.join(root,'data/size-grids/alpaca-buttons-striped.json'),'utf8'));
  const { hugeTrousersProfile, sizeProfileSchema } = load('src/lib/size-profile.ts');
  const alpacaProfile = require('./lib/alpaca-size-profile.cjs')({sizeProfileSchema,...load('src/lib/color-size-grids.ts')});
  return {
    source: 'Authenticated existing-site catalog export; no test IDs are substituted',
    readOnly: true, mutationsPerformed: false, createProducts: false,
    cards: ['Брюки Огромнейшие',alpaca.productName].map(name => {
      const matches = products.filter(p => normalize(p.name) === normalize(name));
      if (matches.length !== 1) return { name, status: matches.length ? 'ambiguous' : 'not_found', matches: matches.length, updatesAllowed: false };
      const card = matches[0];
      if (testSeedIds.has(card.id)) return { name, status:'test_seed_id_not_allowed',updatesAllowed:false };
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(card.id || '') || !Number.isInteger(card.revision) || card.revision < 1)
        return { name, status:'invalid_identity_or_revision',updatesAllowed:false };
      const preserved = {id:card.id,name:card.name,examples:card.examples,active:card.active,show_in_sizes:card.show_in_sizes,
        show_in_availability:card.show_in_availability,photo_count:card.photo_count,sizes:card.sizes};
      const base = { name, id:card.id, expectedRevision:card.revision, expectedName:card.name,
        preserveFields:['id','name','photo','photos','photo_count','examples','sizes','active','show_in_sizes','show_in_availability'],
        existingFieldsFingerprint:hash(preserved), exampleCount:card.example_count??card.examples?.length, photoCount:card.photo_count,
        ...(/^[0-9a-f]{32}$/.test(card.protected_fields_md5??'') ? {expectedProtectedFieldsMd5:card.protected_fields_md5} : {}),
        photoPolicy:'Never include photo/photos fields in a grid patch; keep current columns in place', createProducts:false, updatesAllowed:false };
      const isAlpaca = name === alpaca.productName;
      const preset = isAlpaca ? alpacaProfile : hugeTrousersProfile();
      const profileIncluded = Object.hasOwn(card,'size_profile');
      const alreadyMatches = profileIncluded && require('node:util').isDeepStrictEqual(card.size_profile,preset);
      return { ...base, status:alreadyMatches ? 'existing_card_grid_already_matches' : 'identity_resolved_review_only',
        currentProfileIncluded:profileIncluded, currentProfilePresent:profileIncluded ? !!card.size_profile : 'unknown_export_field_missing',
        ...(profileIncluded ? {currentProfileFingerprint:hash(card.size_profile),expectedProfile:card.size_profile} : {}),
        ...(isAlpaca ? {gridFile:'data/size-grids/alpaca-buttons-striped.json', logicalProductCount:1, colorCount:2} : {}),
        ...(alreadyMatches ? {} : {set:{size_profile:preset}}),sizingAlgorithmChanged:false };
    })
  };
}
module.exports = { prepare, load };
if (require.main === module) {
  try {
    const source = path.resolve(process.argv[2] || path.join(root,'source-catalog.json'));
    const target = path.resolve(process.argv[3] || path.join(root,'data/size-transfers/existing-cards-plan.local.json'));
    if (!fs.existsSync(source)) { console.log('BLOCKED: source-catalog.json is missing. Existing production IDs are not known; no changes made.'); process.exitCode=2; }
    else { const plan=prepare(JSON.parse(fs.readFileSync(source,'utf8').replace(/^\uFEFF/,'')));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify({readOnly:true,planFile:path.relative(root,target),cards:plan.cards.map(c=>({name:c.name,id:c.id,status:c.status,matches:c.matches})),mutationsPerformed:false})); }
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
