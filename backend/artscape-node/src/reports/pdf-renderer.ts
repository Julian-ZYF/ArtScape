import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const percent = (value: string): string => `${(Number(value) * 100).toFixed(2)}%`;

export interface AuditReportData {
  schemaVersion: '1.0.0';
  generatedAt: string;
  portfolio: {
    id: string;
    name: string;
    versionId: string;
    versionNo: number;
    totalNominalValue: string;
    positions: Array<{
      artworkName: string;
      artistName: string;
      nominalValue: string;
      liquidityLevel: string;
    }>;
  };
  analysis: {
    id: string;
    calculationHash: string;
    parameterSet: { id: string; version: string; effectiveFrom: string; horizonYears: number; currency: string; roundingMode: string };
    scenarios: Array<{
      code: string;
      theoreticalValue: string;
      realizableValue: string;
      returnRate: string;
    }>;
    riskMetrics: {
      maxArtistConcentration: string;
      maxArtistName?: string;
      lowLiquidityRatio: string;
      completenessRatio: string;
      bearLossRate?: string;
    };
    breaches: Array<{ code: string; message: string }>;
    explanation: {
      provider: string;
      summary: string;
      observations: string[];
      caveats: string[];
    };
  };
  comparison?: unknown;
  audit: {
    liveMarketDataUsed: false;
    autoTradingEnabled: false;
    calculationAuthority: 'deterministic-tools-only';
    formulaContractVersion: '1.0.0';
    reportRendererVersion: '1.0.1';
  };
}

interface PdfFontSpec {
  path: string;
  family?: string;
}

const systemFontCandidates: PdfFontSpec[] = [
  { path: 'C:\\Windows\\Fonts\\simhei.ttf' },
  { path: 'C:\\Windows\\Fonts\\msyh.ttc', family: 'MicrosoftYaHei' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf' },
  {
    path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    family: 'NotoSansCJKsc-Regular',
  },
  { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
];

export function resolvePdfFont(): PdfFontSpec {
  const configuredPath = process.env.ARTSCAPE_PDF_FONT?.trim();
  if (configuredPath) {
    if (!existsSync(configuredPath)) {
      throw new Error(`Configured PDF font does not exist: ${configuredPath}`);
    }
    const family = process.env.ARTSCAPE_PDF_FONT_FAMILY?.trim() || undefined;
    if (path.extname(configuredPath).toLowerCase() === '.ttc' && !family) {
      throw new Error(
        'ARTSCAPE_PDF_FONT_FAMILY is required when ARTSCAPE_PDF_FONT points to a TTC collection.'
      );
    }
    return { path: configuredPath, ...(family ? { family } : {}) };
  }

  const font = systemFontCandidates.find((candidate) => existsSync(candidate.path));
  if (!font) {
    throw new Error(
      'No Chinese PDF font is available. Install Noto Sans CJK or configure ARTSCAPE_PDF_FONT.'
    );
  }
  return font;
}

export class PdfReportRenderer {
  async render(report: AuditReportData): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const font = resolvePdfFont();
      const document = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'ArtScape Report', Author: 'ArtScape' } });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      if (font.family) {
        document.font(font.path, font.family);
      } else {
        document.font(font.path);
      }

      document.fontSize(20).text('ArtScape 艺术品配置沙盘报告');
      document.moveDown(0.5).fontSize(9).fillColor('#555555');
      document.text(`生成时间：${report.generatedAt}`);
      document.text(`组合：${report.portfolio.name} / V${report.portfolio.versionNo}`);
      document.text(`组合版本：${report.portfolio.versionId}`);
      document.text(`计算哈希：${report.analysis.calculationHash}`);
      document.text(`参数集：${report.analysis.parameterSet.id} / ${report.analysis.parameterSet.version}（${report.analysis.parameterSet.effectiveFrom} 生效）`);
      document.fillColor('#000000').moveDown();

      document.fontSize(14).text('组合摘要');
      document.fontSize(10).text(`名义总额：${report.portfolio.totalNominalValue}`);
      for (const position of report.portfolio.positions) {
        document.text(
          `- ${position.artworkName} / ${position.artistName} / ${position.nominalValue} / ${position.liquidityLevel}`
        );
      }

      document.moveDown().fontSize(14).text('三年情景分析');
      document.fontSize(10);
      for (const scenario of report.analysis.scenarios) {
        document.text(
          `${scenario.code}: 理论价值 ${scenario.theoreticalValue}，可实现价值 ${scenario.realizableValue}，回报率 ${percent(scenario.returnRate)}`
        );
      }

      document.moveDown().fontSize(14).text('计算口径与公式');
      document.fontSize(9);
      document.text(`口径：${report.analysis.parameterSet.horizonYears} 年、${report.analysis.parameterSet.currency}、${report.analysis.parameterSet.roundingMode}`);
      document.text('理论价值 = 基础价值 × (1 + 艺术家预期收益率 + 情景市场收益率)^3');
      document.text('可实现价值 = 理论价值 × (1 - 流动性折价) × (1 - 交易成本率)');
      document.text(`公式契约版本：${report.audit.formulaContractVersion}`);

      document.moveDown().fontSize(14).text('风险指标');
      document.fontSize(10);
      document.text(
        `最大艺术家集中度：${percent(report.analysis.riskMetrics.maxArtistConcentration)}`
      );
      document.text(`低流动性占比：${percent(report.analysis.riskMetrics.lowLiquidityRatio)}`);
      document.text(`数据完整率：${percent(report.analysis.riskMetrics.completenessRatio)}`);
      if (report.analysis.riskMetrics.bearLossRate) {
        document.text(`熊市损失率：${percent(report.analysis.riskMetrics.bearLossRate)}`);
      }
      report.analysis.breaches.forEach((breach) => document.text(`- ${breach.message}`));

      document.moveDown().fontSize(14).text('Agent 解释');
      document.fontSize(10).text(report.analysis.explanation.summary);
      report.analysis.explanation.observations.forEach((item) => document.text(`- ${item}`));
      report.analysis.explanation.caveats.forEach((item) => document.text(`注意：${item}`));

      if (report.comparison) {
        document.moveDown().fontSize(14).fillColor('#000000').text('版本对比');
        document.fontSize(8).text(JSON.stringify(report.comparison, null, 2), { lineGap: 1 });
      }

      document
        .moveDown()
        .fontSize(9)
        .fillColor('#555555')
        .text('本报告未使用实时市场数据，不构成交易或投资指令。');
      const pages = document.bufferedPageRange();
      for (let index = pages.start; index < pages.start + pages.count; index += 1) {
        document.switchToPage(index);
        document.fontSize(8).fillColor('#666666');
        document.text('ArtScape · 确定性计算与可审计报告', 48, 20, { width: 499, align: 'left' });
        document.text(`第 ${index - pages.start + 1} / ${pages.count} 页`, 48, document.page.height - document.page.margins.bottom - 12, { width: 499, align: 'right', lineBreak: false });
      }
      document.end();
    });
  }
}
