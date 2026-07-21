import ExcelJS from 'exceljs';
import { artPositionInputSchema } from '../schemas/contracts';
import type { ArtPosition, ImportIssue, LiquidityLevel } from '../types';
import { createId } from '../utils/id';

const COLUMN_ALIASES = {
  artworkName: ['artworkname', 'artwork', '作品名称', '艺术品名称', '作品'],
  artistName: ['artistname', 'artist', '艺术家名称', '艺术家', '作者'],
  category: ['category', '品类', '类别'],
  nominalValue: ['nominalvalue', 'allocationvalue', '配置金额', '名义价值', '持仓价值'],
  baseValue: ['basevalue', 'currentvalue', '当前估值', '基础价值', '估值'],
  liquidityLevel: ['liquiditylevel', 'liquidity', '流动性等级', '流动性'],
  liquidityDiscount: ['liquiditydiscount', '流动性折价', '流动性折扣'],
  transactionCostRate: ['transactioncostrate', 'transactioncost', '交易成本率', '交易成本'],
  artistExpectedReturn: [
    'artistexpectedreturn',
    'artistreturn',
    '艺术家预期收益率',
    '艺术家收益率',
  ],
  currency: ['currency', '币种', '货币'],
  dataSource: ['datasource', '数据来源', '来源'],
  dataDate: ['datadate', '数据日期', '估值日期'],
} as const;

type FieldName = keyof typeof COLUMN_ALIASES;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object') {
    if ('result' in value) return value.result;
    if ('text' in value) return value.text;
    if ('richText' in value) return value.richText.map((entry) => entry.text).join('');
  }
  return value;
}

function decimal(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const normalized = String(value ?? '')
    .trim()
    .replace(/[,，￥¥]/g, '');
  if (!normalized) return '';
  if (normalized.endsWith('%')) {
    return String(Number(normalized.slice(0, -1)) / 100);
  }
  return normalized;
}

function liquidity(value: unknown): LiquidityLevel | '' {
  const normalized = normalizeHeader(value);
  if (['high', '高', '高流动性'].includes(normalized)) return 'high';
  if (['medium', 'mid', '中', '中流动性'].includes(normalized)) return 'medium';
  if (['low', '低', '低流动性'].includes(normalized)) return 'low';
  return '';
}

export interface ParsedPortfolioWorkbook {
  detectedColumns: string[];
  positions: ArtPosition[];
  issues: ImportIssue[];
}

export class ExcelPortfolioParser {
  async parse(buffer: Buffer): Promise<ParsedPortfolioWorkbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return {
        detectedColumns: [],
        positions: [],
        issues: [{ code: 'EMPTY_WORKBOOK', severity: 'error', message: 'Workbook has no sheet.' }],
      };
    }

    const headers = new Map<FieldName, number>();
    const detectedColumns: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
      const raw = String(cellValue(cell.value) ?? '').trim();
      detectedColumns.push(raw);
      const normalized = normalizeHeader(raw);
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<
        [FieldName, readonly string[]]
      >) {
        if (aliases.includes(normalized)) headers.set(field, column);
      }
    });

    const issues: ImportIssue[] = [];
    const required: FieldName[] = [
      'artworkName',
      'artistName',
      'category',
      'nominalValue',
      'baseValue',
      'liquidityLevel',
      'liquidityDiscount',
      'transactionCostRate',
      'artistExpectedReturn',
      'currency',
    ];
    for (const field of required) {
      if (!headers.has(field)) {
        issues.push({
          field,
          code: 'MISSING_COLUMN',
          severity: 'error',
          message: `Missing required column: ${field}`,
        });
      }
    }
    if (issues.length) return { detectedColumns, positions: [], issues };

    const maxRows = Number(process.env.MAX_EXCEL_ROWS ?? 1000);
    if (sheet.rowCount - 1 > maxRows) {
      return {
        detectedColumns,
        positions: [],
        issues: [{
          code: 'ROW_LIMIT_EXCEEDED', severity: 'error',
          message: `Workbook has ${sheet.rowCount - 1} data rows; maximum is ${maxRows}.`,
        }],
      };
    }

    const positions: ArtPosition[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = Object.fromEntries(
        required.map((field) => [
          field,
          cellValue(row.getCell(headers.get(field)!).value),
        ])
      ) as Record<FieldName, unknown>;
      if (Object.values(values).every((value) => String(value ?? '').trim() === '')) continue;

      const populatedCount = required.filter(
        (field) => String(values[field] ?? '').trim() !== ''
      ).length;
      const candidate = {
        artworkName: String(values.artworkName ?? '').trim(),
        artistName: String(values.artistName ?? '').trim(),
        category: String(values.category ?? '').trim(),
        nominalValue: decimal(values.nominalValue),
        baseValue: decimal(values.baseValue),
        liquidityLevel: liquidity(values.liquidityLevel),
        liquidityDiscount: decimal(values.liquidityDiscount),
        transactionCostRate: decimal(values.transactionCostRate),
        artistExpectedReturn: decimal(values.artistExpectedReturn),
        dataCompleteness: String(populatedCount / required.length),
        currency: String(values.currency ?? '').trim().toUpperCase(),
        dataSource: headers.has('dataSource')
          ? String(cellValue(row.getCell(headers.get('dataSource')!).value) ?? '').trim() || undefined
          : undefined,
        dataDate: headers.has('dataDate')
          ? String(cellValue(row.getCell(headers.get('dataDate')!).value) ?? '').trim() || undefined
          : undefined,
      };
      const parsed = artPositionInputSchema.safeParse(candidate);
      if (!parsed.success) {
        for (const error of parsed.error.issues) {
          issues.push({
            row: rowNumber,
            field: error.path.join('.'),
            code: 'INVALID_CELL',
            severity: 'error',
            message: error.message,
          });
        }
        continue;
      }
      positions.push({
        ...parsed.data,
        id: createId('position'),
        sourceRow: rowNumber,
      });
    }

    if (!positions.length && !issues.length) {
      issues.push({
        code: 'NO_DATA_ROWS',
        severity: 'error',
        message: 'Workbook contains no portfolio data rows.',
      });
    }
    return { detectedColumns, positions, issues };
  }
}
