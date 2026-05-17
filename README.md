# Google Marketing Stack MCP

Connect Claude (and other AI assistants) directly to your Google marketing data. Ask questions in plain English and get real answers from GA4, Search Console, Google Sheets, Tag Manager, and PageSpeed — no dashboards, no exports, no SQL.

```
"What were our top 10 landing pages last month and which had the worst bounce rate?"
"Which GSC queries are ranking between position 4 and 10 that we could push to page 1?"
"Run a GTM audit — are there any orphaned triggers or unused variables?"
"Compare ticmint.com performance on mobile vs desktop and tell me what to fix first."
```

---

## What this is

A [Model Context Protocol](https://modelcontextprotocol.io) server that wraps five Google APIs into 44 tools your AI assistant can call directly. You connect it once, and from then on you can ask Claude anything about your Google marketing data and get a real answer — not a hallucination, not a guess, actual data from your accounts.

**What it replaces:** exporting CSVs, clicking through dashboards, writing custom reports, asking your developer to pull data.

**What it is not:** a no-code dashboard, a reporting product, or a managed service. It runs on your machine, uses your own Google credentials, and your data never touches any third-party server.

---

## Prerequisites

Before you start, make sure you have:

- **Node.js 18 or later** — check with `node --version`. Download at [nodejs.org](https://nodejs.org).
- **A Google account** with access to the properties you want to query (GA4, Search Console, etc.)
- **A Google Cloud project** — ideally one that already has the APIs enabled (see GCP setup below)
- **Claude Code, Claude Desktop, Cursor, or Windsurf** — any MCP-compatible client works

---

## GCP setup

This is the part where most people get stuck. Read this section before touching the Google Cloud Console.

### Step 1 — Use the right GCP project

**The most common mistake:** creating a new GCP project for this. Don't.

Use the GCP project that already has your Google Analytics, Search Console, and Sheets APIs enabled. If you create a new project, you will spend 30 minutes enabling APIs and wondering why nothing works.

If you are not sure which project to use: go to [console.cloud.google.com](https://console.cloud.google.com), switch between projects, and look for one that has APIs & Services → Enabled APIs showing Analytics Data API, Search Console API, etc.

### Step 2 — Enable all four APIs

In your GCP project, go to **APIs & Services → Library** and enable all four. You need all four even if you only plan to use some of them — the auth flow requests all scopes at once.

- [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com)
- [Google Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Tag Manager API](https://console.cloud.google.com/apis/library/tagmanager.googleapis.com)

### Step 3 — Create OAuth credentials

Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.

**The second most common mistake:** choosing "Web application" as the type. Do not do this.

You must choose **Desktop app**. Web application clients require pre-registered redirect URIs and will fail with a redirect_uri_mismatch error when this server tries to use a random local port for the OAuth callback.

Name it anything (e.g. "Marketing MCP"), click Create, and copy the **Client ID** and **Client Secret**.

### Step 4 — Configure the consent screen

Go to **APIs & Services → OAuth consent screen**. If it is not configured yet:

- User type: **External** (unless your org has Workspace with Internal available)
- App name: anything
- User support email: your email
- Developer contact email: your email
- Scopes: you do not need to add scopes manually — the server requests them at login
- Test users: add your own Google account email

You do not need to publish the app. Leave it in Testing status.

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/generalist-club/google-marketing-stack-mcp.git
cd google-marketing-stack-mcp

# 2. Install dependencies
npm install

# 3. Test the auth flow works
GOOGLE_CLIENT_ID=your_id GOOGLE_CLIENT_SECRET=your_secret node src/index.js
```

On first run, a browser window opens asking you to log in with Google. Log in, approve the permissions, and you will see "Authenticated. Starting MCP server..." in your terminal. The token is saved to `~/.google-marketing-mcp/token.json` and reused on every subsequent run — you will not be asked to log in again unless you revoke access or run `reauthenticate`.

**If the browser opens with the wrong Google account:** copy the URL from the terminal and paste it into a browser profile that has your work account signed in.

---

## Configuration

### Claude Code

Add to `~/.claude.json` (create the file if it does not exist):

```json
{
  "mcpServers": {
    "google-marketing-stack": {
      "command": "node",
      "args": ["/absolute/path/to/google-marketing-stack-mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GA4_PROPERTY_ID": "123456789",
        "GSC_SITE_URL": "sc-domain:yourdomain.com",
        "GTM_ACCOUNT_ID": "12345678",
        "GTM_CONTAINER_ID": "98765432"
      }
    }
  }
}
```

Replace `/absolute/path/to/` with the actual path to where you cloned the repo (e.g. `/Users/yourname/google-marketing-stack-mcp`). Restart Claude Code after saving.

Verify it is connected by running `/mcp` in Claude Code — you should see `google-marketing-stack` listed. Then ask Claude to call `get_status` to confirm which Google account is connected.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "google-marketing-stack": {
      "command": "node",
      "args": ["/absolute/path/to/google-marketing-stack-mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GA4_PROPERTY_ID": "123456789",
        "GSC_SITE_URL": "sc-domain:yourdomain.com",
        "GTM_ACCOUNT_ID": "12345678",
        "GTM_CONTAINER_ID": "98765432"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "google-marketing-stack": {
      "command": "node",
      "args": ["/absolute/path/to/google-marketing-stack-mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GA4_PROPERTY_ID": "123456789",
        "GSC_SITE_URL": "sc-domain:yourdomain.com",
        "GTM_ACCOUNT_ID": "12345678",
        "GTM_CONTAINER_ID": "98765432"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "google-marketing-stack": {
      "command": "node",
      "args": ["/absolute/path/to/google-marketing-stack-mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GA4_PROPERTY_ID": "123456789",
        "GSC_SITE_URL": "sc-domain:yourdomain.com",
        "GTM_ACCOUNT_ID": "12345678",
        "GTM_CONTAINER_ID": "98765432"
      }
    }
  }
}
```

---

## Environment variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ | OAuth client ID from GCP | `123456-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth client secret from GCP | `GOCSPX-...` |
| `GA4_PROPERTY_ID` | ✅ for GA4 | Numeric GA4 property ID | `387986336` |
| `GSC_SITE_URL` | ✅ for GSC | Your site in Search Console | `sc-domain:example.com` or `https://example.com/` |
| `GTM_ACCOUNT_ID` | ✅ for GTM | GTM account ID | `12345678` |
| `GTM_CONTAINER_ID` | ✅ for GTM | GTM container ID | `98765432` |
| `GTM_WORKSPACE_ID` | optional | Skip workspace auto-detection | `1` |
| `PSI_API_KEY` | optional | PageSpeed API key for higher rate limits | `AIza...` |

**Finding your IDs:**
- **GA4 property ID:** GA4 → Admin → Property Settings → Property ID (number only, not `properties/123`)
- **GSC site URL:** exactly as it appears in the Search Console property list, including `sc-domain:` prefix if applicable
- **GTM account and container IDs:** visible in the GTM URL — `tagmanager.google.com/#/container/accounts/ACCOUNT_ID/containers/CONTAINER_ID`

---

## Tools

### Utility (2 tools)

| Tool | What it does |
|---|---|
| `get_status` | Check which Google account is connected. Run this first after setup. |
| `reauthenticate` | Clear the saved token and trigger a fresh login. Use if you need to switch accounts. |

### Google Analytics 4 (15 tools)

| Tool | What it does |
|---|---|
| `ga4_run_report` | Custom report with any dimensions and metrics you specify |
| `ga4_realtime` | Live data from the last 30 minutes |
| `ga4_traffic_overview` | Sessions, users, pageviews, bounce rate, avg session duration |
| `ga4_traffic_sources` | Breakdown by source / medium |
| `ga4_channel_breakdown` | Sessions by default channel grouping (Organic, Direct, Paid, etc.) |
| `ga4_campaign_performance` | UTM campaign performance |
| `ga4_page_performance` | Pageviews and engagement by page path |
| `ga4_landing_pages` | Performance of first pages seen per session |
| `ga4_geo_breakdown` | Traffic by country and city |
| `ga4_device_breakdown` | Mobile vs desktop vs tablet |
| `ga4_events` | Event counts across all tracked events |
| `ga4_conversions` | Conversion event counts (key events only) |
| `ga4_user_acquisition` | Where new users came from |
| `ga4_session_acquisition` | Where sessions came from |
| `ga4_get_audiences` | List configured GA4 audiences |

### Google Search Console (9 tools)

| Tool | What it does |
|---|---|
| `gsc_search_analytics` | Custom query with any dimensions and optional filters |
| `gsc_all_rows` | Full paginated dataset, up to 25,000 rows |
| `gsc_top_queries` | Top search queries by clicks |
| `gsc_top_pages` | Top pages by organic search clicks |
| `gsc_by_country` | Performance broken down by country |
| `gsc_by_device` | Mobile vs desktop search performance |
| `gsc_daily_performance` | Day-by-day trend for any date range |
| `gsc_query_page_combos` | Which queries drive traffic to which pages |
| `gsc_sitemaps` | List submitted sitemaps with crawl status and error counts |

### Google Sheets (5 tools)

| Tool | What it does |
|---|---|
| `sheets_read` | Read data from any sheet (accepts URL or spreadsheet ID) |
| `sheets_write` | Write or overwrite data at a specific range |
| `sheets_append` | Append rows to the end of existing data |
| `sheets_info` | Get sheet names, row counts, and column counts |
| `sheets_clear` | Clear a range (preserves formatting) |

### Google Tag Manager (8 tools)

| Tool | What it does |
|---|---|
| `gtm_list_accounts` | List all GTM accounts you have access to |
| `gtm_list_containers` | List all containers in your GTM account |
| `gtm_list_workspaces` | List workspaces in the configured container |
| `gtm_list_tags` | List all tags with type and firing trigger bindings |
| `gtm_list_triggers` | List all triggers with type |
| `gtm_list_variables` | List all variables with type |
| `gtm_get_tag` | Get full details for a single tag including all parameters |
| `gtm_audit` | Scan for orphaned triggers, duplicate tag names, and unused variables |

### PageSpeed Insights (5 tools)

| Tool | What it does |
|---|---|
| `psi_analyze` | Full analysis — Lighthouse scores, Core Web Vitals, and field data |
| `psi_core_web_vitals` | LCP, CLS, INP, TBT with lab and real-world field data |
| `psi_lighthouse` | The four Lighthouse scores only (performance, accessibility, best practices, SEO) |
| `psi_compare` | Same URL on mobile and desktop side by side |
| `psi_bulk` | Analyse multiple URLs sequentially |

---

## Troubleshooting

These are the exact errors we hit during testing and what fixed them.

### "redirect_uri_mismatch" during OAuth login

**Cause:** you created a Web application OAuth client instead of a Desktop app client.
**Fix:** go to GCP → APIs & Services → Credentials, delete the Web app client, and create a new one with type **Desktop app**.

### "Access blocked: this app's request is invalid"

**Cause:** usually the same issue — Web app client with an unregistered redirect URI.
**Fix:** same as above.

### Accessibility, Best Practices, SEO scores all showing 0

**Cause:** the PageSpeed API only returns the Performance category by default. This is fixed in the current version.
**Fix:** pull the latest code (`git pull && npm install`).

### GA4 returns "missing authentication credential"

**Cause:** `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is being overwritten by another `.env` file or shell variable.
**Fix:** check that your env vars are set correctly in the MCP config JSON. Values in the `env` block take precedence over shell environment.

### GSC returns empty data for recent dates

**Cause:** Search Console data has a 3-day delay. Querying "today" or "yesterday" returns nothing.
**Fix:** this is expected behaviour. All GSC tools default to `endDate: 3 days ago` automatically.

### "No workspaces found in this GTM container"

**Cause:** `GTM_CONTAINER_ID` is set to the wrong container, or the account has no workspaces (rare).
**Fix:** call `gtm_list_containers` to confirm the correct container ID, then update `GTM_CONTAINER_ID`.

### The browser opens but logs into the wrong Google account

**Cause:** your default browser has a different Google account signed in.
**Fix:** copy the URL printed in the terminal and paste it into a browser window where your work account is active. The token will save correctly after you approve.

### "GA4_PROPERTY_ID is not set" even though it is in the config

**Cause:** the property ID includes the `properties/` prefix (e.g. `properties/123456789`).
**Fix:** use the numeric ID only — `123456789`, not `properties/123456789`. The server strips the prefix but requires a non-empty value.

### Token expires and tools stop working

**Cause:** refresh tokens can be revoked if the OAuth consent screen app is in Testing status and more than 7 days have passed, or if you revoke access from your Google account.
**Fix:** ask Claude to call `reauthenticate`, then log in again.

---

## Contributing

Pull requests welcome. If you find a bug or want to add a tool, open an issue first so we can agree on the approach before you build it.

### Adding a new tool

1. Add the tool to the relevant file in `src/tools/`
2. Follow the existing pattern — `runWithTimeout`, `toResult`, `toError`
3. Register it in `registerXxxTools` — no changes to `src/index.js` needed
4. Add a corresponding test in the `test-*.js` file for that product
5. Test against real data before submitting

### Roadmap

- **v2 — pre-baked credentials:** remove the GCP setup entirely. Users authenticate via a hosted OAuth flow and get a token without touching Google Cloud Console. This eliminates the entire setup section of this README.
- **Google Ads:** campaign performance, spend, ROAS, keyword data
- **Looker Studio:** read report data directly
- **BigQuery export:** query GA4 BigQuery exports for unsampled data
