import type { ColorSizeResult } from "@/lib/color-size-grids";

export function ColorSizeAnswers({ colors }: { colors: Pick<ColorSizeResult, "key" | "name" | "size" | "approximate">[] }) {
  return <div className="size-color-results">
    {colors.map(color => <p key={color.key} className="size-color-result"><span className="size-color-name">{color.name} — </span><strong className="size-result-value">{color.size && color.approximate ? "≈ " : ""}{color.size ?? "—"}</strong></p>)}
  </div>;
}
