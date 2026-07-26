$env:RAILWAY_TOKEN = ""
$proc = Start-Process -NoNewWindow -FilePath "railway" -ArgumentList "login --browserless" -RedirectStandardOutput "D:\whatsapp-coach-assistant\railway-auth.txt" -RedirectStandardError "D:\whatsapp-coach-assistant\railway-auth-err.txt" -PassThru
Start-Sleep 3
Get-Content "D:\whatsapp-coach-assistant\railway-auth.txt" -ErrorAction SilentlyContinue
Write-Host "================================================"
Write-Host "Process ID: $($proc.Id)"
Write-Host "================================================"
