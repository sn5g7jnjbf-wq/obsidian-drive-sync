@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22以上が必要です。Node.jsを用意してから再度開いてください。
  pause
  exit /b 1
)
node "%~dp0google-auth-helper.mjs"
pause
