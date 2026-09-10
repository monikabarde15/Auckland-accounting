/**
 * ACULA (Auckland Accounting Services Ltd) — PM2 Production Process Manager Ecosystem
 * Authoritative Spec: Acula-new.pdf (§47)
 */

module.exports = {
  apps: [
    {
      name: 'acula-api',
      script: 'backend/dist/server.js',
      instances: 'max', // Scale API processes across CPU cores
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      max_memory_restart: '512M',
      kill_timeout: 5000,
      listen_timeout: 8000,
      restart_delay: 1000,
      max_restarts: 10,
      error_file: 'logs/pm2-api-error.log',
      out_file: 'logs/pm2-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true
    },
    {
      name: 'acula-worker',
      script: 'backend/dist/workers/callWorker.js',
      instances: 1, // STRICTLY 1 instance to prevent duplicate queue claiming
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        CALL_WORKER_CONCURRENCY: 5
      },
      max_memory_restart: '512M',
      kill_timeout: 10000, // 10s graceful drain time for active dialing jobs
      restart_delay: 2000,
      max_restarts: 10,
      error_file: 'logs/pm2-worker-error.log',
      out_file: 'logs/pm2-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true
    }
  ]
};
