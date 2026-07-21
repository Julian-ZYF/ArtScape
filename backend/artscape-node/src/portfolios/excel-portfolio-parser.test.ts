import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleWorkbookBuffer } from '../testing/fixtures';
import { ExcelPortfolioParser } from './excel-portfolio-parser';

afterEach(() => vi.unstubAllEnvs());

const bufferOf = async (workbook: ExcelJS.Workbook): Promise<Buffer> =>
  Buffer.from(await workbook.xlsx.writeBuffer());

describe('secure Excel parsing branches', () => {
  it('reports an empty workbook and missing required columns', async () => {
    const parser = new ExcelPortfolioParser();
    const empty = await parser.parse(await bufferOf(new ExcelJS.Workbook()));
    expect(empty.issues[0]?.code).toBe('EMPTY_WORKBOOK');

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('bad').addRow(['作品名称']);
    const missing = await parser.parse(await bufferOf(workbook));
    expect(missing.issues.filter((issue) => issue.code === 'MISSING_COLUMN').length).toBeGreaterThan(1);
  });

  it('enforces the configurable row ceiling', async () => {
    vi.stubEnv('MAX_EXCEL_ROWS', '1');
    const parsed = await new ExcelPortfolioParser().parse(await createSampleWorkbookBuffer());
    expect(parsed.issues[0]?.code).toBe('ROW_LIMIT_EXCEEDED');
  });

  it('reports no data rows and schema-invalid cells', async () => {
    const headers = ['作品名称', '艺术家', '品类', '名义价值', '基础价值', '流动性', '流动性折价', '交易成本率', '艺术家预期收益率', '币种'];
    const noRows = new ExcelJS.Workbook();
    noRows.addWorksheet('empty').addRow(headers);
    expect((await new ExcelPortfolioParser().parse(await bufferOf(noRows))).issues[0]?.code).toBe('NO_DATA_ROWS');

    const invalid = new ExcelJS.Workbook();
    const sheet = invalid.addWorksheet('invalid');
    sheet.addRow(headers);
    sheet.addRow(['作品', '艺术家', '绘画', -1, 100, '未知', '200%', '3%', '4%', 'USD']);
    const parsed = await new ExcelPortfolioParser().parse(await bufferOf(invalid));
    expect(parsed.positions).toHaveLength(0);
    expect(parsed.issues.every((issue) => issue.code === 'INVALID_CELL')).toBe(true);
  });
});
