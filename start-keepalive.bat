@echo off
echo ========================================
echo   Growatt Monitor 守护进程启动器
echo ========================================
echo.
echo 正在启动守护进程...
echo 守护进程将自动监控并重启崩溃的程序
echo 按 Ctrl+C 可以停止守护进程
echo.

powershell.exe -ExecutionPolicy Bypass -File "%~dp0keep-alive.ps1"
