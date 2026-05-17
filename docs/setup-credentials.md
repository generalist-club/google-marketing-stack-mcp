# Setting up Google Cloud credentials

This is the most important step in the whole setup. If you skip or rush it, nothing will work. Read this before opening Google Cloud Console.

---

## What you're creating

You need one thing from Google Cloud: an **OAuth 2.0 Client ID** (Desktop app type). This gives the server permission to read your Google Analytics, Search Console, Sheets, and Tag Manager data using your Google account.

You will end up with two values:
- **Client ID** — looks like `123456789-abc123.apps.googleusercontent.com`
- **Client Secret** — looks like `GOCSPX-aBcDeFgHiJkLmNoPqRsTuVwXyZ`

You paste these into your MCP config and you're done. Google handles the login every time.

---

## Before you start: the 4 mistakes everyone makes

These caused real problems during testing. Read them now so you don't hit them.

### Mistake 1 — Choosing "Web application" instead of "Desktop app"

When Google asks what type of OAuth client to create, there's a dropdown. **You must choose "Desktop app."** If you choose "Web application", the server will fail with a `redirect_uri_mismatch` error every single time you try to log in, and it will not be obvious why.

The reason: Web application clients require you to pre-register the exact URL Google should redirect to after login. This server uses a random local port for the callback (like `http://localhost:54231/callback`), so there's no fixed URL to register. Desktop app clients allow any local port.

### Mistake 2 — Using a GCP project that doesn't have the required APIs enabled

Google Cloud has hundreds of APIs. By default, almost none of them are on. You need to manually enable the four APIs this server uses (listed below). If you skip this step, you'll get a `400` error saying the API has not been enabled.

The fix: enable all four APIs **before** creating your OAuth client. That way you only have to go through the consent screen configuration once.

### Mistake 3 — The browser opens and logs in with the wrong Google account

When you run the server for the first time, a browser window opens asking you to log in. If your default browser has a different Google account signed in (say, your personal account instead of your work account), it will authenticate the wrong account.

The fix: copy the URL that's printed in your terminal and paste it into a browser window — or browser profile — where your correct account is already signed in. The login will complete correctly and the token will be saved.

### Mistake 4 — Creating credentials before enabling APIs

The consent screen scopes and credential setup flow differently when the APIs aren't enabled yet. Enable the four APIs first, then create the OAuth client. It takes two minutes and saves you from re-doing things.

---

## Step 1 — Choose the right GCP project

Go to [console.cloud.google.com](https://console.cloud.google.com).

In the top navigation bar, there's a project selector — it shows the currently active project name next to the Google Cloud logo. Click it. A dialog opens showing all your projects.

**You want the project that already has your Google Analytics and other marketing APIs enabled.** If your organization uses Google Analytics, Search Console, or Sheets, there's a good chance a project already exists with these APIs turned on. Look for it before creating a new one.

To check if a project has the APIs enabled: select the project, go to **APIs & Services → Enabled APIs & services** in the left sidebar. If you see "Google Analytics Data API", "Google Search Console API", etc. in the list, you're in the right project.

If you're not sure which project to use, ask whoever manages your Google Analytics account. They'll know.

**If you need to create a new project:** click "New Project" in the project selector dialog. Give it a name like "Marketing MCP", choose your organization if prompted, and click Create. Wait a few seconds for it to provision.

---

## Step 2 — Enable the four required APIs

You need to enable all four of these, even if you only plan to use one or two of them. The server requests all permissions at once during login.

In the left sidebar, go to **APIs & Services → Library**.

Search for and enable each of these:

**1. Google Analytics Data API**
- Search for "Google Analytics Data API"
- Click the result (it shows the Google Analytics logo)
- Click the blue **Enable** button
- Wait for the enable to complete — the page will refresh and show a green checkmark

**2. Google Search Console API**
- Search for "Google Search Console API"
- Click Enable

**3. Google Sheets API**
- Search for "Google Sheets API"
- Click Enable

**4. Tag Manager API**
- Search for "Tag Manager API"
- Click Enable

When all four are enabled, go back to **APIs & Services → Enabled APIs & services** and confirm you can see all four in the list.

---

## Step 3 — Configure the OAuth consent screen

Before creating credentials, you need to tell Google what this app is called and who can use it.

In the left sidebar, go to **APIs & Services → OAuth consent screen**.

If it's not configured yet, you'll be asked to choose a user type:
- Choose **External** — this is for apps used with any Google account
- Click Create

Fill in the required fields:
- **App name**: anything you like, e.g. "Marketing MCP" or your company name
- **User support email**: your email address
- **Developer contact information**: your email address again

Leave everything else blank. Click **Save and Continue**.

On the **Scopes** page, do not add any scopes manually. Click **Save and Continue**. The server requests the correct scopes automatically when you log in.

On the **Test users** page, click **Add Users** and add your own Google account email address — the one you'll be using to log in. Click **Save and Continue**.

You do not need to publish the app or submit it for verification. Leave it in **Testing** status. Click **Back to Dashboard**.

---

## Step 4 — Create the OAuth Client ID

In the left sidebar, go to **APIs & Services → Credentials**.

Click **+ Create Credentials** at the top, then choose **OAuth client ID**.

You'll see a form asking for the application type. This is where Mistake 1 happens.

**Click the "Application type" dropdown and select "Desktop app".** Do not choose Web application, iOS, Android, or anything else. Desktop app.

Give it a name — anything works, like "Marketing MCP Client". Click **Create**.

A dialog will appear showing your new credentials:
- **Your Client ID** — a long string ending in `.apps.googleusercontent.com`
- **Your Client Secret** — a shorter string starting with `GOCSPX-`

Copy both values and save them somewhere safe (a password manager, a notes app). You'll need them in the next step.

You can also download them as a JSON file using the **Download JSON** button — this is useful as a backup.

Click **OK** to close the dialog.

---

## You're done with Google Cloud

You now have a Client ID and Client Secret. These go into your MCP config as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. See [installation.md](installation.md) for the next step.

---

## Where to find your credentials again

If you close the dialog and need to find your credentials later:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project
3. Go to **APIs & Services → Credentials**
4. Under "OAuth 2.0 Client IDs", find the client you created
5. Click the pencil (edit) icon on the right
6. Your Client ID is shown at the top; click **Download JSON** to get the Client Secret again, or click **Reset Secret** to generate a new one (this will invalidate the old one)

---

## What happens to these credentials

The OAuth flow works like this:

1. You start the MCP server for the first time
2. Your browser opens a Google login page (Google's own page, not ours)
3. You log in and approve access to your Analytics, Search Console, Sheets, and Tag Manager
4. A token is saved to your computer at `~/.google-marketing-mcp/token.json`
5. Every subsequent run reuses that token silently — no browser popup

Your credentials (Client ID and Secret) never leave your machine. The token is stored locally. No data passes through any third-party server.

The token may expire after 7 days if your OAuth consent screen is in Testing mode and you haven't logged in. If tools stop working, run `reauthenticate` to log in again.
