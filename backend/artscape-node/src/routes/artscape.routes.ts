import { Router, type Request } from 'express';
import multer from 'multer';
import { artScapeDomainPack } from '../domain-pack';
import {
  candidateDecisionSchema,
  candidateRequestSchema,
  confirmImportSchema,
  portfolioImportRequestSchema,
  reportRequestSchema,
  scenarioRunRequestSchema,
  workflowTaskRequestSchema,
  createSessionSchema,
  agentMessageSchema,
} from '../schemas/contracts';
import type { ArtScapeRuntimeService } from '../services/ArtScapeRuntime';
import { ARTSCAPE_TOOL_IDS, artScapeToolSpecs } from '../tools';
import type { ReportRecord } from '../types';
import { AppError, requireFound } from '../utils/errors';
import { asyncHandler } from '../middleware/error-handler';
import { authenticate, principalUserId, requirePermission } from '../security/auth';
import { openApiDocument } from '../openapi';
import { ARTSCAPE_BACKEND_VERSION } from '../version';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024), files: 1, fields: 8 },
  fileFilter: (_req, file, callback) => {
    const extensionOk = /\.xlsx$/i.test(file.originalname);
    const mimeOk = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(file.mimetype);
    if (!extensionOk || !mimeOk) {
      callback(new AppError('Only .xlsx files are accepted.', 415, 'UNSUPPORTED_FILE_TYPE'));
      return;
    }
    callback(null, true);
  },
});

const userIdFrom = (req: Request): string => principalUserId(req);

const assertXlsxMagic = (buffer: Buffer): void => {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new AppError('Invalid XLSX container.', 415, 'INVALID_XLSX_SIGNATURE');
  }
};

