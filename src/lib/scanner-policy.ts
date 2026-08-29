export const SCANNER_INPUT_POLICY = {
  minBarcodeLength: 8,
  maxAverageIntervalMs: 50,
  maxTotalDurationMs: 1_500,
} as const;

export type InputMetadata = {
  durationMs: number;
  wasPaste: boolean;
};

export function isScannerInput(barcode: string, metadata: InputMetadata) {
  const length = barcode.length;
  const averageIntervalMs = length > 1 ? metadata.durationMs / (length - 1) : Number.POSITIVE_INFINITY;

  return !metadata.wasPaste
    && length >= SCANNER_INPUT_POLICY.minBarcodeLength
    && metadata.durationMs >= 0
    && metadata.durationMs <= SCANNER_INPUT_POLICY.maxTotalDurationMs
    && averageIntervalMs <= SCANNER_INPUT_POLICY.maxAverageIntervalMs;
}
