// ---------------------------------------------------------------------
// Demo user directory + subsidiary -> ERP mapping. Shared between the
// frontend's mock mode and reference-server, same "one source of truth"
// pattern already used for invoices in mockData.js (see README).
//
// DEMO CREDENTIALS ARE NOT REAL. Plaintext passwords below exist only so
// a POC demo can log in as each role in two seconds. A real deployment
// needs real user provisioning, hashed passwords, and ideally SSO
// against whatever the company already uses for Odoo/D365 — none of that is
// built here. See README "What's genuinely open" for the full list.
//
// Subsidiary scoping: users below have no enforced `subsidiary` field.
// Whether roles should be scoped per-subsidiary (an Acme Fresh reviewer
// only seeing Acme Fresh invoices) vs. group-wide is a real open question
// — not decided here, so
// nothing here assumes an answer either way.
// ---------------------------------------------------------------------

import { ROLE_LABEL, ROLE_IDS } from "./status.js";

export const DEMO_USERS = [
  { id: "u_reviewer", name: "Dana R.", username: "reviewer", password: "demo1234", role: "reviewer" },
  { id: "u_approver", name: "Jordan A.", username: "approver", password: "demo1234", role: "approver" },
  {
    id: "u_vta",
    name: "Morgan F.",
    username: "vendor_admin",
    password: "demo1234",
    role: "vendor_tolerance_admin",
  },
  { id: "u_auditor", name: "Casey N.", username: "auditor", password: "demo1234", role: "auditor" },
  { id: "u_sysadmin", name: "IT Admin", username: "admin", password: "demo1234", role: "system_admin" },
];

// Working copy — mutated in place by admin actions, same pattern as
// MOCK_INVOICES in mockData.js.
const users = DEMO_USERS.map((entry) => ({ ...entry }));

function publicUser(record) {
  // Never hand the password back to the client, mock mode or not.
  // eslint-disable-next-line no-unused-vars
  const { password: _password, ...rest } = record;
  return { ...rest, roleLabel: ROLE_LABEL[record.role] };
}

export function findUserByCredentials(username, password) {
  const match = users.find((u) => u.username === username && u.password === password);
  return match ? publicUser(match) : null;
}

export function findUserById(id) {
  const match = users.find((u) => u.id === id);
  return match ? publicUser(match) : null;
}

export function listUsers() {
  return users.map(publicUser);
}

export function updateUserRole(id, role, actingUserId) {
  if (!ROLE_IDS.includes(role)) throw new Error(`Unknown role: ${role}`);
  if (id === actingUserId) {
    throw new Error("You can't change your own role — ask another System Admin.");
  }
  const match = users.find((u) => u.id === id);
  if (!match) return null;
  match.role = role;
  return publicUser(match);
}

// ---------------------------------------------------------------------
// Subsidiary -> ERP mapping. Acme Fresh/Odoo is
// the one confirmed pairing project-wide. Everything else starts
// unconfirmed rather than guessed, per the standing "never guess ERP
// specifics" rule — this table is where that gets resolved for real,
// not assumed.
// ---------------------------------------------------------------------

const subsidiaryMap = [
  { subsidiary: "Acme Fresh", erp: "odoo", confirmed: true },
  { subsidiary: "Acme Stores", erp: null, confirmed: false },
];

export function listSubsidiaryMap() {
  return subsidiaryMap.map((row) => ({ ...row }));
}

export function upsertSubsidiaryMap(subsidiary, erp, confirmed) {
  if (!subsidiary || !subsidiary.trim()) throw new Error("Subsidiary name is required.");
  if (erp !== null && erp !== "odoo" && erp !== "d365") {
    throw new Error(`Unknown ERP: ${erp}`);
  }
  const existing = subsidiaryMap.find((row) => row.subsidiary === subsidiary);
  if (existing) {
    existing.erp = erp;
    existing.confirmed = !!confirmed;
    return { ...existing };
  }
  const row = { subsidiary, erp, confirmed: !!confirmed };
  subsidiaryMap.push(row);
  return { ...row };
}
