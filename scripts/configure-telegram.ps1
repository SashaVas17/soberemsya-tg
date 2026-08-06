[CmdletBinding()]
param(
  [string]$ProjectRef = "qesuhhhiswwrfvfisfkp",
  [string]$MiniAppUrl = "https://soberemsya-tg.pages.dev"
)

$ErrorActionPreference = "Stop"

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Invoke-Telegram([string]$Method, [hashtable]$Body = @{}) {
  $json = $Body | ConvertTo-Json -Depth 8 -Compress
  $response = Invoke-RestMethod `
    -Uri "$script:ApiBase/$Method" `
    -Method Post `
    -ContentType "application/json" `
    -Body $json

  if (-not $response.ok) {
    throw "Telegram API method '$Method' failed."
  }

  $response.result
}

$botToken = Read-SecretText "TELEGRAM_BOT_TOKEN"
$webhookSecret = Read-SecretText "TELEGRAM_WEBHOOK_SECRET"

try {
  $script:ApiBase = "https://api.telegram.org/bot$botToken"
  $webhookUrl = "https://$ProjectRef.supabase.co/functions/v1/telegram-bot"

  $bot = Invoke-Telegram "getMe"
  Invoke-Telegram "setWebhook" @{
    url = $webhookUrl
    secret_token = $webhookSecret
    allowed_updates = @("message")
    drop_pending_updates = $false
  } | Out-Null

  Invoke-Telegram "setMyCommands" @{
    commands = @(
      @{ command = "start"; description = "Открыть Mini App" }
      @{ command = "new"; description = "Создать встречу" }
      @{ command = "my"; description = "Открыть мои встречи" }
      @{ command = "help"; description = "Краткая инструкция" }
    )
  } | Out-Null

  Invoke-Telegram "setChatMenuButton" @{
    menu_button = @{
      type = "web_app"
      text = "Открыть Соберёмся"
      web_app = @{ url = $MiniAppUrl }
    }
  } | Out-Null

  $info = Invoke-Telegram "getWebhookInfo"
  $expectedWebhook = $info.url -eq $webhookUrl

  Write-Output "BOT_USERNAME=$($bot.username)"
  Write-Output "WEBHOOK_URL_MATCH=$expectedWebhook"
  Write-Output "WEBHOOK_PENDING_UPDATES=$($info.pending_update_count)"
  Write-Output "WEBHOOK_ALLOWED_UPDATES=$($info.allowed_updates -join ',')"
  Write-Output "WEBHOOK_LAST_ERROR=$($info.last_error_message)"

  if (-not $expectedWebhook) {
    throw "Telegram returned an unexpected webhook URL."
  }
}
finally {
  $botToken = $null
  $webhookSecret = $null
  $script:ApiBase = $null
}
