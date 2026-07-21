export const openApiDocument = {
  openapi: '3.1.0',
  info: { title: 'ArtScape Backend API', version: '1.0.0' },
  servers: [{ url: '/api/v1/artscape' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', required: ['success', 'error'], properties: { success: { const: false }, error: { type: 'object' } } },
      WorkflowRun: { type: 'object', required: ['id', 'status', 'currentState', 'statePath'], properties: { id: { type: 'string' }, status: { enum: ['running', 'waiting_human', 'completed', 'failed', 'cancelled'] }, currentState: { type: 'string' }, statePath: { type: 'array', items: { type: 'string' } } } },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/status': { get: { summary: 'Runtime capabilities and persistence mode', responses: { '200': { description: 'OK' } } } },
    '/imports': { post: { summary: 'Validate an XLSX portfolio import', responses: { '201': { description: 'Parsed' }, '415': { description: 'Invalid file' } } } },
    '/tasks': { post: { summary: 'Start a governed same-Run workflow', responses: { '201': { description: 'Started or waiting for review' } } } },
    '/runs/{runId}': { get: { summary: 'Get workflow state', parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Workflow run' } } } },
    '/runs/{runId}/approve': { post: { summary: 'Approve and resume the same Run', parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Resumed' } } } },
    '/sessions': { post: { summary: 'Create an Agent session', responses: { '201': { description: 'Created' } } } },
    '/sessions/{sessionId}/messages': { get: { summary: 'List session messages', responses: { '200': { description: 'Messages' } } }, post: { summary: 'Route an Agent request to a constrained workflow', responses: { '201': { description: 'Accepted' } } } },
    '/reports': { post: { summary: 'Create immutable JSON and PDF report artifacts', responses: { '201': { description: 'Created' } } } },
  },
} as const;
