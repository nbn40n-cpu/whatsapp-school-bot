@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 🤖 بوت مدرسة البديع
echo.
echo ============================================
echo   بوت مدرسة بديع لتعليم السياقة
echo ============================================
echo.
echo  انتظر... جاري تنظيف الجلسة القديمة
rmdir /s /q baileys_auth 2>nul
del /q qr.png 2>nul
echo.
echo  جاري تشغيل البوت...
echo  سيظهر كود الاقتران - أدخله في واتساب بسرعة
echo.
node baileys-bot.js
pause
