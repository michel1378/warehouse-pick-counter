import { colorSizeLine, type ColorSizeResult } from "@/lib/color-size-grids";

export function ColorSizeAnswers({ colors }: { colors: ColorSizeResult[] }) {
  return <>
    <span className="size-answer-label">Предварительно по цветам</span>
    <div className="size-color-results">
      {colors.map(color => <p key={color.key} className="size-color-result">{colorSizeLine(color)}</p>)}
    </div>
    <details className="size-evidence"><summary>Обоснование и длина</summary>
      {colors.map(color => <div key={color.key}><p><b>{color.name}</b>: {color.explanation}</p><p className="size-hint">{color.lengthText}</p></div>)}
    </details>
  </>;
}
