import type { SizeProduct } from "@/lib/sizes";

export type CatalogSizeProduct = SizeProduct & {
  stock_details?: { colors?: { name: string; sizes?: string[] | null }[] };
  show_in_availability: boolean;
  show_in_sizes: boolean;
};
