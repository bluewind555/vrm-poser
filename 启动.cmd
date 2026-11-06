@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo [1/2] Installing dependencies, this takes a while...
  call npm install
  if errorlevel 1 goto :fail
)

echo [2/2] Starting dev server on http://localhost:5273/  (default model: weilina)
start "" cmd /c "timeout /t 4 >nul & start http://localhost:5273/"
call npm run dev
goto :eof

:fail
echo.
echo npm install failed. Check your network or npm registry.
pause

