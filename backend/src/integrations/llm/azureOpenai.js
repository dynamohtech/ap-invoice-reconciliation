// Azure OpenAI-based extraction — the alternative provider ("Copilot" isn't
// itself a callable API; this and Azure AI Document Intelligence are the two
// real Microsoft-side options. This one was picked over Document
// Intelligence to match Gemini's approach: a general vision-LLM prompted
// with a schema, so extract.js can treat both providers identically.
//
// Auth: API key by default (simplest for local testing — one value in
// .env). AZURE_OPENAI_USE_MANAGED_IDENTITY=true switches to
// @azure/identity's DefaultAzureCredential for production, where a key
// sitting in an env file is a bigger liability.

import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

let client = null;
function getClient() {
  const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_USE_MANAGED_IDENTITY } = process.env;
  if (!AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_DEPLOYMENT) {
    throw new Error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT must be configured.');
  }
  if (client) return client;

  if (AZURE_OPENAI_USE_MANAGED_IDENTITY === 'true') {
    const azureADTokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default');
    client = new AzureOpenAI({ endpoint: AZURE_OPENAI_ENDPOINT, azureADTokenProvider, apiVersion: '2025-04-01-preview', deployment: AZURE_OPENAI_DEPLOYMENT });
  } else {
    if (!AZURE_OPENAI_API_KEY) throw new Error('AZURE_OPENAI_API_KEY is not configured (or set AZURE_OPENAI_USE_MANAGED_IDENTITY=true).');
    client = new AzureOpenAI({ endpoint: AZURE_OPENAI_ENDPOINT, apiKey: AZURE_OPENAI_API_KEY, apiVersion: '2025-04-01-preview', deployment: AZURE_OPENAI_DEPLOYMENT });
  }
  return client;
}

const JSON_SCHEMA = {
  name: 'invoice_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      readable: { type: 'boolean', description: 'False if too blurry/dark/cut off to extract reliably.' },
      invoice_number: { type: ['string', 'null'] },
      invoice_date: { type: ['string', 'null'], description: 'ISO 8601 date, YYYY-MM-DD' },
      po_number: {
        type: ['string', 'null'],
        description: 'Purchase order number, if printed anywhere on the invoice — for cross-checking only. The PO the uploader entered is what this invoice is actually matched against.',
      },
      subtotal: { type: ['number', 'null'] },
      tax_amount: { type: ['number', 'null'] },
      total_amount: { type: ['number', 'null'] },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            product_code: { type: ['string', 'null'] },
            quantity: { type: 'number' },
            unit_price: { type: 'number' },
            line_total: { type: 'number' },
          },
          required: ['description', 'product_code', 'quantity', 'unit_price', 'line_total'],
          additionalProperties: false,
        },
      },
      confidence_notes: { type: 'string' },
    },
    required: ['readable', 'invoice_number', 'invoice_date', 'po_number', 'subtotal', 'tax_amount', 'total_amount', 'line_items', 'confidence_notes'],
    additionalProperties: false,
  },
};

const PROMPT = `You are extracting structured data from a supplier invoice for an accounts-payable system. Read the attached document carefully.

Rules:
- Extract exactly what is printed. Never guess a number you cannot actually read — if a field is illegible, return null for it and say so in confidence_notes.
- Many of these invoices will NOT print a PO number at all — that's expected, not an extraction failure. Return null for po_number if none appears anywhere on the document.
- line_items must reflect every line on the invoice, in order.
- If the document is too blurry, dark, rotated, or cut off to extract with confidence, set readable to false and explain why in confidence_notes — do not attempt to guess values on an unreadable document.
- Amounts are numbers, not strings (no currency symbols or thousands separators).`;

export async function extractWithAzureOpenAI({ buffer, mimeType }) {
  const openai = getClient();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  const response = await openai.chat.completions.create({
    model: deployment,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
  });

  const parsed = JSON.parse(response.choices[0].message.content);
  return { ...parsed, _provider: 'azure_openai', _model: deployment, _raw: parsed };
}
