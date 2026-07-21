import Decimal from 'decimal.js';
import type {
  ArtPosition,
  RiskMetrics,
  ScenarioResult,
  ThresholdBreach,
} from '../types';

const ratio = (value: Decimal.Value): string => new Decimal(value).toFixed(6);

export function calculateRiskMetrics(
  positions: ArtPosition[],
  scenarios: ScenarioResult[]
): { metrics: RiskMetrics; breaches: ThresholdBreach[] } {
  const total = Decimal.sum(...positions.map((position) => new Decimal(position.nominalValue)));
  const byArtist = new Map<string, Decimal>();
  let lowLiquidity = new Decimal(0);
  let weightedCompleteness = new Decimal(0);

  for (const position of positions) {
    const value = new Decimal(position.nominalValue);
    byArtist.set(position.artistName, (byArtist.get(position.artistName) ?? new Decimal(0)).plus(value));
    if (position.liquidityLevel === 'low') lowLiquidity = lowLiquidity.plus(value);
    weightedCompleteness = weightedCompleteness.plus(value.mul(position.dataCompleteness));
  }

  let maxArtistName: string | undefined;
  let maxArtistValue = new Decimal(0);
  for (const [artistName, value] of byArtist.entries()) {
    if (value.gt(maxArtistValue)) {
      maxArtistName = artistName;
      maxArtistValue = value;
    }
  }

  const maxArtistConcentration = total.isZero() ? new Decimal(0) : maxArtistValue.div(total);
  const lowLiquidityRatio = total.isZero() ? new Decimal(0) : lowLiquidity.div(total);
  const completenessRatio = total.isZero()
    ? new Decimal(0)
    : weightedCompleteness.div(total);
  const bear = scenarios.find((scenario) => scenario.definition.code === 'bear');
  const bearReturn = new Decimal(bear?.portfolio.returnRate ?? 0);
  const bearLossRate = Decimal.max(new Decimal(0), bearReturn.negated());

  const metrics: RiskMetrics = {
    maxArtistConcentration: ratio(maxArtistConcentration),
    maxArtistName,
    lowLiquidityRatio: ratio(lowLiquidityRatio),
    completenessRatio: ratio(completenessRatio),
    bearLossRate: ratio(bearLossRate),
  };
  const breaches: ThresholdBreach[] = [];
  if (maxArtistConcentration.gt(0.4)) {
    breaches.push({
      code: 'artist_concentration',
      actual: metrics.maxArtistConcentration,
      threshold: '0.400000',
      severity: 'high',
      message: `Artist concentration exceeds 40%${maxArtistName ? `: ${maxArtistName}` : ''}.`,
    });
  }
  if (lowLiquidityRatio.gt(0.3)) {
    breaches.push({
      code: 'low_liquidity',
      actual: metrics.lowLiquidityRatio,
      threshold: '0.300000',
      severity: 'warning',
      message: 'Low-liquidity allocation exceeds 30%.',
    });
  }
  if (bearLossRate.gt(0.3)) {
    breaches.push({
      code: 'bear_loss',
      actual: ratio(bearLossRate),
      threshold: '0.300000',
      severity: 'high',
      message: 'Bear-scenario loss exceeds 30%.',
    });
  }
  return { metrics, breaches };
}
