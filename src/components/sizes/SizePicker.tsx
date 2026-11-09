import type { CatalogSizeProduct as SizeProduct } from "@/lib/catalog-visibility";
import { SizeAiPicker } from "./SizeAiPicker";

export function SizePicker({ product }: { product: SizeProduct }) {
  return <SizeAiPicker product={product} />;
}
