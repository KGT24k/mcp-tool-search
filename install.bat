@echo off
echo ====================================
echo  MCP Tool Search — Install
echo ====================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Install Node.js 20+ first.
    pause
    exit /b 1
)

REM Install dependencies
echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

REM Build TypeScript
echo [2/3] Building TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: TypeScript build failed
    pause
    exit /b 1
)

REM Build catalog
echo [3/3] Building tool catalog...
echo        This connects to each MCP server to discover its tools.
echo        Some servers may take a few seconds...
echo.
call npm run catalog
if %ERRORLEVEL% neq 0 (
    echo.
    echo WARNING: Catalog build had errors. Some servers may not be cataloged.
    echo You can manually edit catalog.json or re-run: npm run catalog
    echo.
)

echo.
echo ====================================
echo  Setup Complete!
echo ====================================
echo.
echo NEXT STEPS:
echo.
echo 1. Add to your .mcp.json or Claude Code settings:
echo.
echo    "mcp-tool-search": {
echo      "command": "node",
echo      "args": ["%CD:\=/%/dist/index.js"]
echo    }
echo.
echo 2. Optionally disable other MCP servers that are now proxied.
echo.
echo 3. Restart Claude Code to pick up the new config.
echo.
pause
