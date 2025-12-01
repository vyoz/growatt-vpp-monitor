# Growatt Monitor Keep-Alive Script
# 保持程序运行的守护脚本 - 使用编译后的Release版本

$programPath = "c:\growatt\GrowattMonitor.NET"
$exePath = Join-Path $programPath "bin\Release\net8.0\GrowattMonitor.exe"
$checkInterval = 30 # 每30秒检查一次
$processName = "GrowattMonitor"
$apiUrl = "http://localhost:5000/api/current"
$maxDataAge = 180 # 数据超过3分钟未更新视为异常

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Growatt Monitor 守护进程已启动" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "程序路径: $exePath"
Write-Host "检查间隔: $checkInterval 秒"
Write-Host "数据过期阈值: $maxDataAge 秒"
Write-Host "按 Ctrl+C 停止守护进程`n" -ForegroundColor Yellow

# 首次启动前先编译Release版本
if (-not (Test-Path $exePath)) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 首次运行，正在编译Release版本..." -ForegroundColor Cyan
    Set-Location $programPath
    dotnet build -c Release
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 编译完成`n" -ForegroundColor Green
}

while ($true) {
    $needRestart = $false
    $restartReason = ""
    
    # 检查程序是否在运行
    $process = Get-Process $processName -ErrorAction SilentlyContinue
    
    if (-not $process) {
        $needRestart = $true
        $restartReason = "程序未运行"
    } else {
        # 程序在运行，检查数据是否更新
        try {
            $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 5 -ErrorAction Stop
            if ($response.timestamp) {
                $lastUpdate = [DateTime]::Parse($response.timestamp)
                $age = (Get-Date) - $lastUpdate
                
                if ($age.TotalSeconds -gt $maxDataAge) {
                    $needRestart = $true
                    $restartReason = "数据已 $([int]$age.TotalSeconds) 秒未更新（超过 $maxDataAge 秒阈值）"
                } else {
                    $uptime = (Get-Date) - $process.StartTime
                    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✓ 程序运行正常 (PID: $($process.Id), 运行: $($uptime.Hours)h$($uptime.Minutes)m, 数据: $([int]$age.TotalSeconds)s前)" -ForegroundColor Gray
                }
            }
        } catch {
            # API调用失败，可能程序有问题
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ⚠ API调用失败: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    if ($needRestart) {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ⚠ 检测到问题: $restartReason" -ForegroundColor Yellow
        
        # 停止旧进程
        if ($process) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 正在停止卡住的进程..." -ForegroundColor Yellow
            Stop-Process -Name $processName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
        }
        
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 正在启动程序..." -ForegroundColor Yellow
        
        # 启动程序（后台运行）
        Start-Process -FilePath $exePath -WorkingDirectory $programPath -WindowStyle Hidden
        
        Start-Sleep -Seconds 5
        
        $newProcess = Get-Process $processName -ErrorAction SilentlyContinue
        if ($newProcess) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✓ 程序已启动 (PID: $($newProcess.Id))" -ForegroundColor Green
        } else {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ✗ 程序启动失败！" -ForegroundColor Red
        }
    }
    
    Start-Sleep -Seconds $checkInterval
}
