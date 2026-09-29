// Gemini-based invoice extraction.
//
// Model name is intentionally NOT hardcoded to one specific version — Gemini
// model names move fast (gemini-2.5-flash, gemini-3-flash-preview, and
// gemini-3.7-flash all appear in Google's own current docs as this was
// written). Set GEMINI_MODEL in .env; check
// https://ai.google.dev/gemini-api/docs/models for whatever is current and
// cost-appropriate when you deploy. The "flash" tier (not "pro") is the
// right default for this workload — 10,000+ invoices/month is a
// classification+extraction task, not one needing the heaviest reasoning
// model, and the cost difference compounds fast at that volume.

import { GoogleGenAI, Type } from '@google/genai';

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    readable: { type: Type.BOOLEAN, description: 'False if the document is too blurry, dark, or cut off to extract reliably.' },
    invoice_number: { type: Type.STRING, nullable: true },
    invoice_date: { type: Type.STRING, description: 'ISO 8601 date, YYYY-MM-DD', nullable: true },
    po_number: {
      type: Type.STRING,
      nullable: true,
      description: 'Purchase order number, if printed anywhere on the invoice — for cross-checking only. The PO the uploader entered is what this invoice is actually matched against.',
    },
    subtotal: { type: Type.NUMBER, nullable: true },
    tax_amount: { type: Type.NUMBER, nullable: true },
    total_amount: { type: Type.NUMBER, nullable: true },
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          product_code: { type: Type.STRING, nullable: true },
          quantity: { type: Type.NUMBER },
          unit_price: { type: Type.NUMBER },
          line_total: { type: Type.NUMBER },
        },
        required: ['description', 'quantity', 'unit_price', 'line_total'],
      },
    },
    confidence_notes: { type: Type.STRING, description: 'Anything uncertain, illegible, or guessed — empty string if fully confident.' },
  },
  required: ['readable', 'line_items', 'confidence_notes'],
};

const PROMPT = `You are extracting structured data from a supplier invoice for an accounts-payable system. Read the attached document carefully.

Rules:
- Extract exactly what is printed. Never guess a number you cannot actually read — if a field is illegible, omit it (leave it null) and say so in confidence_notes.
- Many of these invoices will NOT print a PO number at all — that's expected, not an extraction failure. Leave po_number null if none appears anywhere on the document.
- line_items must reflect every line on the invoice, in order.
- If the document is too blurry, dark, rotated, or cut off to extract with confidence, set readable to false and explain why in confidence_notes — do not attempt to guess values on an unreadable document.
- Amounts are numbers, not strings (no currency symbols or thousands separators).`;

export async function extractWithGemini({ buffer, mimeType }) {
  const ai = getClient();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [{ text: PROMPT }, { inlineData: { mimeType, data: buffer.toString('base64') } }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
    },
  });

  const parsed = JSON.parse(response.text);
  return { ...parsed, _provider: 'gemini', _model: model, _raw: parsed };
}
