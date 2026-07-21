import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PdfReportRenderer, type AuditReportData } from '../src/reports/pdf-renderer';

const output = path.resolve(process.argv[2] ?? '../../output/pdf/artscape-sample-report.pdf');
const report: AuditReportData = {
  schemaVersion: '1.0.0', generatedAt: '2026-07-21T00:00:00.000Z',
  portfolio: {
    id: 'portfolio-sample', name: '艺术品配置演示组合', versionId: 'version-v2', versionNo: 2,
    totalNominalValue: '10000000.00',
    positions: Array.from({ length: 18 }, (_, index) => ({
      artworkName: `作品 ${index + 1}`, artistName: `艺术家 ${String.fromCharCode(65 + index)}`,
      nominalValue: `${400000 + index * 15000}.00`, liquidityLevel: ['high', 'medium', 'low'][index % 3]!,
    })),
  },
  analysis: {
    id: 'scenario-sample', calculationHash: 'b'.repeat(64),
    parameterSet: { id: 'artscape.scenario.parameters', version: '1.0.0', effectiveFrom: '2026-07-21', horizonYears: 3, currency: 'CNY', roundingMode: 'HALF_UP' },
    scenarios: [
      { code: 'bull', theoreticalValue: '12600000.00', realizableValue: '11200000.00', returnRate: '0.12' },
      { code: 'neutral', theoreticalValue: '11000000.00', realizableValue: '9800000.00', returnRate: '-0.02' },
      { code: 'bear', theoreticalValue: '8200000.00', realizableValue: '7100000.00', returnRate: '-0.29' },
    ],
    riskMetrics: { maxArtistConcentration: '0.35', maxArtistName: '艺术家 A', lowLiquidityRatio: '0.28', completenessRatio: '0.96', bearLossRate: '0.29' },
    breaches: [{ code: 'artist_concentration', message: '艺术家集中度接近阈值，建议结合流动性约束审阅。' }],
    explanation: { provider: 'deterministic-fallback', summary: '组合在熊市场景下承受明显回撤，应重点核查集中度和低流动性持仓。', observations: ['所有金额由确定性计算工具生成。', '候选方案保持组合名义总额不变。'], caveats: ['未接入实时市场数据。', '本报告不构成投资或交易指令。'] },
  },
  comparison: { beforeVersion: 'V1', afterVersion: 'V2', neutralRealizableDelta: '180000.00' },
  audit: { liveMarketDataUsed: false, autoTradingEnabled: false, calculationAuthority: 'deterministic-tools-only', formulaContractVersion: '1.0.0', reportRendererVersion: '1.0.1' },
};

async function main(): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, await new PdfReportRenderer().render(report));
  process.stdout.write(`${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
