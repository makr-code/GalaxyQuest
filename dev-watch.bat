@echo off
REM GalaxyQuest Development Watch - Windows Wrapper
REM Usage: dev-watch.bat [--no-browser] [--port 8080]

setlocal enabledelayedexpansion

set "PORT=8080"
set "BROWSER=true"

:parse_args
if "%1"=="" goto run
if "%1"=="--no-browser" (
    set "BROWSER=false"
    shift
    goto parse_args
)
if "%1"=="--port" (
    set "PORT=%2"
    shift
    shift
    goto parse_args
)
shift
goto parse_args

:run
echo.
echo 🚀 GalaxyQuest Development Watch
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Server: http://localhost:%PORT%
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

if "%BROWSER%"=="true" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/dev-watch.ps1" -Port %PORT%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/dev-watch.ps1" -Port %PORT% -NoBrowser
)
