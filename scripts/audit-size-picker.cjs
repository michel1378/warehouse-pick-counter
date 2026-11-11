/* Read-only audit. Uses the real picker modules with a captured catalog. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
}).outputText, filename);
const { recommendAllColors, getDetailedSizeDefinition, reviewedSizeData } = require('../src/lib/detailed-sizes.ts');
const { recommendSize } = require('../src/lib/sizes.ts');
const folder = process.argv[2];
if (!folder) throw new Error('Pass the private audit folder');
const products = JSON.parse(fs.readFileSync(path.join(folder, 'products.json'), 'utf8'));
const charts = JSON.parse(fs.readFileSync(path.join(folder, 'chart-rows.json'), 'utf8'));
const baseProfiles = [[155,45],[160,50],[165,55],[165,73],[170,60],[172,74],[175,65],[175,70],[175,80],[178,80],[180,60],[183,78],[185,85],[188,90],[190,95],[180,105],[185,115],[195,120]];
const fits = ['closer','regular','relaxed'];
const legacyFits = {closer:'tight',regular:'regular',relaxed:'loose'};
const rows = [], employees = [], catalog = [], grids = [], stress = [];
let calls = 0, id = 0;
const selected = products.filter(p => p.active && p.show_in_sizes && p.sizes.length && p.photo_count > 0 && p.examples.length);
function run(p,h,w,ref={}) {
  calls += 3;
  return Object.fromEntries(fits.map(fit=>[fit,recommendAllColors(p,{height:h,weight:w,fit,lengthPreference:'standard',reference:ref,measurementSubject:'garment'})]));
}
function gridFor(p) {
  const d=getDetailedSizeDefinition(p.id);
  if(d) return d.rows;
  return (charts[p.id]?.rows??[]).map(([tag,shoulders,chest,length,sleeve])=>({tag,measures:{shoulders:[shoulders,shoulders],chest:[chest,chest],length:[length,length],sleeve:[sleeve,sleeve]},estimated:false}));
}
for (const [pi,p] of products.entries()) {
  const d=getDetailedSizeDefinition(p.id), grid=gridFor(p), enabled=selected.includes(p);
  let notes=charts[p.id]?.note??'';
  if(!p.sizes.length)notes='Аксессуар без размерного ряда; подбор роста/веса не требуется.';
  else if(!p.show_in_sizes) notes=notes||'Подбор выключен; проверены настройки каталога.';
  if(enabled&&!d)notes+=' На сайте используется прежний подбор; мерки в расчёт не входят.';
  catalog.push({name:p.name,id:p.id,enabled,availability:p.show_in_availability,sizes:p.sizes.join(' / '),examples:p.examples.length,calibrated:!!d,grid:grid.length?'Есть':'Нет',notes});
  for(const g of grid)grids.push({product:p.name,tag:g.tag,measures:g.measures,estimated:g.estimated,source:d?`Согласованный черновик, версия ${reviewedSizeData.version}`:'Картинка размерной сетки в Наличии',notes:charts[p.id]?.note??''});
  if(!enabled)continue;
  const profiles=baseProfiles.map(([h,w])=>({h,w,ref:{},label:'Без мерок'}));
  if(d?.key==='black-cold-gray-longsleeve')profiles.push({h:173,w:60,ref:{},label:'Исправленный случай'},{h:172,w:85,ref:{},label:'Сообщённая примерка'});
  if(d?.key==='huge-pants')profiles.push({h:176,w:66,ref:{},label:'Согласованное исключение'});
  if(d?.key==='best-distress-shirt')profiles.push({h:176,w:72,ref:{},label:'Согласованный случай'});
  const validGrid=grid.filter(g=>p.sizes.includes(g.tag));
  if(validGrid.length) {
    const a=validGrid[0],b=validGrid[Math.floor(validGrid.length/2)],c=validGrid.at(-1);
    const mid=r=>r?(r[0]+r[1])/2:undefined;
    if(d?.kind==='pants') {
      for(const [i,g]of [a,b,c].entries())if(g.measures.halfWaist)profiles.push({h:[165,175,185][i],w:[55,75,95][i],ref:{halfWaist:mid(g.measures.halfWaist)},label:'Полупояс любимой вещи'});
    } else {
      if(a.measures.shoulders)profiles.push({h:175,w:65,ref:{shoulders:mid(a.measures.shoulders)},label:'Только плечи'});
      if(b.measures.chest)profiles.push({h:175,w:80,ref:{chest:mid(b.measures.chest)},label:'Только грудь'});
      if(b.measures.shoulders&&b.measures.chest)profiles.push({h:183,w:78,ref:{shoulders:mid(b.measures.shoulders),chest:mid(b.measures.chest)},label:'Плечи и грудь'});
      if(c.measures.chest)profiles.push({h:185,w:100,ref:{chest:mid(c.measures.chest)},label:'Большая грудь по сетке'});
    }
  }
  let same=0,unknown=0,smaller=0;
  for(const profile of profiles) {
    const result=run(p,profile.h,profile.w,profile.ref);
    for(const v of result.regular) {
      const answer=Object.fromEntries(fits.map(f=>[f,result[f].find(r=>r.colorId===v.colorId)]));
      const sizes=Object.fromEntries(fits.map(f=>[f,answer[f]?.size??'Уточнить']));
      const ownerSame=answer.regular?.basis==='owner'&&answer.relaxed?.basis==='owner';
      const comments=[];
      if(sizes.regular===sizes.relaxed&&sizes.regular!=='Уточнить'){same++;comments.push(ownerSame?'Одинаковый размер ранее согласован для обеих посадок':'Свободнее не меняет размер; проверить');}
      if(fits.some(f=>!answer[f]?.size)){unknown++;comments.push('Есть посадка без ответа');}
      if(p.sizes.indexOf(sizes.relaxed)>=0&&p.sizes.indexOf(sizes.regular)>=0&&p.sizes.indexOf(sizes.relaxed)<p.sizes.indexOf(sizes.regular)){smaller++;comments.push('Свободнее даёт меньшую бирку');}
      if(!d&&Object.keys(profile.ref).length)comments.push('Прежний подбор не использует эти мерки');
      const checks=[...new Set(fits.flatMap(f=>answer[f]?.checks??[]))];
      comments.push(...checks);
      const correction=d?.key==='best-distress-shirt'&&profile.h===175&&profile.w===80&&!Object.keys(profile.ref).length?'2XL':'';
      if(correction)comments.unshift('Поправка владельца: в размер 2XL');
      if(d?.key==='huge-pants'&&profile.h===165&&profile.w===73)comments.unshift('Владелец предложил 2XL; пока не подтверждено');
      rows.push({id:++id,product:p.name,productId:p.id,color:v.colorName==='Размер'?'':v.colorName,h:profile.h,w:profile.w,ref:profile.ref,...sizes,ownerCloser:'',ownerRegular:correction,ownerRelaxed:'',label:profile.label,notes:[...new Set(comments)].join(' / '),basis:fits.map(f=>`${f}: ${answer[f]?.basis??'none'}`).join('; '),raw:answer});
    }
    const e=fits.map(f=>recommendSize(p,profile.h,profile.w,legacyFits[f]));
    employees.push({product:p.name,h:profile.h,w:profile.w,closer:e[0].size??'Уточнить',regular:e[1].size??'Уточнить',relaxed:e[2].size??'Уточнить',notes:[...new Set(e.filter(x=>x.kind==='uncertain').map(x=>x.message))].join(' / ')});
  }
  const weightDrops=[];let probes=0;
  for(let h=155;h<=195;h+=5)for(let w=45;w<=115;w+=5){
    const a=run(p,h,w),b=run(p,h,w+5);probes++;
    for(const av of a.regular){const bv=b.regular.find(x=>x.colorId===av.colorId);if(av.size&&bv?.size&&p.sizes.indexOf(bv.size)<p.sizes.indexOf(av.size))weightDrops.push({h,w,at:av.size,next:bv.size,color:av.colorName});}
  }
  stress.push({product:p.name,profiles:profiles.length,answerRows:rows.filter(x=>x.productId===p.id).length,same,unknown,smaller,probes,weightDrops:weightDrops.length,dropExamples:weightDrops.slice(0,4)});
}
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:path.join(__dirname,'..'),encoding:'utf8'}).trim();
const out={date:new Date().toISOString(),commit,sourceVersion:reviewedSizeData.version,productCount:products.length,pickerProducts:selected.length,calls,rows,employeeMode:"same-detailed-picker-as-admin",legacyEmployees:employees,catalog,grids,stress};
fs.writeFileSync(path.join(folder,'audit.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({products:products.length,pickerProducts:selected.length,profiles:stress.reduce((s,x)=>s+x.profiles,0),answerRows:rows.length,calls,summary:stress.map(({product,profiles,answerRows,same,unknown,smaller,weightDrops,dropExamples})=>({product,profiles,answerRows,same,unknown,smaller,weightDrops,dropExamples}))}));
