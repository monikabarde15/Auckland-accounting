import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestIdMiddleware } from './middleware/requestId.js';
import { httpLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { groupsRouter } from './routes/groups.js';
import { dncRouter } from './routes/dnc.js';
import campaignsRouter from './routes/campaigns.js';
import questionnairesRouter from './routes/questionnaires.js';
import { voiceRouter } from './routes/voice.js';
import { callsRouter } from './routes/calls.js';
import { reportsRouter } from './routes/reports.js';
import { rolesRouter } from './routes/roles.js';

export function createApp(): Express {
  const app = express();

  // 1. Security Headers
  app.use(helmet());

  // 2. CORS setup
  app.use(cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }));

  // 3. Body parsers & Cookie parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // 4. Request ID & Logging
  app.use(requestIdMiddleware);
  app.use(httpLogger);

  // 5. Root route
  app.get('/', (_req, res) => {
    res.json({
      service: 'Acula Telephony & IVR API',
      status: 'online',
      documentation: '/api/health'
    });
  });

  // 6. API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/contacts/groups', groupsRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/dnc', dncRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/questionnaires', questionnairesRouter);
  app.use('/api/voice', voiceRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/reports', reportsRouter);

  // 7. 404 & Centralized Error Handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
