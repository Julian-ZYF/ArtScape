export interface NumericIntegrityResult {
  valid: boolean;
  unknownNumbers: string[];
}

const normalizeNumber = (value: string): string => {
  const number = Number(value.replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(number) ? String(number) : value;
};

export function validateNumericIntegrity(
  text: string,
  allowedValues: Array<string | number>
): NumericIntegrityResult {
  const allowed = new Set(allowedValues.map((value) => normalizeNumber(String(value))));
  const found = text.match(/-?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  const unknownNumbers = found.filter((value) => !allowed.has(normalizeNumber(value)));
  return { valid: unknownNumbers.length === 0, unknownNumbers };
}

