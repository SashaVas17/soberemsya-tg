#!/usr/bin/env bash
# Configures the bot webhook, commands and menu button (macOS/Linux).
# Secrets are read with hidden input and never passed as arguments or saved.
# Usage: bash scripts/configure-telegram.sh [project-ref] [mini-app-url]
set -euo pipefail

project_ref="${1:-qesuhhhiswwrfvfisfkp}"
mini_app_url="${2:-https://sashavas17.github.io/soberemsya-tg/}"
webhook_url="https://${project_ref}.supabase.co/functions/v1/telegram-bot"

read -r -s -p "TELEGRAM_BOT_TOKEN: " bot_token; echo
read -r -s -p "TELEGRAM_WEBHOOK_SECRET: " webhook_secret; echo
[ -n "$bot_token" ] && [ -n "$webhook_secret" ] || { echo "Both values are required." >&2; exit 1; }

# The token and request body go to curl through a config file on stdin, so neither
# shows up in the process list.
config_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

call() {
  local method="$1" body="$2" response
  response="$(printf 'url = "https://api.telegram.org/bot%s/%s"\ndata = "%s"\n' \
    "$bot_token" "$method" "$(config_escape "$body")" |
    curl -sS -K - -H "Content-Type: application/json")" ||
    { echo "Telegram API method $method failed." >&2; exit 1; }
  if ! printf '%s' "$response" | grep -q '"ok":true'; then
    echo "Telegram API method $method failed: $(printf '%s' "$response" | sed -E 's/.*"description":"([^"]*)".*/\1/')" >&2
    exit 1
  fi
  printf '%s' "$response"
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

me="$(call getMe '{}')"
call setWebhook "{\"url\":\"$webhook_url\",\"secret_token\":\"$(json_escape "$webhook_secret")\",\"allowed_updates\":[\"message\"],\"drop_pending_updates\":false}" >/dev/null
# Commands in the language of the person's Telegram, by the app's rule:
# Russian for CIS languages, English for everyone else (the default list).
ru_commands='[{"command":"start","description":"Открыть Mini App"},{"command":"new","description":"Создать встречу"},{"command":"my","description":"Открыть мои встречи"},{"command":"help","description":"Краткая инструкция"}]'
en_commands='[{"command":"start","description":"Open the Mini App"},{"command":"new","description":"Create a meeting"},{"command":"my","description":"Open my meetings"},{"command":"help","description":"Short guide"}]'
call setMyCommands "{\"commands\":$en_commands}" >/dev/null
for language in ru be uk kk ky uz tg tk hy az; do
  call setMyCommands "{\"commands\":$ru_commands,\"language_code\":\"$language\"}" >/dev/null
done
call setChatMenuButton "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Открыть Flockly\",\"web_app\":{\"url\":\"$mini_app_url\"}}}" >/dev/null
info="$(call getWebhookInfo '{}')"

bot_token=""
webhook_secret=""

echo "BOT_USERNAME=$(printf '%s' "$me" | sed -E 's/.*"username":"([^"]*)".*/\1/')"
if printf '%s' "$info" | tr -d '\\' | grep -qF "\"url\":\"$webhook_url\""; then
  echo "WEBHOOK_URL_MATCH=True"
else
  echo "WEBHOOK_URL_MATCH=False" >&2
  exit 1
fi
echo "WEBHOOK_PENDING_UPDATES=$(printf '%s' "$info" | sed -E 's/.*"pending_update_count":([0-9]+).*/\1/')"
