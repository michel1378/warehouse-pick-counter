import type { ColorGrids } from "@/lib/color-size-grids";

const ALPACA_ID="a92d78d6-90c1-4938-8d14-f01859925511";
export function colorFitRule(productId:string|undefined,color:{key:string;name:string}) {
  if(productId!==ALPACA_ID)return null;
  const name=color.name.normalize("NFC").toLocaleLowerCase("ru").replace(/ё/g,"е");
  const steps=color.key==="dark"||/темный/.test(name)&&!name.includes("светло")?0
    :["main","light_beige"].includes(color.key)||/основной|светло.бежев|светло.темн/.test(name)?1:null;
  return steps===null?null:{smallBySteps:steps,description:steps===0?"Не маломерит":"Маломерит на один размер"};
}
export function hasColorFitRules(productId:string|undefined){return productId===ALPACA_ID;}

/** Recompute from the original base, rather than incrementing the last result. */
export function applyColorFitRule(productId:string|undefined,color:ColorGrids["colors"][number],answer:{size:string|null;baseSize?:string|null;fitAdjustmentIncluded?:boolean},protectedBasis:boolean) {
  const rule=colorFitRule(productId,color);
  const base=answer.baseSize??answer.size;
  if(!rule||protectedBasis)return {size:answer.size,baseSize:base,fitAdjustmentIncluded:!!answer.fitAdjustmentIncluded,stepsApplied:0};
  if(!answer.size||!base)return {size:null,baseSize:base,fitAdjustmentIncluded:false,stepsApplied:0};
  const index=color.rows.findIndex(row=>row.size===base),row=index>=0?color.rows[index+rule.smallBySteps]:undefined;
  if(!row||row.source!=="measured")return {size:null,baseSize:base,fitAdjustmentIncluded:false,stepsApplied:0,clarification:"Уточните замеры этого цвета на складе"};
  if(answer.fitAdjustmentIncluded&&answer.size!==row.size)return {size:null,baseSize:base,fitAdjustmentIncluded:false,stepsApplied:0,clarification:"Уточните исходный размер без поправки"};
  return {size:row.size,baseSize:base,fitAdjustmentIncluded:true,stepsApplied:answer.fitAdjustmentIncluded?0:rule.smallBySteps};
}
