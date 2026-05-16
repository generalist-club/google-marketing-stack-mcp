/**
 * Browser OAuth flow for Google APIs.
 *
 * Flow:
 *   1. Check ~/.google-marketing-mcp/token.json — return immediately if valid
 *   2. Silently refresh if the access token is expired but a refresh token exists
 *   3. If no usable token, open the browser → poll cloud callback → exchange code → save token
 *
 * The auth code exchange happens locally. The cloud callback only stores the raw
 * auth code temporarily — it never receives tokens, credentials, or user data.
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import open from 'open';

const TOKEN_DIR = join(homedir(), '.google-marketing-mcp');
const TOKEN_PATH = join(TOKEN_DIR, 'token.json');

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2_000;

// All scopes bundled into a single consent screen — user logs in once
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
  'https://www.googleapis.com/auth/tagmanager.readonly',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `See the README for setup instructions.`
    );
  }
  return value;
}

function buildOAuthClient() {
  const callbackUrl = requireEnv('OAUTH_CALLBACK_URL');
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_CLIENT_ID'),
    requireEnv('GOOGLE_CLIENT_SECRET'),
    callbackUrl,
  );
}

function getPollUrl() {
  const callbackUrl = new URL(requireEnv('OAUTH_CALLBACK_URL'));
  callbackUrl.pathname = '/poll';
  return callbackUrl.toString();
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
  // 0o600 = owner read/write only — token file is never world-readable
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function pollForCode(sessionId, timeoutMs) {
  const pollUrl = getPollUrl();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let res;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5_000);
      res = await fetch(`${pollUrl}?state=${sessionId}`, { signal: controller.signal });
      clearTimeout(timeoutId);
    } catch {
      // Network hiccup — keep polling until the deadline
      continue;
    }

    if (res.status === 410) {
      throw new Error('Login session expired. Please run the server again to restart the login flow.');
    }

    if (res.ok) {
      const body = await res.json();
      if (body.code) return body.code;
    }
  }

  throw new Error(
    'Authentication timed out after 5 minutes.\n' +
    'Please run the server again to restart the login flow.'
  );
}

export async function getAuthenticatedClient() {
  const oauth2Client = buildOAuthClient();
  const saved = await loadSavedToken();

  if (saved) {
    oauth2Client.setCredentials(saved);

    const isExpired = saved.expiry_date && saved.expiry_date < Date.now() + 60_000;

    if (isExpired && saved.refresh_token) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        const merged = { ...saved, ...credentials };
        await saveToken(merged);
        oauth2Client.setCredentials(merged);
      } catch {
        // Refresh failed — the refresh token may have been revoked
        // Fall through to start a new login flow
        console.error('Stored token could not be refreshed. Starting a new login flow.\n');
        await clearToken();
        return getAuthenticatedClient();
      }
    }

    // Wire up silent auto-refresh for the rest of this session
    oauth2Client.on('tokens', async (newTokens) => {
      const current = await loadSavedToken() ?? {};
      await saveToken({ ...current, ...newTokens });
    });

    return oauth2Client;
  }

  // No usable token — start the browser OAuth flow
  const sessionId = randomUUID();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: sessionId,
    prompt: 'consent', // Required to always receive a refresh token
  });

  console.error('Opening browser for Google login...');
  console.error('If the browser does not open, visit this URL manually:\n');
  console.error(`  ${authUrl}\n`);

  await open(authUrl);
  console.error('Waiting for login to complete...\n');

  const code = await pollForCode(sessionId, AUTH_TIMEOUT_MS);

  let tokens;
  try {
    ({ tokens } = await oauth2Client.getToken(code));
  } catch (err) {
    throw new Error(
      `Failed to exchange auth code for tokens: ${err.message}\n` +
      `Check that your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are correct.`
    );
  }

  await saveToken(tokens);
  oauth2Client.setCredentials(tokens);

  oauth2Client.on('tokens', async (newTokens) => {
    const current = await loadSavedToken() ?? {};
    await saveToken({ ...current, ...newTokens });
  });

  console.error('Authenticated successfully. Starting MCP server...\n');
  return oauth2Client;
}

export async function clearToken() {
  try {
    await fs.unlink(TOKEN_PATH);
  } catch {
    // File may already be gone
  }
}
