import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';

dotenv.config({
  path: '/Users/ajinkyathakare/Claude_code/Ticmint/Growth Intelligence/growth-intelligence/.env',
  override: false,
});

// Use GOOGLE_SHEET_URL from .env, or fall back to the Ticmint GA4 report sheet
const SHEET_URL =
  process.env.GOOGLE_SHEET_URL ??
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit';

function extractSheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId;
}

const auth = await getAuthenticatedClient();
const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = extractSheetId(SHEET_URL);

// ── 1. sheets_info ─────────────────────────────────────────────────────────
console.log('\n── sheets_info ──');
try {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  console.log(`  Title : ${res.data.properties.title}`);
  console.log(`  ID    : ${spreadsheetId}`);
  console.log(`  Tabs  :`);
  res.data.sheets.forEach(s => {
    console.log(`    • ${s.properties.title.padEnd(30)} ${s.properties.gridProperties.rowCount} rows × ${s.properties.gridProperties.columnCount} cols`);
  });
} catch (err) {
  const msg = err?.response?.data?.error?.message ?? err.message;
  console.error(`  ERROR: ${msg}`);
}

// ── 2. sheets_read — first 5 rows ──────────────────────────────────────────
console.log('\n── sheets_read (first 5 rows) ──');
try {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z5',
  });
  const rows = res.data.values ?? [];
  if (rows.length === 0) {
    console.log('  (no data in A1:Z5)');
  } else {
    rows.forEach((row, i) => console.log(`  Row ${i + 1}: ${row.join(' | ')}`));
  }
} catch (err) {
  const msg = err?.response?.data?.error?.message ?? err.message;
  console.error(`  ERROR: ${msg}`);
}

// ── 3. sheets_append — one test row with timestamp ─────────────────────────
console.log('\n── sheets_append (test row) ──');
try {
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['test-sheets.js', timestamp, 'MCP smoke test']] },
  });
  console.log(`  Appended: ["test-sheets.js", "${timestamp}", "MCP smoke test"]`);
} catch (err) {
  const msg = err?.response?.data?.error?.message ?? err.message;
  console.error(`  ERROR: ${msg}`);
}

console.log('\n✅  Done\n');
