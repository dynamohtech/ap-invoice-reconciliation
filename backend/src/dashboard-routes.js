import express from 'express';
import { requireAuth } from './auth/middleware.js';
import { computeStats } from './invoices/repository.js';

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/stats', async (req, res, next) => {
  try {
    res.json(await computeStats());
  } catch (err) { next(err); }
});
