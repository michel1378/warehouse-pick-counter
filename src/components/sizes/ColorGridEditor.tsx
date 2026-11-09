"use client";
import {useEffect,useState} from "react";
import {parseSpread,spreadText,type ColorGrids,type Spread} from "@/lib/color-size-grids";
const measurements=[['shoulders','Плечи'],['chest','Грудь'],['length','Длина'],['sleeve','Рукав']] as const;
function MeasureInput({value,label,onChange}:{value:Spread;label:string;onChange:(value:Spread)=>void}) {
  const [text,setText]=useState(spreadText(value)); const [invalid,setInvalid]=useState(false);
  useEffect(()=>{setText(spreadText(value));},[value]);
  return <input aria-label={label} aria-invalid={invalid} required value={text} maxLength={60} onChange={event=>{
    setText(event.target.value);
    try{const parsed=parseSpread(event.target.value);event.currentTarget.setCustomValidity('');setInvalid(false);onChange(parsed);}
    catch{event.currentTarget.setCustomValidity('Укажите число, диапазон 48–50 или замеры 42/43/44.');setInvalid(true);}
  }}/>;
}
export function ColorGridEditor({grids,onChange}:{grids:ColorGrids;onChange:(grids:ColorGrids)=>void}) {
  return <><p className="size-hint">Одна карточка, отдельная сетка каждого цвета. Форматы: 48; 48–50; 42/43/44. Расчётные строки не подтверждают размер к отправке.</p>
    {grids.colors.map((color,colorIndex)=><section key={color.key}><h4>{color.name}</h4><div className="table-wrap"><table><thead><tr>
      <th>Размер</th>{measurements.map(([key,label])=><th key={key}>{label}, см</th>)}<th>Источник</th>
    </tr></thead><tbody>{color.rows.map((row,rowIndex)=><tr key={row.size}><th>{row.size}</th>
      {measurements.map(([key,label])=><td key={key}><MeasureInput label={`${color.name}: ${label}, ${row.size}`} value={row[key]} onChange={value=>onChange({...grids,colors:grids.colors.map((item,i)=>i===colorIndex?{...item,rows:item.rows.map((r,j)=>j===rowIndex?{...r,[key]:value}:r)}:item)})}/></td>)}
      <td><select aria-label={`${color.name}: источник, ${row.size}`} value={row.source} onChange={event=>onChange({...grids,colors:grids.colors.map((item,i)=>i===colorIndex?{...item,rows:item.rows.map((r,j)=>j===rowIndex?{...r,source:event.target.value as 'measured'|'calculated'}:r)}:item)})}>
        <option value="measured">Замерено</option><option value="calculated">Расчётно — проверить на складе</option>
      </select></td></tr>)}</tbody></table></div></section>)}
  </>;
}
