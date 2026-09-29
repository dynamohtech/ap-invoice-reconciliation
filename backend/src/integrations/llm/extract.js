// Runs vision-LLM extraction on an uploaded file and matches it against the
// ERP data already stored on the invoice (fetched synchronously at upload
// time — see invoices/routes.js's POST /upload and
// integrations/d365|odoo/client.js's lookupPOForUpload). This step only
// ever does extraction + matching now; it never talks to D365/Odoo itself.
//
// Runs fire-and-forget after the upload response is sent — see
// invoices/routes.js for why this must never run synchronously in the
// request path (LLM calls are the slow, occasionally-flaky part of this
// pipeline; the fast, validate-immediately part is the PO lookup, which
// already happened before this runs).
//
// Deliberately does NOT derive tax_amount as a flat percentage of subtotal
// the way the frontend's mock data does (subtotal * 0.075). Nigeria's VAT stayed at 7.5% in the Jan 2026 tax reform, but
// that same reform zero-rated basic food items, and Acme Stores is a
// grocery retailer — a meaningful share of its real invoices may legitimately
// show 0% VAT now. tax_amount here always comes from what the LLM actually
// read off the document, never a formula.

import { extractWithGemini } from './gemini.js';
import { extractWithAzureOpenAI } from './azureOpenai.js';
import { pool } from '../../db.js';
import { saveExtraction } from '../../invoices/repository.js';

function sumLines(lines) {
  return Math.round(lines.reduce((t, l) => t + Number(l.line_total || 0), 0) * 100) / 100;
}

export async function processInvoiceAsync(invoiceId, { buffer, mimeType }) {
  const provider = process.env.LLM_PROVIDER || 'gemini';
  const extraction =
    provider === 'azure_openai' ? await extractWithAzureOpenAI({ buffer, mimeType }) : await extractWithGemini({ buffer, mimeType });

  if (extraction.readable === false) {
    await markBlurry(invoiceId, extraction.confidence_notes);
    // Automated resend request: the channel for this
    // (email? which address, sourced from where?) is an open item, not
    // something to invent silently. Hook it in here once confirmed.
    return;
  }

  const extracted = {
    subtotal: extraction.subtotal ?? (extraction.line_items?.length ? sumLines(extraction.line_items) : null),
    tax_amount: extraction.tax_amount ?? null,
    total_amount: extraction.total_amount ?? null,
    line_items: extraction.line_items || [],
    confidence_notes: buildConfidenceNotes(extraction),
  };

  await saveExtraction(invoiceId, {
    invoiceNumber: extraction.invoice_number || 'UNKNOWN',
    invoiceDate: extraction.invoice_date || null,
    extracted,
    provider: extraction._provider,
    rawExtraction: extraction._raw,
  });
}

// The uploader's PO number is authoritative for WHICH order this is (that's
// the whole point of the corrected flow), but the document might print a
// different PO number, e.g. a typo at upload, or a vendor referencing their
// own order number instead. Surface that as a note rather than silently
// dropping it — a human glancing at confidence_notes should see it, even
// though it doesn't change which ERP record this was matched against.
function buildConfidenceNotes(extraction) {
  const parts = [];
  if (extraction.confidence_notes) parts.push(extraction.confidence_notes);
  if (extraction.po_number) parts.push(`Document also shows PO/reference "${extraction.po_number}" — confirm this matches the PO entered at upload.`);
  return parts.join(' ');
}

async function markBlurry(invoiceId, note) {
  await pool.query("UPDATE invoices SET status = 'blurry' WHERE id = $1", [invoiceId]);
  await pool.query(
    `INSERT INTO activity_log (invoice_id, type, author_name, author_role, note)
     VALUES ($1, 'system', 'System', 'system', $2)`,
    [invoiceId, `Flagged unreadable: ${note || 'document quality too low to extract.'}`]
  );
}
