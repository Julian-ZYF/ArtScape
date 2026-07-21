import Decimal from 'decimal.js';
import type {
  AllocationChange,
  ArtPosition,
  CandidateValidation,
  RiskMetrics,
} from '../types';

interface MutablePosition {
  source: ArtPosition;
  nominal: Decimal;
  base: Decimal;
}

function distributeReduction(
  reducers: MutablePosition[],
  receivers: MutablePosition[],
  amount: Decimal
): void {
  if (amount.lte(0) || !reducers.length || !receivers.length) return;
  const reducible = Decimal.sum(...reducers.map((position) => position.nominal));
  if (reducible.lte(0)) return;
  const actual = Decimal.min(amount, reducible);

  for (const position of reducers) {
    const reduction = actual.mul(position.nominal.div(reducible));
    const originalNominal = position.nominal;
    const ratio = originalNominal.isZero()
      ? new Decimal(0)
      : originalNominal.minus(reduction).div(originalNominal);
    position.nominal = Decimal.max(0, originalNominal.minus(reduction));
    position.base = position.base.mul(ratio);
  }

  const receiverTotal = Decimal.sum(...receivers.map((position) => position.nominal));
  for (const position of receivers) {
    const share = receiverTotal.isZero()
      ? new Decimal(1).div(receivers.length)
      : position.nominal.div(receiverTotal);
    const addition = actual.mul(share);
    const originalNominal = position.nominal;
    const baseRatio = originalNominal.isZero()
      ? new Decimal(1)
      : position.base.div(originalNominal);
    position.nominal = position.nominal.plus(addition);
    position.base = position.base.plus(addition.mul(baseRatio));
  }
}

function normalizeRounding(positions: MutablePosition[], expectedTotal: Decimal): void {
  positions.forEach((position) => {
    position.nominal = new Decimal(position.nominal.toFixed(2));
    position.base = new Decimal(position.base.toFixed(2));
  });
  const actual = Decimal.sum(...positions.map((position) => position.nominal));
  const delta = expectedTotal.minus(actual);
  if (!delta.isZero() && positions[0]) positions[0].nominal = positions[0].nominal.plus(delta);
}

export function validateCandidate(
  original: ArtPosition[],
  proposed: ArtPosition[]
): CandidateValidation {
  const originalTotal = Decimal.sum(...original.map((position) => position.nominalValue));
  const proposedTotal = Decimal.sum(...proposed.map((position) => position.nominalValue));
  const totalPreserved = originalTotal.eq(proposedTotal);
  const nonNegative = proposed.every(
    (position) =>
      new Decimal(position.nominalValue).gte(0) && new Decimal(position.baseValue).gte(0)
  );
  const violations: string[] = [];
  if (!totalPreserved) violations.push('Candidate total nominal value differs from base version.');
  if (!nonNegative) violations.push('Candidate contains a negative allocation.');
  if (original.length !== proposed.length) {
    violations.push('Candidate must preserve the original position set.');
  }
  const originalIds = new Set(original.map((position) => position.id));
  if (proposed.some((position) => !originalIds.has(position.id))) {
    violations.push('Candidate contains an unknown position.');
  }
  return {
    valid: !violations.length,
    totalPreserved,
    nonNegative,
    violations,
  };
}

export function generateCandidateAllocation(
  original: ArtPosition[],
  riskMetrics: RiskMetrics
): {
  positions: ArtPosition[];
  changes: AllocationChange[];
  validation: CandidateValidation;
} {
  const mutable: MutablePosition[] = original.map((position) => ({
    source: position,
    nominal: new Decimal(position.nominalValue),
    base: new Decimal(position.baseValue),
  }));
  const total = Decimal.sum(...mutable.map((position) => position.nominal));
  const maxArtist = riskMetrics.maxArtistName;

  if (maxArtist && new Decimal(riskMetrics.maxArtistConcentration).gt(0.4)) {
    const reducers = mutable.filter((position) => position.source.artistName === maxArtist);
    const receivers = mutable.filter(
      (position) =>
        position.source.artistName !== maxArtist && position.source.liquidityLevel !== 'low'
    );
    const artistTotal = Decimal.sum(...reducers.map((position) => position.nominal));
    distributeReduction(
      reducers,
      receivers.length
        ? receivers
        : mutable.filter((position) => position.source.artistName !== maxArtist),
      artistTotal.minus(total.mul(0.4))
    );
  }

  const lowPositions = mutable.filter((position) => position.source.liquidityLevel === 'low');
  const lowTotal = lowPositions.length
    ? Decimal.sum(...lowPositions.map((position) => position.nominal))
    : new Decimal(0);
  if (lowTotal.gt(total.mul(0.3))) {
    const receivers = mutable.filter(
      (position) =>
        position.source.liquidityLevel !== 'low' &&
        (!maxArtist || position.source.artistName !== maxArtist)
    );
    distributeReduction(lowPositions, receivers, lowTotal.minus(total.mul(0.3)));
  }

  normalizeRounding(mutable, total);
  const positions = mutable.map((position) => ({
    ...structuredClone(position.source),
    nominalValue: position.nominal.toFixed(2),
    baseValue: position.base.toFixed(2),
  }));
  const changes = positions
    .map((position, index): AllocationChange | null => {
      const before = new Decimal(original[index]!.nominalValue);
      const after = new Decimal(position.nominalValue);
      const delta = after.minus(before);
      if (delta.isZero()) return null;
      return {
        positionId: position.id,
        artworkName: position.artworkName,
        artistName: position.artistName,
        beforeNominalValue: before.toFixed(2),
        afterNominalValue: after.toFixed(2),
        delta: delta.toFixed(2),
        reason:
          delta.isNegative()
            ? '降低集中度或低流动性风险暴露。'
            : '承接风险资产释放的配置额度。',
      };
    })
    .filter((change): change is AllocationChange => change !== null);
  return { positions, changes, validation: validateCandidate(original, positions) };
}
