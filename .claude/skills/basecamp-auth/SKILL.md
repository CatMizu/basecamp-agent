---
name: basecamp-auth
description: Fix Basecamp authentication issues or refresh expired tokens. Use when API calls fail with 401.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Write
---

# Basecamp Auth Troubleshooting

Help the user fix Basecamp authentication issues.

## Diagnose

1. Check if `.credentials/config.json` exists — if not, tell user to run `/basecamp-init`
2. List all accounts in `.credentials/accounts/`
3. For each account, check token status:

```bash
# Check if token is expired
EXPIRES_AT=$(jq -r '.expires_at' .credentials/accounts/{id}.json)
CURRENT=$(date +%s)
if [ "$CURRENT" -gt "$EXPIRES_AT" ]; then echo "EXPIRED"; else echo "VALID"; fi
```

## Fix: Refresh Token

```bash
./scripts/refresh-token.sh {account_id}
```

If refresh fails (refresh token also expired or revoked), the user needs to re-authenticate:

```bash
CLIENT_ID=$(jq -r '.client_id' .credentials/config.json)
CLIENT_SECRET=$(jq -r '.client_secret' .credentials/config.json)
./scripts/oauth-login.sh "$CLIENT_ID" "$CLIENT_SECRET"
```

Then update the account file with the new tokens.

## Fix: Verify Token

Test if a token actually works:

```bash
TOKEN=$(jq -r '.access_token' .credentials/accounts/{id}.json)
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: BasecampAgent (support@example.com)" \
  "https://launchpad.37signals.com/authorization.json"
```

A valid response returns the user's identity and accounts. A 401 means the token is invalid.

## Fix: Re-login for Specific Account

If refresh fails, guide the user through a full re-auth:
1. Run oauth-login.sh to get new tokens
2. Update the specific account JSON file with new access_token, refresh_token, expires_at
