@echo off
echo ========================================
echo   Growatt Web API 设备信息获取工具
echo ========================================
echo.
echo 此工具将帮助您获取配置Web API所需的信息
echo.

set /p username="请输入Growatt用户名: "
set /p password="请输入Growatt密码: "

echo.
echo 正在连接...
echo.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0test-web-api.ps1" -Username "%username%" -Password "%password%"

pause
