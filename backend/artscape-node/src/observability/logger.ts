import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'authorization',
      'password',
      'token',
      'apiKey',
      '*.fileBase64',
      '*.positions',
    ],
    censor: '[REDACTED]',
  },
});
