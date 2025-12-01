@echo off
echo ========================================
echo   Growatt 数据源切换工具
echo ========================================
echo.
echo 当前可用的数据源：
echo   1. Modbus TCP (本地直连，不稳定)
echo   2. Web API (云端数据，稳定)
echo.

set /p choice="请选择数据源 (1 或 2): "

if "%choice%"=="1" (
    echo.
    echo 切换到 Modbus TCP...
    powershell -Command "(Get-Content '%~dp0appsettings.json') -replace '\"DataSource\": \"web\"', '\"DataSource\": \"modbus\"' | Set-Content '%~dp0appsettings.json'"
    echo ✓ 已切换到 Modbus TCP
    echo.
    echo 运行 restart-clean.bat 重启程序以应用更改
) else if "%choice%"=="2" (
    echo.
    echo 切换到 Web API...
    powershell -Command "(Get-Content '%~dp0appsettings.json') -replace '\"DataSource\": \"modbus\"', '\"DataSource\": \"web\"' | Set-Content '%~dp0appsettings.json'"
    echo ✓ 已切换到 Web API
    echo.
    echo 请确保已配置 Web API 账号信息！
    echo 如未配置，请先运行 get-device-info.bat 获取设备信息
    echo 然后手动编辑 appsettings.json 填入配置
    echo.
    echo 运行 restart-clean.bat 重启程序以应用更改
) else (
    echo.
    echo 无效的选择！
)

echo.
pause
