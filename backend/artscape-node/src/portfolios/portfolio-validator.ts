import Decimal from 'decimal.js';
import { artPositionInputSchema } from '../schemas/contracts';
import type { ArtPosition, ImportIssue } from '../types';

export interface PortfolioValidationResult {
  valid: boolean;
  issues: ImportIssue[];
  totalNominalValue: string;
}

export function validatePortfolioPositions(
  positions: ArtPosition[]
): PortfolioValidationResult {
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  let total = new Decimal(0);

  for (const position of positions) {
    const parsed = artPositionInputSchema.safeParse({
      artworkName: position.artworkName,
      artistName: position.artistName,
      category: position.category,
      nominalValue: position.nominalValue,
      baseValue: position.baseValue,
      liquidityLevel: position.liquidityLevel,
      liquidityDiscount: position.liquidityDiscount,
      transactionCostRate: position.transactionCostRate,
      artistExpectedReturn: position.artistExpectedReturn,
      dataCompleteness: position.dataCompleteness,
      currency: position.currency,
      dataSource: position.dataSource,
      dataDate: position.dataDate,
    });
    if (!parsed.success) {
      parsed.error.issues.forEach((error) => {
        issues.push({
          row: position.sourceRow,
          field: error.path.join('.'),
          code: 'INVALID_POSITION',
          severity: 'error',
          message: error.message,
        });
      });
      continue;
    }
    const fingerprint = `${position.artworkName}\u0000${position.artistName}`.toLowerCase();
    if (seen.has(fingerprint)) {
      issues.push({
        row: position.sourceRow,
        code: 'DUPLICATE_POSITION',
        severity: 'error',
        message: `Duplicate artwork/artist row: ${position.artworkName} / ${position.artistName}`,
      });
    }
    seen.add(fingerprint);
    total = total.plus(position.nominalValue);
  }

  if (total.lte(0)) {
    issues.push({
      code: 'NON_POSITIVE_TOTAL',
      severity: 'error',
      message: 'Portfolio total nominal value must be positive.',
    });
  }
  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    totalNominalValue: total.toFixed(2),
  };
}
