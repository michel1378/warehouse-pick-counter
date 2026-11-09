import type { ColorSizeResult } from "@/lib/color-size-grids";

export function ColorSizeAnswers({ colors }: { colors: Pick<ColorSizeResult, "key" | "name" | "size">[] }) {
  return <div className="size-color-results">
    {colors.map(color => <p key={color.key} className="size-color-result">{color.name} — {color.size ?? "—"}</p>)}
  </div>;
}
