@echo off
powershell.exe -NoProfile -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
