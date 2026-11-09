"use client";
import {useEffect,useState} from "react";
import {parseSpread,spreadText,type ColorGrids,type Spread} from "@/lib/color-size-grids";
import {ALPACA_PRODUCT_ID,appendAlpacaLightBeige,hasAlpacaLightBeige} from "@/lib/size-color-presets";
const measurements=[['shoulders','Плечи'],['chest','Грудь'],['length','Длина'],['sleeve','Рукав']] as const;
function MeasureInput({value,label,onChange}:{value:Spread;label:string;onChange:(value:Spread)=>void}) {
  const [text,setText]=useState(value===0?"":spreadText(value)); const [invalid,setInvalid]=useState(false);
  useEffect(()=>{setText(value===0?"":spreadText(value));},[value]);
  return <input aria-label={label} aria-invalid={invalid} required value={text} maxLength={60} onChange={event=>{
    setText(event.target.value);
    try{const parsed=parseSpread(event.target.value);event.currentTarget.setCustomValidity('');setInvalid(false);onChange(parsed);}
    catch{event.currentTarget.setCustomValidity('Укажите число, диапазон 48–50 или замеры 42/43/44.');setInvalid(true);}
  }}/>;
}
export function ColorGridEditor({grids,onChange,productId}:{grids:ColorGrids;onChange:(grids:ColorGrids)=>void;productId?:string}) {
  function addColor() {
    let number=grids.colors.length+1;
    while(grids.colors.some(color=>color.key===`color_${number}`))number++;
    const name=`Новый цвет ${number}`;
    onChange({...grids,colors:[...grids.colors,{key:`color_${number}`,name,prefix:name,
      rows:grids.colors[0].rows.map(row=>({size:row.size,shoulders:0,chest:0,length:0,sleeve:0,source:'measured' as const}))}]});
  }
  return <><p className="size-hint">Одна карточка, отдельная сетка каждого цвета. Форматы: 48; 48–50; 42/43/44. Расчётные строки не подтверждают размер к отправке.</p>
    {grids.colors.map((color,colorIndex)=><section key={color.key}><h4>{color.name}</h4>
      {color.key.startsWith('color_')&&<label>Название цвета<input required maxLength={80} value={color.name} onChange={event=>onChange({...grids,colors:grids.colors.map((item,i)=>i===colorIndex?{...item,name:event.target.value,prefix:item.prefix===item.name?event.target.value:item.prefix}:item)})}/></label>}
      <div className="table-wrap"><table><thead><tr>
      <th>Размер</th>{measurements.map(([key,label])=><th key={key}>{label}, см</th>)}<th>Источник</th>
    </tr></thead><tbody>{color.rows.map((row,rowIndex)=><tr key={row.size}><th>{row.size}</th>
      {measurements.map(([key,label])=><td key={key}><MeasureInput label={`${color.name}: ${label}, ${row.size}`} value={row[key]} onChange={value=>onChange({...grids,colors:grids.colors.map((item,i)=>i===colorIndex?{...item,rows:item.rows.map((r,j)=>j===rowIndex?{...r,[key]:value}:r)}:item)})}/></td>)}
      <td><select aria-label={`${color.name}: источник, ${row.size}`} value={row.source} onChange={event=>onChange({...grids,colors:grids.colors.map((item,i)=>i===colorIndex?{...item,rows:item.rows.map((r,j)=>j===rowIndex?{...r,source:event.target.value as 'measured'|'calculated'}:r)}:item)})}>
        <option value="measured">Замерено</option><option value="calculated">Расчётно — проверить на складе</option>
      </select></td></tr>)}</tbody></table></div></section>)}
    <div className="size-toolbar"><button type="button" className="secondary" disabled={grids.colors.length>=6} onClick={addColor}>+ Добавить цвет</button>
      {productId===ALPACA_PRODUCT_ID&&<button type="button" className="secondary" disabled={grids.colors.length>=6||hasAlpacaLightBeige(grids)} onClick={()=>onChange(appendAlpacaLightBeige(grids,productId))}>
        {hasAlpacaLightBeige(grids)?'Светло-бежевый уже добавлен':'Добавить сетку «Светло-бежевый»'}
      </button>}
    </div><p className="size-hint">Новый цвет сохранится в этой карточке после нажатия «Сохранить вещь».</p>
  </>;
}
