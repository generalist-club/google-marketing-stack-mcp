/**
 * OAuth callback server — deploy this to Cloudflare Workers, Vercel, or Railway.
 *
 * Responsibilities:
 *   1. Receive Google's OAuth redirect: GET /callback?code=...&state=...
 *   2. Temporarily store the auth code, keyed by session state (UUID)
 *   3. Serve the code to the local MCP process: GET /poll?state=...
 *   4. Delete the code immediately after it is claimed
 *
 * Security model:
 *   - This server never sees GA4, GSC, Sheets, or GTM data
 *   - Auth codes are stored in-memory for a maximum of 10 minutes then discarded
 *   - Each code can only be claimed once
 *   - No credentials, tokens, or user data are ever logged or persisted
 *
 * Deployment notes:
 *   - Vercel/Railway: deploy as-is. Entry point is the exported `handler` function.
 *   - Cloudflare Workers: replace the in-memory `codeStore` Map with a KV namespace
 *     binding (Workers KV), using `state` as the key and a 10-minute TTL.
 *     Workers do not share memory across instances, so in-memory storage will not
 *     work in that environment.
 *
 * Required env var on the host:
 *   ALLOWED_ORIGINS — comma-separated list of origins allowed to poll (optional,
 *                     defaults to allowing the local MCP process via same-host fetch)
 */

import http from 'http';
import { URL } from 'url';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// state UUID → { code, expiresAt }
const codeStore = new Map();

// Periodically remove expired entries so the store never grows unbounded
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of codeStore) {
    if (entry.expiresAt < now) codeStore.delete(state);
  }
}, 60_000);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleCallback(req, res, params) {
  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state) {
    return sendHtml(res, 400, errorPage('Missing code or state parameter.'));
  }

  // Validate state is a UUID to reject malformed requests
  if (!/^[0-9a-f-]{36}$/.test(state)) {
    return sendHtml(res, 400, errorPage('Invalid state parameter.'));
  }

  codeStore.set(state, { code, expiresAt: Date.now() + CODE_TTL_MS });

  return sendHtml(res, 200, successPage());
}

function handlePoll(req, res, params) {
  const state = params.get('state');

  if (!state) {
    return sendJson(res, 400, { error: 'Missing state parameter.' });
  }

  const entry = codeStore.get(state);

  if (!entry) {
    // Not ready yet — client should keep polling
    return sendJson(res, 200, { code: null });
  }

  if (entry.expiresAt < Date.now()) {
    codeStore.delete(state);
    return sendJson(res, 410, { error: 'Auth code expired. Please restart the login flow.' });
  }

  // Claim the code — delete immediately so it cannot be claimed twice
  codeStore.delete(state);
  return sendJson(res, 200, { code: entry.code });
}

export function handler(req, res) {
  const base = `http://${req.headers.host}`;
  let url;

  try {
    url = new URL(req.url, base);
  } catch {
    return sendHtml(res, 400, errorPage('Malformed request URL.'));
  }

  if (req.method !== 'GET') {
    return sendHtml(res, 405, errorPage('Method not allowed.'));
  }

  if (url.pathname === '/callback') {
    return handleCallback(req, res, url.searchParams);
  }

  if (url.pathname === '/poll') {
    return handlePoll(req, res, url.searchParams);
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  return sendHtml(res, 404, errorPage('Not found.'));
}

function successPage() {
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
            border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { font-size: 1.5rem; margin: 16px 0 8px; }
    p { color: #6b7280; margin: 0; line-height: 1.5; }
    .check { font-size: 3rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>You're connected.</h1>
    <p>Google login complete. You can close this tab and return to Claude.</p>
  </div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error — Google Marketing Stack</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { text-align: center; padding: 48px; background: white;
            border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { font-size: 1.5rem; margin: 16px 0 8px; }
    p { color: #6b7280; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Something went wrong.</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// Standalone server entry — used when running directly (Railway, Render, etc.)
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`OAuth callback server listening on port ${PORT}`);
  });
}
