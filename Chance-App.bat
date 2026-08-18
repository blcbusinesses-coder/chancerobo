@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Launch the C.H.A.N.C.E desktop app.
REM  Double-click this. It starts the native app, which in turn
REM  boots the backend + UI + vision (skipping anything already up),
REM  with audio autoplay forced on so his voice just works.
REM ═══════════════════════════════════════════════════════════════
cd /d "%~dp0desktop"
start "" /min cmd /c "npm start"
