import { z } from 'zod';
import { google } from 'googleapis';

const TIMEOUT_MS = 30_000;

// Accepts a full Sheets URL or a bare spreadsheet ID
function extractSheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId;
}

async function runWithTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Sheets API request timed out after 30 seconds')),
      TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toError(err) {
  const msg = err?.response?.data?.error?.message ?? err.message ?? 'Unknown error';
  const status = err?.response?.status ?? err?.status ?? null;
  return {
    content: [{ type: 'text', text: status ? `Sheets error ${status}: ${msg}` : `Sheets error: ${msg}` }],
    isError: true,
  };
}

export function registerSheetsTools(server, client) {
  const sheets = google.sheets({ version: 'v4', auth: client });

  // ── 1. sheets_read ─────────────────────────────────────────────────────────
  server.tool(
    'sheets_read',
    'Read data from a Google Sheet. Accepts a full Sheets URL or a bare spreadsheet ID. ' +
    'Returns a 2D array of cell values. Defaults to the full sheet if no range is given.',
    {
      url_or_id: z.string().describe('Google Sheets URL or spreadsheet ID'),
      range: z.string().optional().describe('A1 notation range, e.g. "Sheet1!A1:D50". Defaults to all data.'),
    },
    async ({ url_or_id, range }) => {
      try {
        const spreadsheetId = extractSheetId(url_or_id);
        const res = await runWithTimeout(
          sheets.spreadsheets.values.get({
            spreadsheetId,
            range: range ?? 'A1:ZZ10000',
          })
        );
        return toResult(res.data.values ?? []);
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 2. sheets_write ────────────────────────────────────────────────────────
  server.tool(
    'sheets_write',
    'Write or overwrite data in a Google Sheet at a specific range. ' +
    'Accepts a full Sheets URL or spreadsheet ID. Values are interpreted as if ' +
    'typed by a user (formulas, dates, and numbers are parsed automatically).',
    {
      url_or_id: z.string().describe('Google Sheets URL or spreadsheet ID'),
      range: z.string().describe('A1 notation range to write to, e.g. "Sheet1!A1"'),
      values: z.array(z.array(z.any())).describe('2D array of values to write, e.g. [["Name","Score"],["Alice",95]]'),
    },
    async ({ url_or_id, range, values }) => {
      try {
        const spreadsheetId = extractSheetId(url_or_id);
        await runWithTimeout(
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
          })
        );
        return toResult({ message: `Successfully written to ${range}`, rowsWritten: values.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 3. sheets_append ───────────────────────────────────────────────────────
  server.tool(
    'sheets_append',
    'Append new rows to the end of existing data in a Google Sheet. ' +
    'Rows are added after the last row with content — existing data is never overwritten.',
    {
      url_or_id: z.string().describe('Google Sheets URL or spreadsheet ID'),
      range: z.string().describe('Sheet name or range indicating where to append, e.g. "Sheet1"'),
      values: z.array(z.array(z.any())).describe('2D array of rows to append, e.g. [["Bob",88],["Carol",91]]'),
    },
    async ({ url_or_id, range, values }) => {
      try {
        const spreadsheetId = extractSheetId(url_or_id);
        await runWithTimeout(
          sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
          })
        );
        return toResult({ message: `Successfully appended ${values.length} row${values.length === 1 ? '' : 's'}` });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 4. sheets_info ─────────────────────────────────────────────────────────
  server.tool(
    'sheets_info',
    'Get metadata about a spreadsheet — its title, and for each sheet tab: ' +
    'the name, row count, and column count. Use before reading to confirm sheet names and size.',
    {
      url_or_id: z.string().describe('Google Sheets URL or spreadsheet ID'),
    },
    async ({ url_or_id }) => {
      try {
        const spreadsheetId = extractSheetId(url_or_id);
        const res = await runWithTimeout(
          sheets.spreadsheets.get({ spreadsheetId })
        );
        const info = {
          title: res.data.properties.title,
          spreadsheetId,
          sheets: res.data.sheets.map(s => ({
            title: s.properties.title,
            index: s.properties.index,
            rows:  s.properties.gridProperties.rowCount,
            cols:  s.properties.gridProperties.columnCount,
          })),
        };
        return toResult(info);
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 5. sheets_clear ────────────────────────────────────────────────────────
  server.tool(
    'sheets_clear',
    'Clear all values in a range of cells in a Google Sheet. ' +
    'Cell formatting is preserved — only the content is removed.',
    {
      url_or_id: z.string().describe('Google Sheets URL or spreadsheet ID'),
      range: z.string().describe('A1 notation range to clear, e.g. "Sheet1!A2:D100"'),
    },
    async ({ url_or_id, range }) => {
      try {
        const spreadsheetId = extractSheetId(url_or_id);
        await runWithTimeout(
          sheets.spreadsheets.values.clear({ spreadsheetId, range })
        );
        return toResult({ message: `Cleared range ${range}` });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
