Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c node ""C:\Users\sky\AppData\Roaming\npm\node_modules\@railway\cli\bin\railway.js"" login --browserless > D:\whatsapp-coach-assistant\railway_auth_result.txt 2>&1", 0, False
