@echo off
rem Double-click to run The Media League locally. It opens in your browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, this only happens once...
  call npm install || goto :error
)
call npm run dev -- --open
goto :eof
:error
echo.
echo Could not install dependencies. Check that Node.js is installed, then try again.
pause
