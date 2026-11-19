@echo off
rem Double-click to start the WP Readme Viewer and open it in the browser.
cd /d "%~dp0"
node server.js --open
pause
