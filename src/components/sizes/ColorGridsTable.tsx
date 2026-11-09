import { spreadText, type ColorGrids } from "@/lib/color-size-grids";

export function ColorGridsTable({grids}:{grids:ColorGrids}) {
  return <><p className="size-hint">Все значения в см. {grids.chestDefinition}. Диапазоны и отдельные замеры сохранены без усреднения.</p>
    {grids.colors.map(color=><section key={color.key}><h4>{color.name}</h4><div className="table-wrap"><table><thead><tr>
      <th>Размер</th><th>Плечи</th><th>Грудь</th><th>Длина</th><th>Рукав</th><th>Источник</th>
    </tr></thead><tbody>{color.rows.map(row=><tr key={row.size} className={row.source==='calculated'?'size-calculated-row':''}>
      <th>{row.size}</th>{([row.shoulders,row.chest,row.length,row.sleeve]).map((value,index)=><td key={index}>{spreadText(value)}</td>)}
      <td>{row.source==='calculated'?'Расчётные — не измерены':'Замерено'}</td>
    </tr>)}</tbody></table></div></section>)}
  </>;
}
