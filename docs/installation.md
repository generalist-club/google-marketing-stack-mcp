# Installation guide

This guide walks you through installing the Google Marketing Stack MCP server and connecting it to your AI assistant. Follow the steps in order.

---

## Prerequisites

You need three things installed on your computer before you start.

### Node.js 18 or later

Node.js is the runtime that executes the server. Check if you have it:

```
node --version
```

If you see `v18.x.x` or higher, you're good. If the command isn't found, or you see a version below 18, download and install it from [nodejs.org](https://nodejs.org). Click the "LTS" (Long Term Support) download — that's the stable version.

After installing, close and reopen your terminal, then run `node --version` again to confirm.

### npm

npm comes bundled with Node.js. Confirm it's there:

```
npm --version
```

You should see a version number. If you just installed Node.js and this doesn't work, close and reopen your terminal.

### git

git is used to download the code. Check if you have it:

```
git --version
```

If not installed: on Mac, run `xcode-select --install` and follow the prompts. On Windows, download from [git-scm.com](https://git-scm.com).

---

## Step 1 — Get your Google credentials

You need a Google Cloud **Client ID** and **Client Secret** before continuing. If you haven't created these yet, follow [setup-credentials.md](setup-credentials.md) first and come back here.

You'll also need to know your IDs for the Google products you want to use:

**GA4 Property ID** — a number like `387986336`
Go to Google Analytics → Admin (gear icon, bottom left) → Property Settings → Property ID. Copy the number. Do not include "properties/" — just the digits.

**GSC Site URL** — exactly as it appears in Search Console
Go to [search.google.com/search-console](https://search.google.com/search-console) and look at the property dropdown at the top left. Copy it exactly, including any prefix. It will be either:
- `sc-domain:yourdomain.com` (for domain properties)
- `https://yourdomain.com/` (for URL-prefix properties, including the trailing slash)

**GTM Account ID and Container ID** — visible in the GTM URL
Go to [tagmanager.google.com](https://tagmanager.google.com). Once you're inside a container, look at the browser URL. It looks like:
`tagmanager.google.com/#/container/accounts/12345678/containers/98765432`
The first number is your Account ID, the second is your Container ID.

You only need the IDs for services you actually want to use. GA4 tools won't work without `GA4_PROPERTY_ID`, but Sheets and PageSpeed don't need any property IDs at all.

---

## Step 2 — Clone the repository

Open your terminal. Navigate to a folder where you want to keep the code — your home directory or a projects folder works fine:

```
cd ~
```

Clone the repository:

```
git clone https://github.com/generalist-club/google-marketing-stack-mcp.git
```

This creates a folder called `google-marketing-stack-mcp`. Navigate into it:

```
cd google-marketing-stack-mcp
```

---

## Step 3 — Install dependencies

Run:

```
npm install
```

This downloads the packages the server needs. It takes about 30 seconds. You should see output ending with something like `added 87 packages`. A few warnings during install are normal — they don't affect anything.

---

## Step 4 — Test the server starts

Before configuring your AI client, confirm the server can actually start. Run this, replacing the placeholders with your real credentials:

```
GOOGLE_CLIENT_ID=your_client_id GOOGLE_CLIENT_SECRET=your_client_secret node src/index.js
```

**What happens next:** a browser window opens. Log in with the Google account that has access to your GA4, Search Console, etc. Approve the permissions when prompted.

After approving, you'll see this in your terminal:

```
Authenticated. Starting MCP server...
```

The server is now running and waiting for commands. Press `Control + C` to stop it — you don't need it running manually, your AI client will start it.

**If the browser opens with the wrong Google account:** copy the URL that was printed in the terminal, paste it into a browser window where your correct account is signed in, and complete the login there.

**If you see an error about redirect_uri_mismatch:** your OAuth client is the wrong type. Go back to Google Cloud Console, delete the existing credential, and create a new one with type **Desktop app** (not Web application). See [setup-credentials.md](setup-credentials.md).

Once the server starts successfully, the token is saved to `~/.google-marketing-mcp/token.json`. You won't be asked to log in again.

---

## Step 5 — Configure your AI client

Choose the client you use and follow the instructions for it. You only need to do one.

---

### Claude Code

Add this to `~/.claude.json`. If that file doesn't exist, create it.

Open the file in any text editor. If it's empty, paste this entire block. If it already has content, add the `google-marketing-stack` entry inside the existing `"mcpServers"` object.

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

**Replace `/absolute/path/to/`** with the actual path to where you cloned the repo. To find it, run `pwd` in your terminal while inside the `google-marketing-stack-mcp` folder. On Mac, it looks like `/Users/yourname/google-marketing-stack-mcp`.

Replace all the credential and ID values with your real ones.

Save the file. Restart Claude Code completely (quit and reopen, not just a new window).

**Verify it's connected:** type `/mcp` in Claude Code. You should see `google-marketing-stack` listed as a connected server. Then ask Claude to call `get_status` — it will confirm which Google account is connected.

---

### Claude Desktop

**Mac:** the config file is at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:** the config file is at:
```
%APPDATA%\Claude\claude_desktop_config.json
```

To open the folder on Mac, open Finder, press `Command + Shift + G`, and paste `~/Library/Application Support/Claude/`. Open `claude_desktop_config.json` in a text editor.

Add this to the file (same rules as above — merge into existing content if the file isn't empty):

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

Replace `/absolute/path/to/` with the actual path. On Mac, run `pwd` inside the cloned folder — it will look like `/Users/yourname/google-marketing-stack-mcp`.

Save the file. Quit Claude Desktop completely (right-click the icon in the menu bar → Quit, or on Windows close it from the system tray). Reopen it.

**Verify it's connected:** look for the MCP tools icon (a wrench or plug icon) in the Claude Desktop interface. You can also ask Claude "call get_status" and it will tell you which account is connected.

---

### Cursor

The config file is at `~/.cursor/mcp.json`. Create it if it doesn't exist.

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

Replace the path and credentials. Save the file. Restart Cursor.

**Verify it's connected:** go to Cursor Settings → Features → MCP. You should see `google-marketing-stack` listed. Or ask the AI agent to call `get_status`.

---

### Windsurf

The config file is at `~/.codeium/windsurf/mcp_config.json`. Create it if it doesn't exist.

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

Replace the path and credentials. Save the file. Restart Windsurf.

---

## Step 6 — Verify everything is working

Once your client is configured and restarted, ask it to run:

```
Call get_status
```

A working response looks like:

```
Google Marketing Stack MCP — connected
Account: yourname@yourdomain.com

Available tool groups:
  GA4         — ga4_* tools
  GSC         — gsc_* tools
  Sheets      — sheets_* tools
  GTM         — gtm_* tools
  PageSpeed   — psi_* tools (no auth required)
```

If you see your correct Google account email, you're done. All 44 tools are available.

---

## Environment variables reference

| Variable | Required for | What it is | Where to find it |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Everything | OAuth client ID from GCP | GCP → APIs & Services → Credentials → your Desktop app client |
| `GOOGLE_CLIENT_SECRET` | Everything | OAuth client secret from GCP | Same place; download the JSON if you didn't save it |
| `GA4_PROPERTY_ID` | GA4 tools | Numeric property ID | GA4 → Admin → Property Settings → Property ID (numbers only) |
| `GSC_SITE_URL` | GSC tools | Exact site URL from Search Console | The property name as shown in the Search Console property selector |
| `GTM_ACCOUNT_ID` | GTM tools | GTM account ID | The first number in the GTM URL |
| `GTM_CONTAINER_ID` | GTM tools | GTM container ID | The second number in the GTM URL |
| `GTM_WORKSPACE_ID` | Optional | Skip workspace auto-detection | Leave this out unless you have a specific workspace to target |
| `PSI_API_KEY` | Optional | PageSpeed API key | GCP → APIs & Services → Credentials → Create API key. Without it, PageSpeed still works but is rate-limited |

You only need the variables for the services you use. If you don't use GTM, leave out `GTM_ACCOUNT_ID` and `GTM_CONTAINER_ID`. The server will still start and all other tools will work.

---

## Common problems

**"Command not found: node" when the server tries to start**
Your AI client can't find Node.js. This happens because GUI apps on Mac don't always inherit your shell's PATH. Find where Node.js is installed by running `which node` in your terminal and paste that full path into the `"command"` field instead of just `"node"`. For example: `"/usr/local/bin/node"`.

**Tools appear but all return errors about missing credentials**
The env vars in your config JSON aren't being picked up. Double-check that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the config are your actual values (not the placeholder text from this guide). Also check for extra spaces or quotes around the values.

**"GA4_PROPERTY_ID is not set" even though it is**
The property ID includes the `properties/` prefix. Use only the number — `387986336`, not `properties/387986336`.

**Token stops working after a week**
The Google OAuth consent screen in Testing mode has a 7-day refresh token limit. Ask your AI to call `reauthenticate`, then log in again when the browser opens. Consider publishing your consent screen (you don't need to submit for review — just change the status from Testing to Production) to remove this limit for your own account.

**GSC tools return empty data**
Search Console data has a 3-day delay. If you query the last 1–2 days, you'll get nothing. The tools default to ending 3 days ago, but if you specify a custom date range, make sure it doesn't go right up to today.
