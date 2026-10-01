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

  // 0. Trust proxy — REQUIRED for Render.com, Railway, Heroku, and all cloud platforms
  // Allows Express to correctly read X-Forwarded-Proto (https) and X-Forwarded-For (real IP)
  // Without this, req.protocol = 'http' even when behind HTTPS load balancer
  app.set('trust proxy', 1);

  // 1. Security Headers
  const helmetFn: any = typeof helmet === 'function' ? helmet : (helmet as any).default || helmet;
  app.use(helmetFn());

  // 2. CORS setup
  const corsOptions: cors.CorsOptions = {
    origin: (requestOrigin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!requestOrigin) return callback(null, true);

      const configuredOrigin = process.env.CORS_ORIGIN;
      if (
        !configuredOrigin ||
        configuredOrigin === '*' ||
        configuredOrigin === 'true' ||
        requestOrigin.endsWith('.vercel.app') ||
        requestOrigin.includes('localhost') ||
        requestOrigin.includes('127.0.0.1') ||
        (configuredOrigin && configuredOrigin.split(',').map((s) => s.trim()).includes(requestOrigin))
      ) {
        return callback(null, true);
      }

      // Allow all for demo purposes
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Set-Cookie']
  };

  app.use(cors(corsOptions));

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
