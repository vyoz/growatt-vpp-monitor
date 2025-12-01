# Growatt Web API 配置向导

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Growatt Web API 配置向导" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 读取当前配置
$configPath = "$PSScriptRoot\appsettings.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

Write-Host "请输入您的Growatt账号信息：" -ForegroundColor Yellow
Write-Host ""

$username = Read-Host "用户名 (登录 server.growatt.com 的账号)"
$password = Read-Host "密码" -AsSecureString
$passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

Write-Host ""
Write-Host "现在需要获取您的设备信息。请按以下步骤操作：" -ForegroundColor Yellow
Write-Host "1. 打开浏览器访问 https://server.growatt.com" -ForegroundColor White
Write-Host "2. 登录后，打开浏览器的开发者工具 (F12)" -ForegroundColor White
Write-Host "3. 切换到 Network (网络) 标签" -ForegroundColor White
Write-Host "4. 刷新页面，查找包含 'plantId' 的请求" -ForegroundColor White
Write-Host "5. 查找包含 'sn' 或 'serialNumber' 的请求" -ForegroundColor White
Write-Host ""

$plantId = Read-Host "Plant ID (电站ID，通常是数字)"
$serialNumber = Read-Host "Inverter Serial Number (逆变器序列号)"

# 更新配置
$config.Growatt.DataSource = "web"
$config.Growatt.Web.Username = $username
$config.Growatt.Web.Password = $passwordPlain
$config.Growatt.Web.PlantId = $plantId
$config.Growatt.Web.SerialNumber = $serialNumber

# 保存配置
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  配置已保存！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "数据源已切换到: Web API" -ForegroundColor Yellow
Write-Host "重启程序后将使用 Growatt Web API 获取数据" -ForegroundColor Yellow
Write-Host ""
Write-Host "运行 restart-clean.bat 重启程序" -ForegroundColor Cyan
Write-Host ""

pause
