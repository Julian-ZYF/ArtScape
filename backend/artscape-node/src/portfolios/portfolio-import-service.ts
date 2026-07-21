import type { ArtScapeRepository } from '../repositories/artscape-repository';
import type { PortfolioImport, PortfolioVersion } from '../types';
import { AppError, requireFound } from '../utils/errors';
import { sha256 } from '../utils/hash';
import { createId } from '../utils/id';
import { ExcelPortfolioParser } from './excel-portfolio-parser';
import { validatePortfolioPositions } from './portfolio-validator';

export class PortfolioImportService {
  constructor(
    private readonly repository: ArtScapeRepository,
    private readonly parser = new ExcelPortfolioParser()
  ) {}

  async importWorkbook(input: {
    userId: string;
    fileName: string;
    portfolioName: string;
    buffer: Buffer;
  }): Promise<PortfolioImport> {
    const parsed = await this.parser.parse(input.buffer);
    const validation = validatePortfolioPositions(parsed.positions);
    const issues = [...parsed.issues, ...validation.issues];
    const timestamp = new Date().toISOString();
    const record: PortfolioImport = {
      id: createId('import'),
      userId: input.userId,
      fileName: input.fileName,
      portfolioName: input.portfolioName,
      status: issues.some((issue) => issue.severity === 'error')
        ? 'needs_correction'
        : 'awaiting_confirmation',
      detectedColumns: parsed.detectedColumns,
      positions: parsed.positions,
      issues,
      rawArtifactRef: `sha256:${sha256(input.buffer)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.repository.update((state) => {
      state.imports.push(record);
      return record;
    });
  }

  async validateImport(userId: string, importId: string) {
    const state = await this.repository.read();
    const record = requireFound(
      state.imports.find((item) => item.id === importId && item.userId === userId),
      'Portfolio import not found.'
    );
    const validation = validatePortfolioPositions(record.positions);
    return {
      valid:
        record.status !== 'needs_correction' &&
        validation.valid &&
        !record.issues.some((issue) => issue.severity === 'error'),
      issueCount: record.issues.length + validation.issues.length,
      issues: [...record.issues, ...validation.issues],
    };
  }

  async confirmImport(userId: string, importId: string): Promise<{
    portfolioId: string;
    versionId: string;
  }> {
    return this.repository.update((state) => {
      const record = requireFound(
        state.imports.find((item) => item.id === importId && item.userId === userId),
        'Portfolio import not found.'
      );
      if (record.confirmedVersionId) {
        const existing = requireFound(
          state.versions.find((version) => version.id === record.confirmedVersionId),
          'Confirmed portfolio version is missing.'
        );
        return { portfolioId: existing.portfolioId, versionId: existing.id };
      }
      const validation = validatePortfolioPositions(record.positions);
      if (!validation.valid || record.status === 'needs_correction') {
        throw new AppError(
          'Portfolio import contains validation errors and cannot be confirmed.',
          409,
          'IMPORT_INVALID',
          validation.issues
        );
      }
      const timestamp = new Date().toISOString();
      const portfolioId = createId('portfolio');
      const versionId = createId('version');
      const version: PortfolioVersion = {
        id: versionId,
        userId,
        portfolioId,
        versionNo: 1,
        status: 'confirmed',
        source: 'import',
        sourceRef: importId,
        totalNominalValue: validation.totalNominalValue,
        positions: structuredClone(record.positions),
        calculationHash: sha256({
          portfolioId,
          versionNo: 1,
          totalNominalValue: validation.totalNominalValue,
          positions: record.positions,
        }),
        confirmedAt: timestamp,
        createdAt: timestamp,
      };
      state.portfolios.push({
        id: portfolioId,
        userId,
        name: record.portfolioName,
        activeVersionId: versionId,
        createdAt: timestamp,
      });
      state.versions.push(version);
      record.status = 'confirmed';
      record.confirmedVersionId = versionId;
      record.updatedAt = timestamp;
      return { portfolioId, versionId };
    });
  }
}

