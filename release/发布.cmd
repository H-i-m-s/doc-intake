@echo off
rem Double-click this file.
rem
rem Keep this file ASCII-only: cmd.exe reads it in the ANSI codepage, and
rem UTF-8 Chinese in here gets parsed as commands.
rem
rem Two things this file has to get right:
rem
rem   1. Working directory. Windows sets it to the folder holding the .cmd, not
rem      the app root, so it is set explicitly below.
rem
rem   2. Which PowerShell. pwsh 7 is NOT on the machine PATH on this box, so it
rem      is probed by absolute path first. Falling back to Windows PowerShell
rem      5.1 works, because ship.ps1 carries a UTF-8 BOM, but pwsh 7 is what
rem      ship.ps1 is written and tested against.
rem
rem The console stays visible on purpose. Anything that breaks before the
rem window is up - a parse error, a missing file - shows up here instead of
rem vanishing, and a failure keeps the window open for reading.

setlocal
set "HERE=%~dp0"
cd /d "%HERE%.."

set "PS="
for %%P in (
  "%ProgramFiles%\PowerShell\7\pwsh.exe"
  "%ProgramFiles%\PowerShell\7-preview\pwsh.exe"
  "%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
) do if not defined PS if exist "%%~P" set "PS=%%~P"
if not defined PS for /f "delims=" %%P in ('where pwsh 2^>nul') do if not defined PS set "PS=%%P"
if not defined PS set "PS=powershell.exe"

"%PS%" -NoProfile -ExecutionPolicy Bypass -STA -File "%HERE%ship.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo ship.ps1 exited with %RC%
  pause
)
endlocal
