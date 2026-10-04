/** Product-specific recommendations. No global size chart or automatic fit offset. */
export const FITS = ["tight", "regular", "loose"] as const;
export type Fit = typeof FITS[number];
export const FIT_LABELS: Record<Fit, string> = {
  tight: "В обтяг", regular: "Размер в размер", loose: "Немного оверсайз",
};
export type SizeExample = { height: number; weight: number; fit: Fit; size: string };
export type SizeProduct = {
  id: string; name: string; note: string; sizes: string[]; examples: SizeExample[];
  active: boolean; revision: number; updated_at: string; photo_count: number;
};
export type SizeResult = {
  size: string | null; kind: "exact" | "estimated" | "uncertain";
  message: string; evidence: SizeExample[];
};
export function normalizeSize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/^XXL$/, "2XL")
    .replace(/^XXXL$/, "3XL").replace(/^XXXXL$/, "4XL").replace(/^XXXXXL$/, "5XL");
}

/** Regularized ordinal regression trained anew on this product's complete table. */
export function recommendSize(product: Pick<SizeProduct, "sizes" | "examples">, height: number, weight: number, fit: Fit): SizeResult {
  const unsure = (message: string): SizeResult => ({size:null,kind:"uncertain",message,evidence:[]});
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height<100 || height>230 || weight<25 || weight>250) return unsure("Проверьте рост (100–230 см) и вес (25–250 кг).");
  const rows = [...new Map(product.examples.filter(e=>product.sizes.includes(e.size) && FITS.includes(e.fit) && Number.isFinite(e.height) && Number.isFinite(e.weight)).map(e=>[JSON.stringify([e.height,e.weight,e.fit,e.size]),e])).values()].sort((a,b)=>a.height-b.height || a.weight-b.weight || a.fit.localeCompare(b.fit) || product.sizes.indexOf(a.size)-product.sizes.indexOf(b.size));
  const same=rows.filter(e=>e.fit===fit);
  if(!same.length) return unsure("Для выбранной посадки нет примеров. Уточните у владельца.");
  const exact=same.filter(e=>e.height===height && e.weight===weight);
  if(exact.length && new Set(exact.map(e=>e.size)).size===1) return {size:exact[0].size,kind:"exact",message:"Такие параметры и посадка есть в таблице владельца.",evidence:exact};
  const hs=same.map(e=>e.height), ws=same.map(e=>e.weight);
  if(height<Math.min(...hs)-10 || height>Math.max(...hs)+10 || weight<Math.min(...ws)-15 || weight>Math.max(...ws)+15) return unsure("Параметры далеко за пределами примеров этой посадки. Уточните у владельца.");
  const mh=rows.reduce((s,e)=>s+e.height,0)/rows.length, mw=rows.reduce((s,e)=>s+e.weight,0)/rows.length;
  const sh=Math.max(5,Math.sqrt(rows.reduce((s,e)=>s+(e.height-mh)**2,0)/rows.length)), sw=Math.max(5,Math.sqrt(rows.reduce((s,e)=>s+(e.weight-mw)**2,0)/rows.length));
  const x=(h:number,w:number,f:Fit)=>[1,(h-mh)/sh,(w-mw)/sw,...FITS.map(v=>Number(v===f))];
  const n=6, m=Array.from({length:n},()=>Array(n+1).fill(0) as number[]);
  for(const e of rows) { const v=x(e.height,e.weight,e.fit), y=product.sizes.indexOf(e.size); for(let i=0;i<n;i++) { for(let j=0;j<n;j++) m[i][j]+=v[i]*v[j]; m[i][n]+=v[i]*y; } }
  // Penalize slopes and learned fit offsets; leave intercept unpenalized.
  for(let i=1;i<n;i++) m[i][i]+=0.25;
  for(let i=0;i<n;i++) { let pivot=i; for(let j=i+1;j<n;j++) if(Math.abs(m[j][i])>Math.abs(m[pivot][i])) pivot=j; [m[i],m[pivot]]=[m[pivot],m[i]]; const d=m[i][i]; for(let k=i;k<=n;k++) m[i][k]/=d; for(let j=0;j<n;j++) if(j!==i) { const f=m[j][i]; for(let k=i;k<=n;k++) m[j][k]-=f*m[i][k]; } }
  const predict=(h:number,w:number,f:Fit)=>x(h,w,f).reduce((s,v,i)=>s+v*m[i][n],0);
  const value=predict(height,weight,fit), index=Math.max(0,Math.min(product.sizes.length-1,Math.round(value)));
  const residual=Math.sqrt(rows.reduce((s,e)=>s+(predict(e.height,e.weight,e.fit)-product.sizes.indexOf(e.size))**2,0)/rows.length);
  const conflicts=rows.some((e,i)=>rows.slice(i+1).some(o=>e.height===o.height && e.weight===o.weight && e.fit===o.fit && e.size!==o.size));
  const reasons:string[]=[];
  if(same.length<6) reasons.push("мало примеров выбранной посадки");
  if(conflicts || residual>0.4) reasons.push("противоречия или заметные отклонения в таблице");
  if(Math.abs(value-Math.floor(value)-0.5)<0.2) reasons.push("граница размеров");
  if(height<Math.min(...hs) || height>Math.max(...hs) || weight<Math.min(...ws) || weight>Math.max(...ws)) reasons.push("выход за диапазон примеров");
  const evidence=[...same].sort((a,b)=>Math.hypot((a.height-height)/sh,(a.weight-weight)/sw)-Math.hypot((b.height-height)/sh,(b.weight-weight)/sw)).slice(0,6);
  return {size:product.sizes[index],kind:reasons.length?"uncertain":"estimated",message:(reasons.length?"Уточните у владельца: "+reasons.join("; ")+". ":"Прогноз по всей таблице вещи. ")+"Точность на реальных рекомендациях требует проверки.",evidence};
}
/** Exclude all duplicates of the tested measurements and fit to avoid leakage. */
export function evaluateSizeExamples(product: Pick<SizeProduct,"sizes"|"examples">) {
  return product.examples.map(example=>({example,result:recommendSize({...product,examples:product.examples.filter(e=>!(e.height===example.height && e.weight===example.weight && e.fit===example.fit))},example.height,example.weight,example.fit)}));
}

export function parseExampleRows(text: string): SizeExample[] {
  const rows = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (!rows.length) throw new Error("Вставьте строки таблицы.");
  const fitNames: Record<string, Fit> = { tight: "tight", regular: "regular", loose: "loose", "в обтяг": "tight", "размер в размер": "regular", "немного оверсайз": "loose" };
  return rows.flatMap((line, index) => {
    const cells = line.split(/\t|;/).map(cell => cell.trim());
    if (index === 0 && /^рост/i.test(cells[0])) return [];
    const [h, w, f, s] = cells;
    const height = Number(h?.replace(",", ".")), weight = Number(w?.replace(",", "."));
    const fit = fitNames[f?.toLowerCase()];
    if (cells.length !== 4 || !fit || !s || !Number.isFinite(height) || !Number.isFinite(weight) || height < 100 || height > 230 || weight < 25 || weight > 250)
      throw new Error(`Строка ${index + 1}: нужны рост, вес, посадка, размер. Разделитель — табуляция или точка с запятой.`);
    return [{ height, weight, fit, size: normalizeSize(s) }];
  });
}
