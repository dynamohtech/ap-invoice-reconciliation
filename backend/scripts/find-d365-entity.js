#!/usr/bin/env node
// Confirms real entity/field names against the actual D365 tenant before
// integrations/d365/client.js is trusted with real invoices. This is the
// script ap-recon-frontend's own README already expects to exist
// ("find-d365-entity.js") — run it once real D365 credentials are available.
//
// What it does:
//   1. Authenticates with the configured D365 credentials.
//   2. Fetches $metadata and confirms the three entity sets this backend
//      depends on actually exist under those exact names.
//   3. Pulls one real record from each (if any exist) and prints every field
//      it actually returned — so a human can visually confirm whether a
//      price field genuinely is absent on the Product Receipt Line entity in
//      THIS tenant (Microsoft's public schema says no — see client.js — but
//      a customized environment can add fields, and only the tenant itself
//      can confirm that).
//
// Usage: npm run discover-d365 -- <a-real-PO-number-that-has-been-received>

import 'dotenv/config';

const { D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET, D365_ENVIRONMENT_URL } = process.env;

async function getToken() {
  const res = await fetch(`https://login.microsoftonline.com/${D365_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: D365_CLIENT_ID,
      client_secret: D365_CLIENT_SECRET,
      scope: `${D365_ENVIRONMENT_URL}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const poNumber = process.argv[2];
  if (!D365_TENANT_ID || !D365_CLIENT_ID || !D365_CLIENT_SECRET || !D365_ENVIRONMENT_URL) {
    console.error('Set D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET, D365_ENVIRONMENT_URL in .env first.');
    process.exit(1);
  }
  if (!poNumber) {
    console.error('Usage: npm run discover-d365 -- <PO-number-with-a-goods-receipt-already-posted>');
    process.exit(1);
  }

  console.log(`Authenticating against ${D365_ENVIRONMENT_URL} ...`);
  const token = await getToken();
  console.log('Authenticated.\n');

  const entitySets = ['VendProductReceiptHeaders', 'VendProductReceiptLines', 'PurchaseOrderLinesV2', 'PurchaseOrderHeadersV2'];

  for (const entitySet of entitySets) {
    console.log(`--- ${entitySet} ---`);
    try {
      const url = `${D365_ENVIRONMENT_URL}/data/${entitySet}?$filter=PurchaseOrderNumber eq '${poNumber.replace(/'/g, "''")}'&$top=1`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!res.ok) {
        console.log(`  FAILED (${res.status}): ${(await res.text()).slice(0, 300)}`);
        console.log('  -> This entity set name is likely wrong for this tenant. Check $metadata:');
        console.log(`     ${D365_ENVIRONMENT_URL}/data/$metadata`);
        continue;
      }
      const json = await res.json();
      if (!json.value || json.value.length === 0) {
        console.log(`  OK — entity exists, but no rows matched PO "${poNumber}". Try a PO you know has a posted receipt.`);
        continue;
      }
      console.log('  OK — sample record fields:');
      for (const [key, value] of Object.entries(json.value[0])) {
        console.log(`    ${key}: ${JSON.stringify(value)}`);
      }
      const hasPriceField = Object.keys(json.value[0]).some((k) => /price|amount/i.test(k));
      console.log(`  Contains a price/amount-like field: ${hasPriceField ? 'YES — update client.js, priceUnavailable can become false' : 'no'}`);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }
    console.log();
  }

  console.log('Next step: compare the field names above against src/integrations/d365/client.js');
  console.log('and fix any mismatch before trusting this integration with real invoices.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
