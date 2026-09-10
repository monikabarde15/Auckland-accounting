import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'jwt',
      'secret',
      'refreshToken',
      'accessToken',
      'newPassword',
      'tokenHash',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.rawToken',
      '*.refreshToken',
      '*.accessToken',
      '*.newPassword',
      '*.tokenHash'
    ],
    censor: '[REDACTED]'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as { id?: string }).id || 'req-unknown',
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params
    }),
    res: (res) => ({
      statusCode: res.statusCode
    })
  }
});
