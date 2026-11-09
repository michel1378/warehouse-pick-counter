import type { ColorSizeResult } from "@/lib/color-size-grids";

export function ColorSizeAnswers({ colors }: { colors: (Pick<ColorSizeResult, "key" | "name" | "size" | "approximate"> & {clarification?:string|null})[] }) {
  return <div className="size-color-results">
    {colors.map(color => <p key={color.key} className="size-color-result"><span className="size-color-name">{color.name} — </span>{color.size ? <strong className="size-result-value">{color.approximate ? "≈ " : ""}{color.size}</strong> : <span className="size-clarification">{color.clarification??"Уточните замеры"}</span>}</p>)}
  </div>;
}
