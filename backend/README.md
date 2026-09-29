# ap-recon-service

Backend and database for the AP invoice reconciliation app: Express + PostgreSQL, with LLM invoice extraction (Gemini or Azure OpenAI) and purchase-order lookups against Microsoft Dynamics 365 Finance & Operations and Odoo.

## Run it

```bash
docker compose up -d
docker compose exec backend node scripts/seed.js
docker compose exec backend node scripts/smoke-test.js
```

- API: http://localhost:3001 (health check at `/health`)
- Database browser (Adminer): http://localhost:8080 (server `db`, user `postgres`, password `localdev`, database `ap_recon`)
- Demo logins: `reviewer`, `approver`, `vendor_admin`, `auditor`, `admin`, all with password `demo1234`

Migrations run automatically on startup. To use the frontend against this API, set `VITE_API_BASE_URL=http://localhost:3001` in `../frontend/.env`.

## Connect real systems

Copy `.env.example` to `.env`, fill in whichever credentials you have, and restart with `docker compose up -d --build`. Each integration switches on independently once its credentials are set:

- **Uploads need at least one ERP.** An upload is just a PO number plus the invoice file; the PO is looked up in D365 and Odoo, and the upload is rejected if neither has it.
- **Extraction needs an LLM.** Without Gemini or Azure OpenAI configured, uploaded invoices wait in "pending extraction".
- **The seeded demo data needs neither**, so the review screens work straight after `seed.js`.

| Integration | Variables | Where the credentials come from |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | Google AI Studio |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Azure portal, or managed identity |
| Dynamics 365 F&O | `D365_TENANT_ID`, `D365_CLIENT_ID`, `D365_CLIENT_SECRET`, `D365_ENVIRONMENT_URL` | An Entra ID app registration with access to the F&O environment |
| Odoo | `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` | An Odoo user's API key (Preferences → Account Security) |

D365 entity and field names vary between customized environments. Before trusting the D365 side with real invoices, confirm them:

```bash
docker compose exec backend npm run discover-d365 -- <PO-number-with-a-posted-receipt>
```

## Reset to a clean slate

```bash
docker compose down -v   # -v deletes the database volume; omit it for a normal restart
docker compose up -d
docker compose exec backend node scripts/seed.js
```

## Layout

```
src/
  auth/            login, sessions, bcrypt hashing, role middleware
  invoices/        upload, review actions, matching engine
  purchase-orders/ PO cache and refresh
  integrations/    d365/, odoo/ (XML-RPC), llm/ (Gemini, Azure OpenAI)
  reports/         discrepancy, resolution-time and resend reports
  upload/          file storage (local disk; swap for S3 or Blob storage)
db/migrations/     schema, applied in order on startup
scripts/           migrate, seed, smoke-test, discover-d365
```
