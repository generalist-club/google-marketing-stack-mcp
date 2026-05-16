/**
 * One-off auth test — not part of the package, safe to delete after use.
 * Run with: node test-auth.js
 */

import { getAuthenticatedClient } from './src/auth.js';
import { google } from 'googleapis';
import { homedir } from 'os';
import { join } from 'path';

const TOKEN_PATH = join(homedir(), '.google-marketing-mcp', 'token.json');

try {
  const client = await getAuthenticatedClient();

  // Confirm the token works by fetching the connected account's email
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  // Confirm the token file exists and has correct permissions
  const { promises: fs } = await import('fs');
  const stat = await fs.stat(TOKEN_PATH);
  const mode = (stat.mode & 0o777).toString(8);

  console.log(`Auth successful — token saved`);
  console.log(`Account : ${data.email}`);
  console.log(`Token   : ${TOKEN_PATH}`);
  console.log(`Mode    : ${mode} (should be 600)`);
} catch (err) {
  console.error(`Auth failed: ${err.message}`);
  process.exit(1);
}
