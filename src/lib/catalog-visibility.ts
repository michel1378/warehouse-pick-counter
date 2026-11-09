import type { SizeProduct } from "@/lib/sizes";
import type { SizeProfile } from "@/lib/size-profile";

export type CatalogSizeProduct = SizeProduct & {
  size_profile?: SizeProfile | null;
  show_in_availability: boolean;
  show_in_sizes: boolean;
};