export function createArtScapeRouter(service: ArtScapeRuntimeService): Router {
  const router = Router();
  const { runtime } = service;
  router.use(authenticate);
  router.use((req, res, next) => requirePermission(req.method === 'GET' ? 'artscape:read' : req.path === '/reports' ? 'artscape:export' : 'artscape:write')(req, res, next));

  router.get('/openapi.json', (_req, res) => res.json(openApiDocument));

  router.get('/status', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'artscape-backend',
        version: ARTSCAPE_BACKEND_VERSION,
        persistence: service.persistence,
        warning: service.warning,
        domainPack: { id: artScapeDomainPack.id, version: artScapeDomainPack.version },
        aiPricing: false,
        liveMarketData: false,
        autoTrading: false,
      },
    });
  });

  router.get('/domain-pack', (_req, res) => {
    res.json({ success: true, data: artScapeDomainPack });
  });

  router.get('/tools', (_req, res) => {
    res.json({ success: true, data: artScapeToolSpecs });
  });

  router.post(
    '/imports',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new AppError('Excel file is required.', 400, 'FILE_REQUIRED');
      assertXlsxMagic(req.file.buffer);
      const parsed = portfolioImportRequestSchema.parse({
        userId: userIdFrom(req),
        portfolioName: req.body.portfolioName,
        fileName: req.file.originalname,
        idempotencyKey: req.body.idempotencyKey ?? req.get('idempotency-key'),
      });
      if (process.env.ARTSCAPE_ASYNC_JOBS === 'true') {
        const job = await runtime.jobs.enqueue({
          userId: parsed.userId,
          type: 'portfolio_import',
          idempotencyKey: parsed.idempotencyKey,
          payload: {
            fileName: parsed.fileName,
            portfolioName: parsed.portfolioName,
            fileBase64: req.file.buffer.toString('base64'),
          },
        });
        res.status(202).json({ success: true, data: { job } });
        return;
      }
      const result = await runtime.jobs.run(
        {
          userId: parsed.userId,
          type: 'portfolio_import',
          payload: { fileName: parsed.fileName, portfolioName: parsed.portfolioName },
          idempotencyKey: parsed.idempotencyKey,
        },
        () =>
          runtime.invoke<{ importId: string; status: string }>(
            ARTSCAPE_TOOL_IDS.parseExcel,
            {
              userId: parsed.userId,
              fileName: parsed.fileName,
              portfolioName: parsed.portfolioName,
              fileBase64: req.file!.buffer.toString('base64'),
            },
            {
              userId: parsed.userId,
              idempotencyKey: parsed.idempotencyKey,
              workflowId: 'workflow.art-portfolio-intake',
            }
          )
      );
      if (result.output.status !== 'completed' || !result.output.data) {
        throw new AppError(result.output.error ?? 'Import failed.', 500, 'IMPORT_FAILED');
      }
      const state = await runtime.repository.read();
      const record = requireFound(
        state.imports.find((item) => item.id === result.output.data!.importId),
        'Created import not found.'
      );
      res.status(201).json({
        success: true,
        data: { job: result.job, runId: result.output.runId, import: record },
      });
    })
  );

  router.get(
    '/imports/:importId',
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      const state = await runtime.repository.read();
      const record = requireFound(
        state.imports.find(
          (item) => item.id === req.params.importId && item.userId === userId
        ),
        'Portfolio import not found.'
      );
      res.json({ success: true, data: record });
    })
  );

  router.post(
    '/imports/:importId/confirm',
    asyncHandler(async (req, res) => {
      const parsed = confirmImportSchema.parse({ ...req.body, userId: userIdFrom(req) });
      const result = await runtime.invoke<{ portfolioId: string; versionId: string }>(
        ARTSCAPE_TOOL_IDS.confirmVersion,
        { userId: parsed.userId, importId: req.params.importId },
        {
          userId: parsed.userId,
          idempotencyKey: parsed.idempotencyKey,
          approve: parsed.approved,
          workflowId: 'workflow.art-portfolio-intake',
        }
      );
      if (result.status !== 'completed' || !result.data) {
        throw new AppError(result.error ?? 'Portfolio confirmation failed.', 409, 'CONFIRM_FAILED');
      }
      const state = await runtime.repository.read();
      res.json({
        success: true,
        data: {
          runId: result.runId,
          portfolio: state.portfolios.find((item) => item.id === result.data!.portfolioId),
          version: state.versions.find((item) => item.id === result.data!.versionId),
        },
      });
    })
  );

  router.get(
    '/portfolios/:portfolioId',
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      const state = await runtime.repository.read();
      const portfolio = requireFound(
        state.portfolios.find(
          (item) => item.id === req.params.portfolioId && item.userId === userId
        ),
        'Portfolio not found.'
      );
      res.json({
        success: true,
        data: {
          portfolio,
          versions: state.versions.filter((version) => version.portfolioId === portfolio.id),
        },
      });
    })
  );

  router.post(
    '/portfolios/:portfolioId/scenario-runs',
    asyncHandler(async (req, res) => {
      const parsed = scenarioRunRequestSchema.parse({ ...req.body, userId: userIdFrom(req) });
      const result = await runtime.invoke<{ scenarioRunId: string; calculationHash: string }>(
        ARTSCAPE_TOOL_IDS.calculateScenario,
        { userId: parsed.userId, portfolioVersionId: parsed.portfolioVersionId },
        {
          userId: parsed.userId,
          idempotencyKey: parsed.idempotencyKey,
          workflowId: 'workflow.art-scenario-analysis',
        }
      );
      if (result.status !== 'completed' || !result.data) {
        throw new AppError(result.error ?? 'Scenario calculation failed.', 500, 'SCENARIO_FAILED');
      }
      const analysis = await runtime.scenarios.get(parsed.userId, result.data.scenarioRunId);
      if (analysis.portfolioId !== req.params.portfolioId) {
        throw new AppError('Portfolio route and version do not match.', 409, 'PORTFOLIO_MISMATCH');
      }
      res.status(201).json({ success: true, data: { runId: result.runId, analysis } });
    })
  );

  router.get(
    '/scenario-runs/:scenarioRunId',
    asyncHandler(async (req, res) => {
      const analysis = await runtime.scenarios.get(
        userIdFrom(req),
        String(req.params.scenarioRunId)
      );
      res.json({ success: true, data: analysis });
    })
  );

  router.post(
    '/scenario-runs/:scenarioRunId/candidate-proposals',
    asyncHandler(async (req, res) => {
      const parsed = candidateRequestSchema.parse({
        ...req.body,
        userId: userIdFrom(req),
        scenarioRunId: req.params.scenarioRunId,
      });
      const result = await runtime.invoke<{ proposalId: string; valid: boolean }>(
        ARTSCAPE_TOOL_IDS.generateCandidate,
        { userId: parsed.userId, scenarioRunId: parsed.scenarioRunId },
        {
          userId: parsed.userId,
          idempotencyKey: parsed.idempotencyKey,
          workflowId: 'workflow.art-candidate-comparison',
        }
      );
      if (result.status !== 'completed' || !result.data) {
        throw new AppError(result.error ?? 'Candidate generation failed.', 500, 'CANDIDATE_FAILED');
      }
      const state = await runtime.repository.read();
      const proposal = requireFound(
        state.candidates.find((candidate) => candidate.id === result.data!.proposalId),
        'Created candidate not found.'
      );
      res.status(201).json({ success: true, data: { runId: result.runId, proposal } });
    })
  );

  router.get(
    '/candidate-proposals/:proposalId',
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      const state = await runtime.repository.read();
      const proposal = requireFound(
        state.candidates.find(
          (candidate) => candidate.id === req.params.proposalId && candidate.userId === userId
        ),
        'Candidate proposal not found.'
      );
      res.json({ success: true, data: proposal });
    })
  );

  router.post(
    '/candidate-proposals/:proposalId/decisions',
    asyncHandler(async (req, res) => {
      const parsed = candidateDecisionSchema.parse({ ...req.body, userId: userIdFrom(req) });
      const result = await runtime.invoke<{ proposalId: string; decision: string }>(
        ARTSCAPE_TOOL_IDS.confirmCandidate,
        {
          userId: parsed.userId,
          proposalId: req.params.proposalId,
          decision: parsed.decision,
          ...(parsed.proposedPositions
            ? { proposedPositions: parsed.proposedPositions }
            : {}),
        },
        {
          userId: parsed.userId,
          idempotencyKey: parsed.idempotencyKey,
          approve: true,
          workflowId: 'workflow.art-candidate-comparison',
        }
      );
      if (result.status !== 'completed' || !result.data) {
        throw new AppError(result.error ?? 'Candidate decision failed.', 409, 'DECISION_FAILED');
      }
      const state = await runtime.repository.read();
      const proposal = requireFound(
        state.candidates.find((candidate) => candidate.id === result.data!.proposalId),
        'Candidate proposal not found.'
      );
      const comparison = proposal.comparisonId
        ? state.comparisons.find((item) => item.id === proposal.comparisonId)
        : undefined;
      res.json({ success: true, data: { runId: result.runId, proposal, comparison } });
    })
  );

  router.get(
    '/comparisons/:comparisonId',
    asyncHandler(async (req, res) => {
      const comparison = await runtime.candidates.getComparison(
        userIdFrom(req),
        String(req.params.comparisonId)
      );
      res.json({ success: true, data: comparison });
    })
  );

  router.post(
    '/reports',
    asyncHandler(async (req, res) => {
      const parsed = reportRequestSchema.parse({ ...req.body, userId: userIdFrom(req) });
      const reportInput = {
        userId: parsed.userId,
        portfolioVersionId: parsed.portfolioVersionId,
        scenarioRunId: parsed.scenarioRunId,
        ...(parsed.comparisonId ? { comparisonId: parsed.comparisonId } : {}),
      };
      if (process.env.ARTSCAPE_ASYNC_JOBS === 'true') {
        const job = await runtime.jobs.enqueue({
          userId: parsed.userId,
          type: 'report_export',
          payload: reportInput,
          idempotencyKey: parsed.idempotencyKey,
        });
        res.status(202).json({ success: true, data: { job } });
        return;
      }
      const result = await runtime.jobs.run(
        {
          userId: parsed.userId,
          type: 'report_export',
          payload: parsed,
          idempotencyKey: parsed.idempotencyKey,
        },
        async () => {
          const built = await runtime.invoke<{
            report: unknown;
            snapshotHash: string;
          }>(
            ARTSCAPE_TOOL_IDS.buildReportJson,
            reportInput,
            {
              userId: parsed.userId,
              workflowId: 'workflow.art-report-export',
            }
          );
          if (built.status !== 'completed' || !built.data) {
            throw new AppError(built.error ?? 'Report JSON build failed.', 500, 'REPORT_BUILD_FAILED');
          }
          return runtime.invoke<{
            reportId: string;
            jsonArtifactId: string;
            pdfArtifactId: string;
          }>(
            ARTSCAPE_TOOL_IDS.renderReportPdf,
            { ...reportInput, ...built.data },
            {
              userId: parsed.userId,
              idempotencyKey: `${parsed.idempotencyKey}:render`,
              workflowId: 'workflow.art-report-export',
            }
          );
        }
      );
      if (result.output.status !== 'completed' || !result.output.data) {
        throw new AppError(result.output.error ?? 'Report export failed.', 500, 'REPORT_FAILED');
      }
      const state = await runtime.repository.read();
      const report = requireFound(
        state.reports.find((item) => item.id === result.output.data!.reportId),
        'Created report not found.'
      );
      res.status(201).json({
        success: true,
        data: { job: result.job, runId: result.output.runId, report },
      });
    })
  );

  router.get(
    '/reports/:reportId',
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      const report = requireFound(
        (await runtime.repository.read()).reports.find(
          (item) => item.id === req.params.reportId && item.userId === userId
        ),
        'Report not found.'
      );
      res.json({ success: true, data: report });
    })
  );

  router.get(
    '/artifacts/:artifactId',
    asyncHandler(async (req, res) => {
      const userId = userIdFrom(req);
      const reports = (await runtime.repository.read()).reports.filter(
        (report) => report.userId === userId
      );
      const artifact = reports
        .flatMap((report: ReportRecord) => [report.jsonArtifact, report.pdfArtifact])
        .find((candidate) => candidate.id === req.params.artifactId);
      if (!artifact) throw new AppError('Artifact not found.', 404, 'NOT_FOUND');
      res.type(artifact.mimeType).send(await runtime.artifacts.read(artifact));
    })
  );

  router.get(
    '/jobs',
    asyncHandler(async (req, res) => {
      res.json({ success: true, data: await runtime.jobs.list(userIdFrom(req)) });
    })
  );

  router.get(
    '/jobs/:jobId',
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        data: await runtime.jobs.get(userIdFrom(req), String(req.params.jobId)),
      });
    })
  );

  router.post(
    '/tasks',
    asyncHandler(async (req, res) => {
      const parsed = workflowTaskRequestSchema.parse({ ...req.body, userId: userIdFrom(req) });
      const run = await runtime.workflows.start(parsed);
      res.status(201).json({ success: true, data: run });
    })
  );

  router.get(
    '/runs/:runId',
    asyncHandler(async (req, res) => {
      const run = await runtime.workflows.get(
        userIdFrom(req),
        String(req.params.runId)
      );
      res.json({ success: true, data: run });
    })
  );

  router.post(
    '/runs/:runId/approve',
    asyncHandler(async (req, res) => {
      const run = await runtime.workflows.approve(
        userIdFrom(req),
        String(req.params.runId)
      );
      res.json({ success: true, data: run });
    })
  );

  router.post(
    '/runs/:runId/reject',
    asyncHandler(async (req, res) => {
      const run = await runtime.workflows.reject(
        userIdFrom(req),
        String(req.params.runId),
        typeof req.body.reason === 'string' ? req.body.reason : undefined
      );
      res.json({ success: true, data: run });
    })
  );

  router.post(
    '/runs/:runId/cancel',
    asyncHandler(async (req, res) => {
      const run = await runtime.workflows.cancel(
        userIdFrom(req),
        String(req.params.runId),
        typeof req.body.reason === 'string' ? req.body.reason : undefined
      );
      res.json({ success: true, data: run });
    })
  );

  router.post(
    '/runs/:runId/retry',
    asyncHandler(async (req, res) => {
      const run = await runtime.workflows.retry(
        userIdFrom(req),
        String(req.params.runId)
      );
      res.status(201).json({ success: true, data: run });
    })
  );

  router.get(
    '/runs/:runId/events',
    asyncHandler(async (req, res) => {
      await runtime.assertRunOwner(userIdFrom(req), String(req.params.runId));
      res.json({ success: true, data: await runtime.events(String(req.params.runId)) });
    })
  );
  router.get(
    '/runs/:runId/audit',
    asyncHandler(async (req, res) => {
      await runtime.assertRunOwner(userIdFrom(req), String(req.params.runId));
      res.json({ success: true, data: await runtime.audit(String(req.params.runId)) });
    })
  );
  router.get(
    '/runs/:runId/replay',
    asyncHandler(async (req, res) => {
      await runtime.assertRunOwner(userIdFrom(req), String(req.params.runId));
      res.json({ success: true, data: await runtime.replay(String(req.params.runId)) });
    })
  );
  router.get(
    '/runs/:runId/regression',
    asyncHandler(async (req, res) => {
      await runtime.assertRunOwner(userIdFrom(req), String(req.params.runId));
      res.json({ success: true, data: await runtime.regression(String(req.params.runId)) });
    })
  );

  router.post('/sessions', asyncHandler(async (req, res) => {
    const parsed = createSessionSchema.parse(req.body);
    res.status(201).json({ success: true, data: await runtime.conversations.createSession(userIdFrom(req), parsed.title) });
  }));
  router.get('/sessions/:sessionId', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await runtime.conversations.getSession(userIdFrom(req), String(req.params.sessionId)) });
  }));
  router.get('/sessions/:sessionId/messages', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await runtime.conversations.listMessages(userIdFrom(req), String(req.params.sessionId)) });
  }));
  router.post('/sessions/:sessionId/messages', asyncHandler(async (req, res) => {
    const parsed = agentMessageSchema.parse(req.body);
    res.status(201).json({ success: true, data: await runtime.conversations.sendMessage({
      userId: userIdFrom(req), sessionId: String(req.params.sessionId), content: parsed.content,
      taskInput: parsed.taskInput, idempotencyKey: parsed.idempotencyKey,
    }) });
  }));

  return router;
}
