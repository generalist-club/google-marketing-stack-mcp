# Security Policy

## Reporting a vulnerability

If you find a security vulnerability in this project, please **do not open a public GitHub issue**. Instead, email:

**join@thegeneralist.company**

Include:
- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fixes if you have them

You will receive a response within 48 hours. If the issue is confirmed, a fix will be released as quickly as possible and you will be credited in the release notes (unless you prefer to stay anonymous).

---

## Scope

The following are **in scope** for security reports:

- **OAuth flow** (`src/auth.js`) — the local HTTP server that receives the OAuth callback, token storage, state parameter validation
- **MCP tool handlers** (`src/tools/`) — any input that could cause unexpected behaviour, data leakage, or command injection
- **`cloud/callback.js`** — the optional hosted callback server for v2 auth

The following are **out of scope**:

- Vulnerabilities in the Google APIs themselves (GA4, Search Console, Sheets, GTM, PageSpeed) — report those to Google
- Vulnerabilities in the MCP SDK (`@modelcontextprotocol/sdk`) — report those upstream
- Vulnerabilities in the AI client (Claude Code, Claude Desktop, Cursor, Windsurf) — report those to the respective vendors
- Rate limiting or quota issues with Google's APIs

---

## Security model

This server runs locally on your machine. It is not a hosted service.

**What it does:**
- Opens a browser OAuth window on first run and captures the callback on `127.0.0.1` only
- Saves a token to `~/.google-marketing-mcp/token.json` with `0o600` permissions (owner read/write only)
- Communicates with Google APIs using that token
- Passes results to your AI client over stdio

**What it never does:**
- Send your data to any third-party server
- Log credentials, tokens, or API responses to disk
- Accept network connections from outside your machine (the local auth server binds to `127.0.0.1` only)

**Your credentials** (Client ID and Client Secret) live only in your MCP config file and are never stored by this server. The token saved to disk is scoped to the exact permissions you approved during login.

---

## Supported versions

Only the latest version on the `main` branch is actively maintained. If you are running an older version, update before reporting.
