import express from 'express';
import multer from 'multer';
import { requireAuth, forbidRole, requireRole } from '../auth/middleware.js';
import { readFile, saveFile } from '../upload/storage.js';
import {
  listInvoices,
  getInvoiceById,
  getFilterOptions,
  approveInvoice,
  rejectInvoice,
  requestInfo,
  addComment,
  updateDueDate,
  createInvoiceFromPOLookup,
  refreshPurchaseOrder,
} from './repository.js';
import { pool } from '../db.js';
import { processInvoiceAsync } from '../integrations/llm/extract.js';
import { lookupPOForUpload as lookupD365PO } from '../integrations/d365/client.js';
import { lookupPOForUpload as lookupOdooPO } from '../integrations/odoo/client.js';

export const invoicesRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

invoicesRouter.use(requireAuth);

// Order matters below: literal paths (/filter-options, /upload) must come
// before the /:id catch-all, or Express will try to treat "filter-options"
// or "upload" as an invoice id.

invoicesRouter.get('/filter-options', async (req, res, next) => {
  try {
    res.json(await getFilterOptions());
  } catch (err) { next(err); }
});

/**
 * The uploader supplies ONLY a PO number + the file — no vendor name, no
 * subsidiary. Both D365 and Odoo are tried (a PO number alone doesn't say
 * which ERP it came from, and asking the uploader to pick defeats the point
 * of this simplification) — whichever one actually has that PO answers with
 * vendor name, subsidiary/store, and the line items in one round trip. If
 * NEITHER has it, that's a real, immediate validation error (likely a typo)
 * — better to say so now than to create an invoice nothing can ever match.
 */
invoicesRouter.post('/upload', forbidRole('auditor'), upload.single('file'), async (req, res, next) => {
  try {
    const { po_number } = req.body || {};
    if (!po_number) return res.status(400).json({ error: 'po_number is required.' });
    if (!req.file) return res.status(400).json({ error: 'A file is required.' });

    // Each ERP is tried independently — one being unreachable/unconfigured
    // must not stop the other from being checked (e.g. only Odoo
    // credentials are set up so far during local testing). Only escalate to
    // a "can't reach the ERP" error if BOTH genuinely failed; a clean "not
    // found" from one while the other works is the normal case, not an
    // error.
    let erpResult = null;
    let d365Error = null;
    let odooError = null;
    try {
      erpResult = await lookupD365PO(po_number);
    } catch (err) {
      d365Error = err;
    }
    if (!erpResult) {
      try {
        erpResult = await lookupOdooPO(po_number);
      } catch (err) {
        odooError = err;
      }
    }

    if (!erpResult) {
      if (d365Error && odooError) {
        return next(
          Object.assign(new Error(`Could not reach either ERP system. D365: ${d365Error.message} | Odoo: ${odooError.message}`), { status: 502 })
        );
      }
      return res.status(404).json({ error: `PO "${po_number}" was not found in either D365 or Odoo. Check the number and try again.` });
    }

    const fileStorageKey = await saveFile(req.file.buffer, req.file.originalname);

    const inv = await createInvoiceFromPOLookup({
      poNumber: po_number,
      erpResult,
      fileStorageKey,
      fileMimeType: req.file.mimetype,
      actor: req.user,
    });

    res.status(201).json(inv);

    // Extraction runs AFTER the response is sent — the fast/reliable part
    // (the PO lookup above) already happened synchronously; only the LLM
    // call, which is slower and occasionally flaky, is deferred, so it never blocks
    // the request.
    processInvoiceAsync(inv.id, { buffer: req.file.buffer, mimeType: req.file.mimetype }).catch((err) =>
      console.error(`[extraction] invoice ${inv.id} failed:`, err)
    );
  } catch (err) { next(err); }
});

// GET /api/invoices — existing filters (subsidiary, erp_source, severity,
// status, vendor) plus invoice_number and po_number, added so the finance
// team can search for a specific past invoice or PO.
// All optional, combine with AND — same pattern as before, so the only
// frontend change needed is two more inputs in FilterBar.jsx.
invoicesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listInvoices(req.query));
  } catch (err) { next(err); }
});

invoicesRouter.get('/:id', async (req, res, next) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) { next(err); }
});

// Serves the original uploaded file. Any authenticated role may view it —
// same set of roles that can already see the invoice's extracted data.
invoicesRouter.get('/:id/file', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT file_storage_key, file_mime_type FROM invoices WHERE id = $1', [req.params.id]);
    const row = rows[0];
    if (!row?.file_storage_key) return res.status(404).json({ error: 'No file on this invoice.' });
    const buf = await readFile(row.file_storage_key);
    res.set('Content-Type', row.file_mime_type || 'application/octet-stream');
    res.send(buf);
  } catch (err) { next(err); }
});

// approve / reject / request-info / comments: forbidRole('auditor') applied
// here — see the note in auth/middleware.js on why this differs from the
// reference-server, which left these four routes ungated.
invoicesRouter.post('/:id/approve', forbidRole('auditor'), async (req, res, next) => {
  try {
    const inv = await approveInvoice(req.params.id, { comment: req.body?.comment, actor: req.user });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) { next(err); }
});

invoicesRouter.post('/:id/reject', forbidRole('auditor'), async (req, res, next) => {
  try {
    if (!req.body?.reason) return res.status(400).json({ error: 'A rejection reason is required.' });
    const inv = await rejectInvoice(req.params.id, { reason: req.body.reason, comment: req.body.comment, actor: req.user });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) { next(err); }
});

invoicesRouter.post('/:id/request-info', forbidRole('auditor'), async (req, res, next) => {
  try {
    const inv = await requestInfo(req.params.id, { comment: req.body?.comment, actor: req.user });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) { next(err); }
});

invoicesRouter.post('/:id/comments', forbidRole('auditor'), async (req, res, next) => {
  try {
    const inv = await addComment(req.params.id, req.body?.note, req.user);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) { next(err); }
});

invoicesRouter.patch('/:id/due-date', requireRole('system_admin'), async (req, res, next) => {
  try {
    const inv = await updateDueDate(req.params.id, req.body?.due_date, req.user);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Manual, on-demand PO refresh — see repository.js's refreshPurchaseOrder
// for what this does and doesn't change (never rewrites the GRN
// comparison; never retroactively touches other invoices against the same
// PO). Same auditor restriction as the other invoice-mutating actions —
// this changes stored comparison state, even though it's not a
// status-changing action like approve/reject.
invoicesRouter.post('/:id/refresh-po', forbidRole('auditor'), async (req, res, next) => {
  try {
    const inv = await refreshPurchaseOrder(req.params.id, req.user);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});
