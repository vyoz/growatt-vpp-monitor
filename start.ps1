# 恢复依赖包
Write-Host "正在恢复 NuGet 包..." -ForegroundColor Cyan
dotnet restore

if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖包恢复失败！" -ForegroundColor Red
    exit 1
}

Write-Host "依赖包恢复成功！" -ForegroundColor Green
Write-Host ""

# 编译项目
Write-Host "正在编译项目..." -ForegroundColor Cyan
dotnet build

if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败！" -ForegroundColor Red
    exit 1
}

Write-Host "编译成功！" -ForegroundColor Green
Write-Host ""

# 运行项目
Write-Host "正在启动 Growatt Monitor..." -ForegroundColor Cyan
Write-Host "应用将在 http://localhost:5000 启动" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Yellow
Write-Host ""

dotnet run --urls "http://localhost:5000"
