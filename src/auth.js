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
  const state = randomUUID();
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

// Official Generalist Club logo (transparent PNG, inlined so the page works offline)
const LOGO_DATA_URI = 'data:image/png;base64,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';

function pageHtml({ title, tone, mark, heading, body, extra = '' }) {
  const accent = tone === 'ok' ? '#7fd1a8' : '#f0b36a';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Google Marketing Stack</title>
  <style>
    /* Generalist Club direction: night-sky charcoal, forest green, serif display with italic accent */
    :root { --ink:#17191c; --forest:#1d4535; --paper:#f1efe9; --muted:#9aa5a0; --line:rgba(241,239,233,.12);
            --accent:${accent}; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           padding: 24px; color: var(--paper); overflow-x: hidden; position: relative;
           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: radial-gradient(120% 90% at 85% 0%, #1f5a45 0%, var(--forest) 30%, var(--ink) 75%); }
    /* the star: a soft glow with a thin diagonal ray */
    body::before { content:''; position: fixed; top: -140px; right: -140px; width: 520px; height: 520px;
                   background: radial-gradient(circle, rgba(255,244,214,.55) 0%, rgba(255,244,214,.12) 22%, transparent 60%);
                   pointer-events: none; }
    body::after { content:''; position: fixed; top: -40px; right: 80px; width: 1px; height: 120vh;
                  background: linear-gradient(to bottom, rgba(255,244,214,.5), transparent 70%);
                  transform: rotate(18deg); transform-origin: top; pointer-events: none; }
    main { position: relative; z-index: 1; width: 100%; max-width: 520px; padding: 44px 40px 32px;
           background: rgba(23,25,28,.72); backdrop-filter: blur(14px);
           border: 1px solid var(--line); border-radius: 20px; }
    .brand { display:flex; align-items:center; justify-content:space-between; gap:12px;
             margin-bottom: 36px; }
    .brand img { height: 34px; width: auto; display:block; }
    .brand span { font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; color: var(--muted); }
    .mark { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px;
            border-radius:50%; border:1px solid var(--accent); color: var(--accent);
            font-size:1rem; margin-bottom: 18px; }
    h1 { font-family: 'Instrument Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
         font-weight: 400; font-size: 3rem; line-height: 1.02; letter-spacing: -.01em; margin: 0 0 14px; }
    h1 em { color: var(--accent); }
    p.lead { color: #c9cfcb; margin: 0; line-height: 1.55; font-size: 1.02rem; }
    h2 { font-size:.7rem; letter-spacing:.14em; text-transform:uppercase; color: var(--muted);
         font-weight: 600; margin: 34px 0 10px; }
    ul { margin:0; padding:0; list-style:none; }
    ul li { padding: 11px 0; font-size:.95rem; display:flex; justify-content:space-between; gap:12px;
         border-top: 1px solid var(--line); }
    ul li:last-child { border-bottom: 1px solid var(--line); }
    ul li span { color: var(--muted); font-size:.85rem; }
    ol { margin:0; padding-left: 20px; color:#c9cfcb; font-size:.95rem; line-height:1.75; }
    code { font-size:.85em; background: rgba(241,239,233,.08); padding: 2px 6px; border-radius: 5px; }
    .foot { margin-top: 30px; font-size:.78rem; color: var(--muted); line-height:1.5; }
    a { color: var(--paper); }
    @media (max-width: 480px) { main { padding: 32px 24px 24px; } h1 { font-size: 2.4rem; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><img src="${LOGO_DATA_URI}" alt="Generalist Club"><span>Marketing Stack</span></div>
    <div class="mark">${mark}</div>
    <h1>${heading}</h1>
    <p class="lead">${body}</p>
    ${extra}
  </main>
</body>
</html>`;
}

function successHtml() {
  return pageHtml({
    title: 'Connected',
    tone: 'ok',
    mark: '&#10003;',
    heading: 'Curiosity, <em>connected.</em>',
    body: 'Google login complete. You can close this tab and head back to Claude.',
    extra: `
    <h2>Access granted</h2>
    <ul>
      <li>Google Analytics 4 <span>read-only</span></li>
      <li>Search Console <span>read-only</span></li>
      <li>Tag Manager <span>read-only</span></li>
      <li>Google Sheets <span>read &amp; write</span></li>
    </ul>
    <h2>Next</h2>
    <ol>
      <li>In Claude, reconnect the server if it still shows as failed.</li>
      <li>Ask away, try <code>top search queries last month</code>.</li>
    </ol>
    <p class="foot">Your login is stored only on this computer. Revoke access any time at
      <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>.</p>`,
  });
}

function cancelledHtml() {
  return pageHtml({
    title: 'Cancelled',
    tone: 'warn',
    mark: '!',
    heading: 'Login <em>cancelled.</em>',
    body: 'No access was granted. Close this tab, then reconnect the server in Claude to try again.',
    extra: `<p class="foot">Tip: finish the Google sign-in within 5 minutes, or the login window closes.</p>`,
  });
}
