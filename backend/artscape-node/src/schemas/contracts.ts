import { z } from 'zod';

export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, 'Expected a decimal string');

export const ratioStringSchema = decimalStringSchema.refine(
  (value) => Number(value) >= 0 && Number(value) <= 1,
  'Expected a ratio between 0 and 1'
);

export const artPositionInputSchema = z
  .object({
    artworkName: z.string().trim().min(1).max(200),
    artistName: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    nominalValue: decimalStringSchema.refine((value) => Number(value) >= 0),
    baseValue: decimalStringSchema.refine((value) => Number(value) >= 0),
    liquidityLevel: z.enum(['high', 'medium', 'low']),
    liquidityDiscount: ratioStringSchema,
    transactionCostRate: ratioStringSchema,
    artistExpectedReturn: decimalStringSchema.refine(
      (value) => Number(value) > -1 && Number(value) <= 5
    ),
    dataCompleteness: ratioStringSchema,
    currency: z.literal('CNY'),
    dataSource: z.string().trim().min(1).max(300).optional(),
    dataDate: z.string().date().optional(),
  })
  .strict();

export const scenarioCodeSchema = z.enum(['bull', 'neutral', 'bear']);

export const portfolioImportRequestSchema = z
  .object({
    userId: z.string().trim().min(1),
    portfolioName: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const confirmImportSchema = z
  .object({
    userId: z.string().trim().min(1),
    approved: z.literal(true),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const scenarioRunRequestSchema = z
  .object({
    userId: z.string().trim().min(1),
    portfolioVersionId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const candidateRequestSchema = z
  .object({
    userId: z.string().trim().min(1),
    scenarioRunId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const candidateDecisionSchema = z
  .object({
    userId: z.string().trim().min(1),
    decision: z.enum(['accepted', 'modified', 'rejected']),
    idempotencyKey: z.string().trim().min(8),
    proposedPositions: z.array(artPositionInputSchema).optional(),
  })
  .strict();

export const reportRequestSchema = z
  .object({
    userId: z.string().trim().min(1),
    portfolioVersionId: z.string().trim().min(1),
    scenarioRunId: z.string().trim().min(1),
    comparisonId: z.string().trim().min(1).optional(),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const workflowTaskRequestSchema = z
  .object({
    userId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1).optional(),
    taskType: z.enum([
      'task.art-portfolio-intake',
      'task.art-scenario-analysis',
      'task.art-candidate-comparison',
      'task.art-report-export',
    ]),
    input: z.record(z.unknown()),
    idempotencyKey: z.string().trim().min(8),
  })
  .strict();

export const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

export const agentMessageSchema = z.object({
  content: z.string().trim().min(1).max(8_000),
  taskInput: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(8).optional(),
}).strict().refine(
  (value) => !value.taskInput || Boolean(value.idempotencyKey),
  { message: 'idempotencyKey is required when taskInput is supplied.' }
);

export const explanationOutputSchema = z
  .object({
    summary: z.string().min(1).max(1500),
    observations: z.array(z.string().min(1).max(500)).max(8),
    caveats: z.array(z.string().min(1).max(500)).max(8),
  })
  .strict();
