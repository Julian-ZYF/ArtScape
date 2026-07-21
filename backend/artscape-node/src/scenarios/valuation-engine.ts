import Decimal from 'decimal.js';
import type {
  ArtPosition,
  PositionScenarioResult,
  ScenarioDefinition,
  ScenarioResult,
} from '../types';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const money = (value: Decimal.Value): string => new Decimal(value).toFixed(2);
const ratio = (value: Decimal.Value): string => new Decimal(value).toFixed(6);

export function calculatePositionScenario(
  position: ArtPosition,
  scenario: ScenarioDefinition
): PositionScenarioResult {
  const baseValue = new Decimal(position.baseValue);
  const nominalValue = new Decimal(position.nominalValue);
  const combinedReturn = new Decimal(1)
    .plus(scenario.marketReturn)
    .plus(position.artistExpectedReturn);
  const theoreticalValue = baseValue.mul(combinedReturn.pow(scenario.horizonYears));
  const realizableValue = theoreticalValue
    .mul(new Decimal(1).minus(position.liquidityDiscount))
    .mul(new Decimal(1).minus(position.transactionCostRate));
  const gainLoss = realizableValue.minus(nominalValue);
  return {
    positionId: position.id,
    artworkName: position.artworkName,
    artistName: position.artistName,
    nominalValue: money(nominalValue),
    theoreticalValue: money(theoreticalValue),
    realizableValue: money(realizableValue),
    gainLoss: money(gainLoss),
    returnRate: nominalValue.isZero() ? '0.000000' : ratio(gainLoss.div(nominalValue)),
  };
}

export function calculatePortfolioScenario(
  positions: ArtPosition[],
  scenario: ScenarioDefinition
): ScenarioResult {
  const results = positions.map((position) => calculatePositionScenario(position, scenario));
  const nominal = Decimal.sum(...results.map((result) => new Decimal(result.nominalValue)));
  const theoretical = Decimal.sum(
    ...results.map((result) => new Decimal(result.theoreticalValue))
  );
  const realizable = Decimal.sum(
    ...results.map((result) => new Decimal(result.realizableValue))
  );
  const gainLoss = realizable.minus(nominal);
  return {
    definition: scenario,
    positions: results,
    portfolio: {
      nominalValue: money(nominal),
      theoreticalValue: money(theoretical),
      realizableValue: money(realizable),
      gainLoss: money(gainLoss),
      returnRate: nominal.isZero() ? '0.000000' : ratio(gainLoss.div(nominal)),
    },
  };
}

