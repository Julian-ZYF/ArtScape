import ExcelJS from 'exceljs';
import type { ArtPosition } from '../types';

export const samplePositions = (): ArtPosition[] => [
  {
    id: 'position-a',
    sourceRow: 2,
    artworkName: '作品甲',
    artistName: '艺术家甲',
    category: '绘画',
    nominalValue: '600.00',
    baseValue: '600.00',
    liquidityLevel: 'low',
    liquidityDiscount: '0.25',
    transactionCostRate: '0.05',
    artistExpectedReturn: '0.04',
    dataCompleteness: '1',
    currency: 'CNY',
  },
  {
    id: 'position-b',
    sourceRow: 3,
    artworkName: '作品乙',
    artistName: '艺术家乙',
    category: '雕塑',
    nominalValue: '250.00',
    baseValue: '250.00',
    liquidityLevel: 'high',
    liquidityDiscount: '0.05',
    transactionCostRate: '0.03',
    artistExpectedReturn: '0.03',
    dataCompleteness: '1',
    currency: 'CNY',
  },
  {
    id: 'position-c',
    sourceRow: 4,
    artworkName: '作品丙',
    artistName: '艺术家丙',
    category: '摄影',
    nominalValue: '150.00',
    baseValue: '150.00',
    liquidityLevel: 'medium',
    liquidityDiscount: '0.10',
    transactionCostRate: '0.04',
    artistExpectedReturn: '0.02',
    dataCompleteness: '1',
    currency: 'CNY',
  },
];

export async function createSampleWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Portfolio');
  sheet.addRow([
    '作品名称',
    '艺术家',
    '品类',
    '名义价值',
    '基础价值',
    '流动性',
    '流动性折价',
    '交易成本率',
    '艺术家预期收益率',
    '币种',
  ]);
  for (const position of samplePositions()) {
    sheet.addRow([
      position.artworkName,
      position.artistName,
      position.category,
      Number(position.nominalValue),
      Number(position.baseValue),
      position.liquidityLevel === 'low'
        ? '低'
        : position.liquidityLevel === 'high'
          ? '高'
          : '中',
      Number(position.liquidityDiscount),
      Number(position.transactionCostRate),
      Number(position.artistExpectedReturn),
      position.currency,
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
