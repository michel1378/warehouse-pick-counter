import data from "../../data/size-grids/alpaca-buttons-striped.json";
import { colorGridSchema, colorGridsSchema, type ColorGrids } from "@/lib/color-size-grids";

export const ALPACA_PRODUCT_ID = data.productId;
export function alpacaLightBeigeColor(): ColorGrids["colors"][number] {
  const source = data.colors.find(color => color.key === "light_beige");
  return colorGridSchema.parse({ ...source, prefix: "Светло-бежевый" });
}
export function hasAlpacaLightBeige(grids: ColorGrids): boolean {
  return grids.colors.some(color => color.key === "light_beige"
    || color.name.normalize("NFC").trim().toLocaleLowerCase("ru") === "светло-бежевый");
}
export function appendAlpacaLightBeige(grids: ColorGrids, productId: string): ColorGrids {
  if (productId !== ALPACA_PRODUCT_ID) throw new Error("Заготовка предназначена для существующей карточки Альпаки.");
  if (hasAlpacaLightBeige(grids)) return grids;
  return colorGridsSchema.parse({ ...grids, colors: [...grids.colors, alpacaLightBeigeColor()] });
}
