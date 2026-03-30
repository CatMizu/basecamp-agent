---
name: basecamp-init
description: Initialize Basecamp 3 configuration. Run this first to set up OAuth credentials and add your Basecamp accounts.
disable-model-invocation: true
allowed-tools: Bash(*), Write, Read, AskUserQuestion
argument-hint: [setup | add-account]
---

# Basecamp Init

Help the user set up their Basecamp 3 configuration. This is a one-time setup process.

## Step 1: Check existing config

Check if `.credentials/config.json` exists (relative to project root).

- If it exists and the user ran `/basecamp-init add-account`, skip to Step 3.
- If it exists and no argument, ask if they want to reconfigure or add an account.
- If it doesn't exist, proceed to Step 2.

## Step 2: OAuth App Registration

Tell the user:

1. Go to https://launchpad.37signals.com/integrations
2. Click "Register your application"
3. Fill in:
   - **Name**: Any name (e.g., "My Basecamp Agent")
   - **Company**: Your company name
   - **Website URL**: `http://localhost`
   - **Redirect URI**: `http://localhost:12345/callback`
4. After registering, copy the **Client ID** and **Client Secret**

Ask the user for their Client ID and Client Secret using AskUserQuestion.

Then create the config:

```bash
mkdir -p .credentials/accounts
```

Write `.credentials/config.json`:
```json
{
  "client_id": "<user's client_id>",
  "client_secret": "<user's client_secret>"
}
```

## Step 3: OAuth Login

Run the OAuth login script:

```bash
chmod +x ./scripts/oauth-login.sh
./scripts/oauth-login.sh "<client_id>" "<client_secret>"
```

This will:
- Open the browser for Basecamp authorization
- Capture the callback and exchange for tokens
- Output JSON with access_token, refresh_token, expires_at

Save the output temporarily.

## Step 4: Discover Available Accounts

Use the access token to fetch the user's Basecamp accounts:

```bash
curl -s -H "Authorization: Bearer <access_token>" \
  -H "User-Agent: BasecampAgent (support@example.com)" \
  "https://launchpad.37signals.com/authorization.json"
```

This returns the user's identity and a list of accounts. Parse the `accounts` array — each entry has:
- `id`: account ID
- `name`: account/company name
- `product`: should be "bc3" for Basecamp 3
- `href`: API base URL

Show the user all their Basecamp 3 accounts (filter where `product == "bc3"`) and ask which ones they want to manage.

## Step 5: Save Account Configs

For each selected account, write `.credentials/accounts/{account_id}.json`:

```json
{
  "name": "Client Company Name",
  "account_id": 12345678,
  "href": "https://3.basecampapi.com/12345678",
  "access_token": "<from step 3>",
  "refresh_token": "<from step 3>",
  "expires_at": 1234567890
}
```

## Step 6: Verify

For each saved account, make a test API call:

```bash
curl -s -H "Authorization: Bearer <token>" \
  -H "User-Agent: BasecampAgent (support@example.com)" \
  "https://3.basecampapi.com/<account_id>/projects.json"
```

Confirm the response is valid and show the user how many projects each account has.

Tell the user: "Setup complete! You can now use `/basecamp` to manage your projects."
