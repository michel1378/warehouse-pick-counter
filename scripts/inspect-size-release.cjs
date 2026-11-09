// Read-only HTTP inspection. No credentials, authenticated cookies, POSTs or deployments.
const fs=require('node:fs'),crypto=require('node:crypto');
const base='https://warehouse-pick-counter.vercel.app';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
(async()=>{
  const observations=[];
  for(const route of ['/api/sizes','/admin/sizes','/admin/login']){
    const response=await fetch(base+route,{redirect:'manual',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
    const html=await response.text(),decoded=html.replace(/\\"/g,'"');
    const scripts=[...html.matchAll(/src="([^"\s]+\.js[^"\s]*)"/g)].map(m=>m[1].replace(/&amp;/g,'&')).sort();
    observations.push({route,status:response.status,location:response.headers.get('location'),serverDate:response.headers.get('date'),
      deploymentIds:[...new Set(html.match(/dpl_[A-Za-z0-9]+/g)||[])],
      nextBuildIds:[...new Set([...decoded.matchAll(/"(?:b|buildId)"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map(m=>m[1]))],
      publicScriptPaths:scripts,publicScriptsFingerprint:scripts.length?hash(scripts.join('\n')):null});
  }
  const result={inspectedAt:new Date().toISOString(),base,method:'public GET only',authenticatedCatalogRead:false,
    deploymentCommitVerified:false,productionMutations:false,observations};
  fs.mkdirSync('data/size-transfers',{recursive:true});
  fs.writeFileSync('data/size-transfers/site-inspection.local.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
