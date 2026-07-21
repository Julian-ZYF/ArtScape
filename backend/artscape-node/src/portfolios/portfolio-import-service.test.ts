import { describe, expect, it } from 'vitest';
import { InMemoryArtScapeRepository } from '../repositories/in-memory-artscape-repository';
import { createSampleWorkbookBuffer } from '../testing/fixtures';
import { PortfolioImportService } from './portfolio-import-service';

describe('portfolio import and immutable V1', () => {
  it('parses a Chinese-header workbook and confirms only a valid import', async () => {
    const repository = new InMemoryArtScapeRepository();
    const service = new PortfolioImportService(repository);
    const imported = await service.importWorkbook({
      userId: 'user-1',
      fileName: 'portfolio.xlsx',
      portfolioName: '验收组合',
      buffer: await createSampleWorkbookBuffer(),
    });
    expect(imported.status).toBe('awaiting_confirmation');
    expect(imported.positions).toHaveLength(3);

    const confirmed = await service.confirmImport('user-1', imported.id);
    const duplicate = await service.confirmImport('user-1', imported.id);
    expect(duplicate).toEqual(confirmed);
    const state = await repository.read();
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0]!.versionNo).toBe(1);
    expect(state.versions[0]!.totalNominalValue).toBe('1000.00');
  });
});

