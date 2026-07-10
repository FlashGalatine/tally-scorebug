@echo off
rem Double-click launcher for the roster-import helper — no terminal typing needed.
rem Keep this window open while importing brackets; close it to stop the helper.
rem (Or skip this file entirely: the "Roster Helper" Streamer.bot action in
rem  streamerbot-roster-helper.cs starts the same thing hidden, from inside SB.)
title Lite Scoreboard - Roster Helper
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required ^(https://nodejs.org^) but was not found on PATH.
  pause
  exit /b 1
)
echo Roster helper starting on http://127.0.0.1:7481 - close this window to stop it.
node roster-helper.mjs
if errorlevel 1 pause
