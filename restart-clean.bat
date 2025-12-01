@echo off
echo ========================================
echo   清理并重启 Growatt Monitor
echo ========================================
echo.

echo [1/4] 停止所有相关进程...
taskkill /F /IM GrowattMonitor.exe 2>nul
taskkill /F /IM dotnet.exe 2>nul
timeout /t 3 /nobreak >nul

echo [2/4] 清理完成
echo.

echo [3/4] 编译Release版本...
cd /d "%~dp0"
dotnet build -c Release
echo.

echo [4/4] 启动程序...
start "" "%~dp0bin\Release\net8.0\GrowattMonitor.exe"
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   程序已启动！
echo   访问 http://localhost:5000
echo ========================================
echo.

pause
