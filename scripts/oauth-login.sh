#!/usr/bin/env bash
# Basecamp 3 OAuth Login Script
# Usage: ./oauth-login.sh <client_id> <client_secret>
# Starts a local HTTP server, opens browser for OAuth, exchanges code for tokens.

set -euo pipefail

CLIENT_ID="${1:?Usage: oauth-login.sh <client_id> <client_secret>}"
CLIENT_SECRET="${2:?Usage: oauth-login.sh <client_id> <client_secret>}"
REDIRECT_URI="http://localhost:12345/callback"
PORT=12345

AUTH_URL="https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}"

echo "Opening browser for Basecamp authorization..."
if command -v open &>/dev/null; then
  open "$AUTH_URL"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$AUTH_URL"
else
  echo "Please open this URL in your browser:"
  echo "$AUTH_URL"
fi

# Start a minimal HTTP server to capture the OAuth callback
# Uses Python since it's available on macOS and most Linux
AUTH_CODE=$(python3 -c "
import http.server
import urllib.parse
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        code = params.get('code', [None])[0]
        if code:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<html><body><h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>')
            print(code, file=sys.stderr)
            raise KeyboardInterrupt
        else:
            self.send_response(400)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<html><body><h1>Error: No authorization code received</h1></body></html>')

    def log_message(self, format, *args):
        pass  # Suppress request logs

server = http.server.HTTPServer(('localhost', ${PORT}), Handler)
try:
    server.handle_request()  # Handle one request only
except KeyboardInterrupt:
    pass
server.server_close()
" 2>&1 1>/dev/null)

if [ -z "$AUTH_CODE" ]; then
  echo "ERROR: Failed to receive authorization code" >&2
  exit 1
fi

echo "Received authorization code. Exchanging for tokens..."

# Exchange authorization code for access token
RESPONSE=$(curl -s -X POST "https://launchpad.37signals.com/authorization/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "type=web_server" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "redirect_uri=${REDIRECT_URI}" \
  -d "code=${AUTH_CODE}")

# Check for errors
if echo "$RESPONSE" | jq -e '.error' &>/dev/null 2>&1; then
  echo "ERROR: Token exchange failed:" >&2
  echo "$RESPONSE" | jq . >&2
  exit 1
fi

ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refresh_token')
EXPIRES_IN=$(echo "$RESPONSE" | jq -r '.expires_in // 1209600')

# Calculate expiration timestamp (default 2 weeks)
EXPIRES_AT=$(date -v+${EXPIRES_IN}S +%s 2>/dev/null || date -d "+${EXPIRES_IN} seconds" +%s)

# Output token info as JSON
jq -n \
  --arg access_token "$ACCESS_TOKEN" \
  --arg refresh_token "$REFRESH_TOKEN" \
  --arg expires_at "$EXPIRES_AT" \
  '{access_token: $access_token, refresh_token: $refresh_token, expires_at: ($expires_at | tonumber)}'
