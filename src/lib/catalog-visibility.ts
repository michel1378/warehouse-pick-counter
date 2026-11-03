import type { SizeProduct } from "@/lib/sizes";

export type CatalogSizeProduct = SizeProduct & {
  show_in_availability: boolean;
  show_in_sizes: boolean;
};
