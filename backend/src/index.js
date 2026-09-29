import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { authRouter } from './auth/routes.js';
import { invoicesRouter } from './invoices/routes.js';
import { adminRouter } from './admin/routes.js';
import { reportsRouter } from './reports/routes.js';
import { dashboardRouter } from './dashboard-routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { pool } from './db.js';

const PORT = process.env.PORT || 3001;
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// A generous global ceiling so one runaway script/browser tab can't take the
// service down — the login route has its own tighter limit on top of this
// (see auth/routes.js).
app.use(rateLimit({ windowMs: 60 * 1000, max: Number(process.env.GLOBAL_RATE_LIMIT_MAX || 300) }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`ap-recon-service listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing DB pool...');
  await pool.end();
  process.exit(0);
});
