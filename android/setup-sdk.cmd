@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-sdk.ps1" %*
pause
