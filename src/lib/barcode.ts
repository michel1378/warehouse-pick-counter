// Contract shared with SQL/C#; regression vectors in tests/fixtures/barcodes.json.
export const separators = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
export function normalizeBarcode(value: string) {
  let start = 0, end = value.length;
  while (start < end && separators.includes(value[start])) start++;
  while (end > start && separators.includes(value[end - 1])) end--;
  return value.slice(start, end).replace(/^p(?=[0-9]+$)/, "P");
}
export function validBarcode(value: string) { return /^(?:[0-9]{8,512}|P[0-9]{8,511})$/.test(value); }
