/**
 * One-off auth test — not part of the package, safe to delete after use.
 * Run with: node test-auth.js
 */

import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';
import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

const TOKEN_PATH = join(homedir(), '.google-marketing-mcp', 'token.json');

// override: false — never clobber vars already set in the shell environment
dotenv.config({
  path: '/Users/ajinkyathakare/Claude_code/Ticmint/Growth Intelligence/growth-intelligence/.env',
  override: false,
});

const propertyId = process.env.GA4_PROPERTY_ID?.replace(/^properties\//, '');
if (!propertyId) {
  console.error('GA4_PROPERTY_ID not found in .env or environment — cannot verify GA4');
  process.exit(1);
}

try {
  const auth = await getAuthenticatedClient();

  // 1. Confirm which account is connected
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const { data: userInfo } = await oauth2.userinfo.get();

  // 2. Confirm token file permissions
  const stat = await fs.stat(TOKEN_PATH);
  const mode = (stat.mode & 0o777).toString(8);

  console.log('Auth successful — token saved');
  console.log(`Account : ${userInfo.email}`);
  console.log(`Token   : ${TOKEN_PATH}`);
  console.log(`Mode    : ${mode} (should be 600)`);
  console.log('');

  // 3. Make a real GA4 API call
  console.log(`GA4 property: ${propertyId}`);
  console.log('Running GA4 test report (last 7 days sessions)...');

  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
  const { data: report } = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
    },
  });

  const sessions = report.rows?.[0]?.metricValues?.[0]?.value ?? '0';
  console.log(`Sessions (last 7 days): ${sessions}`);
  console.log('');
  console.log('Phase 1 fully verified — auth works end to end.');

} catch (err) {
  console.error(`\nTest failed: ${err.message}`);
  if (err.status) console.error(`Status: ${err.status}`);
  if (err.errors) console.error(`Errors: ${JSON.stringify(err.errors, null, 2)}`);
  process.exit(1);
}
