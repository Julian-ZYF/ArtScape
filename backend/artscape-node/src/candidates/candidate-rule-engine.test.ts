import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { samplePositions } from '../testing/fixtures';
import { generateCandidateAllocation, validateCandidate } from './candidate-rule-engine';

describe('candidate rule engine', () => {
  it('preserves total nominal value, position identity, and non-negative allocations', () => {
    const positions = samplePositions();
    const candidate = generateCandidateAllocation(positions, {
      maxArtistConcentration: '0.600000',
      maxArtistName: '艺术家甲',
      lowLiquidityRatio: '0.600000',
      completenessRatio: '1.000000',
      bearLossRate: '0.400000',
    });
    expect(candidate.validation).toEqual({
      valid: true,
      totalPreserved: true,
      nonNegative: true,
      violations: [],
    });
    expect(Decimal.sum(...candidate.positions.map((item) => item.nominalValue)).toFixed(2)).toBe(
      '1000.00'
    );
    expect(candidate.positions.find((item) => item.artistName === '艺术家甲')!.nominalValue).toBe(
      '300.00'
    );
    expect(candidate.changes.length).toBeGreaterThan(1);
  });

  it('keeps a safe portfolio unchanged and rejects malformed candidates', () => {
    const positions = samplePositions().map((position, index) => ({
      ...position,
      nominalValue: index === 0 ? '300.00' : index === 1 ? '350.00' : '350.00',
      liquidityLevel: 'high' as const,
    }));
    const candidate = generateCandidateAllocation(positions, {
      maxArtistConcentration: '0.350000',
      maxArtistName: '艺术家乙',
      lowLiquidityRatio: '0.000000',
      completenessRatio: '1.000000',
      bearLossRate: '0.100000',
    });
    expect(candidate.changes).toEqual([]);
    expect(
      validateCandidate(positions, [
        { ...positions[0]!, nominalValue: '-1.00' },
        ...positions.slice(1, 2),
      ]).valid
    ).toBe(false);
  });
});
