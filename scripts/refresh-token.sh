#!/usr/bin/env bash
# Basecamp 3 Token Refresh Script
# Usage: ./refresh-token.sh <account_id>
# Checks if token is expired, refreshes if needed, outputs valid access_token.

set -euo pipefail

ACCOUNT_ID="${1:?Usage: refresh-token.sh <account_id>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="${PROJECT_DIR}/.credentials/config.json"
ACCOUNT_FILE="${PROJECT_DIR}/.credentials/accounts/${ACCOUNT_ID}.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Config not found at $CONFIG_FILE. Run /basecamp-init first." >&2
  exit 1
fi

if [ ! -f "$ACCOUNT_FILE" ]; then
  echo "ERROR: Account $ACCOUNT_ID not found at $ACCOUNT_FILE." >&2
  exit 1
fi

CLIENT_ID=$(jq -r '.client_id' "$CONFIG_FILE")
CLIENT_SECRET=$(jq -r '.client_secret' "$CONFIG_FILE")
ACCESS_TOKEN=$(jq -r '.access_token' "$ACCOUNT_FILE")
REFRESH_TOKEN=$(jq -r '.refresh_token' "$ACCOUNT_FILE")
EXPIRES_AT=$(jq -r '.expires_at' "$ACCOUNT_FILE")
CURRENT_TIME=$(date +%s)

# Add 60s buffer to avoid edge cases
if [ "$CURRENT_TIME" -lt "$((EXPIRES_AT - 60))" ]; then
  # Token still valid
  echo "$ACCESS_TOKEN"
  exit 0
fi

echo "Token expired, refreshing..." >&2

RESPONSE=$(curl -s -X POST "https://launchpad.37signals.com/authorization/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "type=refresh" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "refresh_token=${REFRESH_TOKEN}")

if echo "$RESPONSE" | jq -e '.error' &>/dev/null 2>&1; then
  echo "ERROR: Token refresh failed:" >&2
  echo "$RESPONSE" | jq . >&2
  exit 1
fi

NEW_ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
NEW_EXPIRES_IN=$(echo "$RESPONSE" | jq -r '.expires_in // 1209600')
NEW_EXPIRES_AT=$(date -v+${NEW_EXPIRES_IN}S +%s 2>/dev/null || date -d "+${NEW_EXPIRES_IN} seconds" +%s)

# Update account file with new token (preserve other fields)
jq --arg at "$NEW_ACCESS_TOKEN" --arg ea "$NEW_EXPIRES_AT" \
  '.access_token = $at | .expires_at = ($ea | tonumber)' \
  "$ACCOUNT_FILE" > "${ACCOUNT_FILE}.tmp" && mv "${ACCOUNT_FILE}.tmp" "$ACCOUNT_FILE"

echo "Token refreshed successfully." >&2
echo "$NEW_ACCESS_TOKEN"
