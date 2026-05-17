/**
 * Browser OAuth flow for Google APIs — v1 (self-credentials).
 *
 * First run: opens a browser, captures the OAuth callback on a local HTTP
 * server, exchanges the code for tokens, and saves them to disk.
 *
 * Subsequent runs: loads the saved token silently and refreshes if needed.
 *
 * Prerequisites: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars,
 * configured as a Desktop app OAuth client in Google Cloud Console.
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import http from 'http';
import open from 'open';

const TOKEN_DIR = join(homedir(), '.google-marketing-mcp');
const TOKEN_PATH = join(TOKEN_DIR, 'token.json');
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// v1 scopes — sensitive only, no restricted
const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/tagmanager.readonly',
];

function credentialsHelp(missing) {
  return `
Missing ${missing}. To set up your credentials:

1. Go to console.cloud.google.com → APIs & Services → Library
2. Enable these 4 APIs:
   - Google Analytics Data API
   - Google Search Console API
   - Google Sheets API
   - Tag Manager API
3. Go to APIs & Services → Credentials
4. Create OAuth 2.0 Client ID → choose "Desktop app" → name it anything
5. Download the JSON — copy client_id and client_secret
6. Set environment variables:
   export GOOGLE_CLIENT_ID=your_client_id
   export GOOGLE_CLIENT_SECRET=your_client_secret
7. Run again

Full setup guide: https://github.com/generalist-club/google-marketing-stack-mcp#setup`.trim();
}

function requireCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error(`\n${credentialsHelp('GOOGLE_CLIENT_ID')}\n`);
    process.exit(1);
  }
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) {
    console.error(`\n${credentialsHelp('GOOGLE_CLIENT_SECRET')}\n`);
    process.exit(1);
  }
  return { clientId, clientSecret };
}

function makeClient(redirectUri = 'http://localhost') {
  const { clientId, clientSecret } = requireCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function loadSavedToken() {
  try {
    const raw = await fs.readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveToken(tokens) {
  await fs.mkdir(TOKEN_DIR, { recursive: true });
  // 0o600 = owner read/write only — never world-readable
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function wireAutoRefresh(oauth2Client) {
  oauth2Client.on('tokens', async (newTokens) => {
    const current = await loadSavedToken() ?? {};
    await saveToken({ ...current, ...newTokens });
  });
}

async function runBrowserFlow() {
  let resolveCode, rejectCode;
  const codePromise = new Promise((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // Ignore favicon and other incidental browser requests
    if (url.pathname !== '/') {
      res.writeHead(204).end();
      return;
    }

    const googleError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    if (googleError) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(cancelledHtml());
      server.close();
      rejectCode(new Error('Login cancelled or access denied. Run again to retry.'));
      return;
    }

    // Reject callbacks that don't carry the state we sent — prevents auth code injection
    if (returnedState !== state) {
      res.writeHead(400).end('Invalid state parameter.');
      return;
    }

    if (!code) {
      res.writeHead(400).end('Missing authorization code.');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(successHtml());

    // Let the response flush before closing the server
    setTimeout(() => {
      server.close();
      resolveCode(code);
    }, 200);
  });

  server.on('error', (err) => {
    rejectCode(new Error(`Local auth server error: ${err.message}`));
  });

  // Port 0 asks the OS to assign any free port
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();
  const redirectUri = `http://localhost:${port}`;

  // Hard ceiling — clean exit, never hangs silently
  const timeoutId = setTimeout(() => {
    server.close();
    rejectCode(new Error('Login timed out after 5 minutes. Run again to retry.'));
  }, AUTH_TIMEOUT_MS);

  codePromise.finally(() => clearTimeout(timeoutId));

  return { codePromise, redirectUri, state };
}

export async function getAuthenticatedClient() {
  const saved = await loadSavedToken();

  if (saved) {
    const oauth2Client = makeClient(); // redirect URI not needed post-exchange
    oauth2Client.setCredentials(saved);

    const nearExpiry = saved.expiry_date && saved.expiry_date < Date.now() + 60_000;

    if (nearExpiry && saved.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await saveToken({ ...saved, ...credentials });
        oauth2Client.setCredentials({ ...saved, ...credentials });
      } catch {
        // Refresh token revoked — clear and start a fresh login
        console.error('Stored credentials could not be refreshed. Starting a new login.\n');
        await clearToken();
        return getAuthenticatedClient();
      }
    }

    wireAutoRefresh(oauth2Client);
    return oauth2Client;
  }

  // No saved token — open the browser and capture the callback locally
  const { codePromise, redirectUri, state } = await runBrowserFlow();
  const oauth2Client = makeClient(redirectUri);

  // state was generated inside runBrowserFlow and is validated on the callback (CSRF protection)
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Always request a refresh token
    state,
  });

  console.error('\nOpening browser for Google login...');
  console.error('If the browser does not open, visit this URL manually:\n');
  console.error(`  ${authUrl}\n`);

  await open(authUrl);
  console.error('Waiting for login to complete in the browser...\n');

  let code;
  try {
    code = await codePromise;
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }

  let tokens;
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch (err) {
    console.error(`\nFailed to complete login: ${err.message}`);
    console.error('Check that your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are correct.\n');
    process.exit(1);
  }

  await saveToken(tokens);
  oauth2Client.setCredentials(tokens);
  wireAutoRefresh(oauth2Client);

  console.error('Authenticated. Starting MCP server...\n');
  return oauth2Client;
}

export async function clearToken() {
  try {
    await fs.unlink(TOKEN_PATH);
  } catch {
    // File may already be absent
  }
}

function successHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected — Google Marketing Stack</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { text-align: center; padding: 48px; background: white;
            border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); max-width: 400px; }
    .icon { font-size: 2.5rem; }
    h1 { font-size: 1.4rem; margin: 12px 0 8px; }
    p { color: #6b7280; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>You're connected.</h1>
    <p>Google login complete. You can close this tab and return to Claude.</p>
  </div>
</body>
</html>`;
}

function cancelledHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cancelled — Google Marketing Stack</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { text-align: center; padding: 48px; background: white;
            border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); max-width: 400px; }
    h1 { font-size: 1.4rem; margin: 12px 0 8px; }
    p { color: #6b7280; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Login cancelled.</h1>
    <p>Close this tab and run the server again to try again.</p>
  </div>
</body>
</html>`;
}
