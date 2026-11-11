import type { SizeProduct } from "./sizes";

export type DetailedFit = "closer" | "regular" | "relaxed";
export type GarmentMeasures = {
  shoulders?: number; chest?: number; halfWaist?: number; length?: number; sleeve?: number;
};
export type DetailedSizeInput = {
  height: number; weight: number; fit: DetailedFit;
  lengthPreference: "standard" | "cropped";
  reference?: GarmentMeasures;
  measurementSubject?: "garment" | "body";
};
export type SizeVariant = { id: string; name: string; aliases?: string[] };
export type MeasureRow = {
  tag: string; measures: Partial<Record<keyof GarmentMeasures, [number, number]>>;
  estimated: boolean; relaxedWaist?: number; stretchedWaist?: number;
};
export type ReviewedSizeRule = {
  id: string; height: number; weight: number; fit: DetailedFit;
  lengthPreference: "standard" | "cropped";
  colors: string[]; reference: GarmentMeasures;
  size: string | null; manual: boolean; reason?: string;
};
export type DetailedSizeDefinition = {
  id: string; key: string; name: string; kind: "top" | "pants";
  variants: SizeVariant[]; sizes: string[]; unavailableSizes: string[];
  stretch: "none" | "low" | "moderate";
  buttoned: boolean; rows: MeasureRow[]; rules: ReviewedSizeRule[];
  checkWaistBeforeShipping: boolean;
  sharedSizeAcrossColors?: boolean;
  acceptedEstimatedGrading?: boolean;
};
export type SizeCalibration = { version: number; products: DetailedSizeDefinition[] };
export type DetailedSizeProduct = SizeProduct & {
  stock_details?: { colors?: { name: string; sizes?: string[] | null }[] };
};
export type VariantSizeResult = {
  colorId: string; colorName: string; size: string | null;
  basis: "owner" | "measurements" | "estimate" | "legacy" | "clarification";
  message: string; checks: string[]; requiresCheck: boolean;
};
