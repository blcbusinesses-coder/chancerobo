@echo off
REM Launches the CHANCE UI in Chrome with autoplay forced ON, so his voice always plays.
REM Uses a dedicated Chrome profile so it works even if your normal Chrome is running.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --autoplay-policy=no-user-gesture-required ^
  --user-data-dir="%LOCALAPPDATA%\ChanceUI" ^
  --new-window ^
  "http://localhost:5173"
