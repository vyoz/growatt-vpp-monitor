# Growatt Solar Monitor (.NET) - 安装指南

## 系统要求

### 必需软件
1. **Windows 10/11** (64位)
2. **.NET SDK** - 以下任一版本：
   - **.NET 8.0** (LTS - 长期支持，推荐)
   - **.NET 9.0, 10.0** 或更高版本 (完全兼容，可优先选择最新版)
3. **Git** (可选，用于克隆代码)

> **版本说明**: 项目使用 .NET 8.0 构建，但**向上兼容**所有更高版本。如果系统已安装 .NET 9/10/11 等更高版本，无需降级，可直接使用。更高版本通常包含性能改进和新特性。

### 硬件要求
- 内存：最少 2GB RAM
- 硬盘：最少 500MB 可用空间
- 网络：能访问逆变器的局域网

---

## 安装步骤

### 1. 安装 .NET SDK

#### 下载并安装

**选项A：安装最新版本（推荐）**
1. 访问 [.NET 下载页面](https://dotnet.microsoft.com/download)
2. 下载最新的 **".NET SDK"** (Windows x64)
3. 运行安装程序，按默认选项安装

**选项B：安装 .NET 8.0 LTS**
1. 访问 [.NET 8.0 下载页面](https://dotnet.microsoft.com/download/dotnet/8.0)
2. 下载 **".NET 8.0 SDK"** (Windows x64)
3. 运行安装程序，按默认选项安装

> **提示**: 如果已安装 .NET 9.0、10.0 或更高版本，**无需再安装 .NET 8.0**，项目可直接在更高版本运行。

#### 验证安装
打开 PowerShell 或命令提示符，运行：
```powershell
dotnet --version
```

**预期输出示例：**
```
10.0.100    # .NET 10 - ✅ 完美！
9.0.101     # .NET 9  - ✅ 完美！
8.0.403     # .NET 8  - ✅ 完美！
```

只要显示的版本号 ≥ 8.0.0 即可！

**进一步验证（可选）：**
```powershell
# 查看已安装的所有 .NET SDK 版本
dotnet --list-sdks

# 预期输出示例：
# 8.0.403 [C:\Program Files\dotnet\sdk]
# 10.0.100 [C:\Program Files\dotnet\sdk]

# 查看 .NET 完整信息
dotnet --info
```

**如果命令未找到：**
- Windows: 重启 PowerShell 或重启电脑
- 检查环境变量中是否有 `C:\Program Files\dotnet`
- 重新安装 .NET SDK

**测试项目兼容性：**
```powershell
cd c:\growatt\GrowattMonitor.NET
dotnet build

# 如果显示 "Build succeeded"，说明完全兼容！
```

---

### 2. 获取项目代码

#### 方式A：使用Git（推荐）
```powershell
# 安装 Git（如果还没安装）
# 从 https://git-scm.com/download/win 下载安装

# 克隆项目
git clone <你的仓库地址> c:\growatt
cd c:\growatt
```

#### 方式B：手动下载
1. 下载项目压缩包
2. 解压到 `c:\growatt` 目录
3. 确保目录结构正确（GrowattMonitor.NET文件夹应该在 c:\growatt 下）

---

### 3. 配置逆变器连接

编辑配置文件 `c:\growatt\GrowattMonitor.NET\appsettings.json`：

```json
{
  "Growatt": {
    "Modbus": {
      "IpAddress": "192.168.0.156",  // 修改为你的逆变器IP地址
      "Port": 502,
      "UnitId": 1
    },
    "PollingInterval": 30,  // 数据采集间隔（秒）
    "HistorySize": 1000,
    "LogDirectory": "./logs",
    "RetryTimeout": 10,
    "RetryDelay": 0.5
  }
}
```

#### 如何找到逆变器IP地址？
1. **通过路由器**: 登录路由器管理界面查看连接设备
2. **通过逆变器WiFi模块**: 查看WiFi模块的设置界面
3. **使用网络扫描工具**: 如 Advanced IP Scanner

---

### 4. 恢复依赖包

在项目目录运行：
```powershell
cd c:\growatt\GrowattMonitor.NET
dotnet restore
```

这会下载所需的NuGet包：
- FluentModbus (Modbus TCP通信)
- CsvHelper (CSV日志)
- Swashbuckle (API文档)

---

### 5. 编译项目

```powershell
dotnet build
```

如果成功，会看到 `Build succeeded` 消息

---

### 6. 运行项目

```powershell
dotnet run
```

或者指定监听地址：
```powershell
dotnet run --urls "http://localhost:5000"
```

### 首次运行检查

服务器启动后，你应该看到：
```
info: GrowattMonitor.Services.DataPollingService[0]
      Data Polling Service started. Interval: 30 seconds
info: GrowattMonitor.Services.ModbusService[0]
      Connected to Modbus at 192.168.0.156:502
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: http://localhost:5000
```

---

## 使用系统

### 访问Web界面
打开浏览器访问：
```
http://localhost:5000
```

你应该看到：
- ✅ 实时能量流动数据
- ✅ Sankey能量流向图
- ✅ 电池电量显示
- ✅ 连接状态指示

### 访问API文档
```
http://localhost:5000/swagger
```

### 常用API端点

#### 获取当前数据
```
GET http://localhost:5000/api/current
```

#### 获取历史数据
```
GET http://localhost:5000/api/history?limit=100

# 查询最近30分钟
GET http://localhost:5000/api/history?minutes=30&limit=100
```

#### 查询指定日期数据
```
GET http://localhost:5000/api/history/range?start_date=2025-11-29
```

#### 查询每日统计
```
GET http://localhost:5000/api/daily?date=2025-11-29

# 查询日期范围
GET http://localhost:5000/api/daily/range?start_date=2025-11-01&end_date=2025-11-29
```

---

## 数据存储

### CSV日志文件
数据自动保存在：
```
c:\growatt\GrowattMonitor.NET\logs\growatt_log_2025-11.csv
```

文件按月分割，格式：
```csv
Timestamp,Solar,Load,GridExport,GridImport,BatteryCharge,BatteryDischarge,BatteryNet,SocInv,SocBms
2025-11-29T19:11:50...,0.33,1.24,0,3.96,0,4.87,-4.87,79,79
```

---

## 开机自动启动（可选）

### 方式1：使用任务计划程序

1. 打开"任务计划程序"
2. 创建基本任务
3. 触发器：登录时
4. 操作：启动程序
   - 程序：`dotnet`
   - 参数：`run --project c:\growatt\GrowattMonitor.NET`
   - 起始位置：`c:\growatt\GrowattMonitor.NET`

### 方式2：创建Windows服务

安装为Windows服务（需要管理员权限）：
```powershell
# 安装 sc.exe 创建服务
sc.exe create GrowattMonitor binPath="dotnet c:\growatt\GrowattMonitor.NET\bin\Release\net8.0\GrowattMonitor.dll"
sc.exe start GrowattMonitor
```

---

## 故障排查

### 问题1：无法连接到逆变器
**症状**: `Failed to connect to Modbus`

**解决方案**:
1. 检查逆变器IP是否正确
2. 确认逆变器和电脑在同一网络
3. 测试网络连接：`ping 192.168.0.156`
4. 确认Modbus TCP端口502未被防火墙阻止
5. 检查逆变器是否开启了Modbus TCP功能

### 问题2：端口被占用
**症状**: `Address already in use`

**解决方案**:
```powershell
# 查看占用5000端口的进程
### 问题4：编译错误
**症状**: `The SDK 'Microsoft.NET.Sdk.Web' version ... was not found`

**解决方案**:
1. 确认安装了 .NET SDK（≥8.0，不是Runtime）
2. 重新运行 `dotnet --version` 确认版本 ≥ 8.0
3. 如果版本低于8.0，需要升级到8.0或更高版本
4. 可能需要重启电脑

### 问题5：已有更高版本.NET，是否需要降级？
**症状**: 已安装 .NET 9/10/11 等

**解决方案**:
**不需要降级！** 项目完全兼容所有 ≥8.0 的版本。更高版本反而可能带来更好的性能。为0
**症状**: 显示已连接但所有数据为0

**解决方案**:
1. 可能是夜间逆变器关机（正常现象）
2. 等待白天太阳能发电
3. 检查逆变器工作状态

### 问题4：编译错误
**症状**: `The SDK 'Microsoft.NET.Sdk.Web' version ... was not found`

**解决方案**:
1. 确认安装了 .NET 8.0 SDK（不是Runtime）
2. 重新运行 `dotnet --version` 确认
3. 可能需要重启电脑

---

## 网络配置

### 防火墙设置
如需从其他设备访问，需要允许端口5000：

```powershell
# 添加防火墙规则（需管理员权限）
New-NetFirewallRule -DisplayName "Growatt Monitor" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
```

### 外部访问
修改启动命令以监听所有网络接口：
```powershell
dotnet run --urls "http://0.0.0.0:5000"
```

然后可以从其他设备访问：
```
http://<电脑IP>:5000
```

---

## 性能优化

### 发布生产版本
创建优化的发布版本：
```powershell
dotnet publish -c Release -o c:\growatt\publish
```

运行发布版本：
```powershell
cd c:\growatt\publish
.\GrowattMonitor.exe
```

---

## 更新系统

### 从Git更新
```powershell
cd c:\growatt
git pull
cd GrowattMonitor.NET
dotnet restore
dotnet build
```

### 手动更新
1. 备份 `appsettings.json` 和 `logs` 文件夹
2. 下载新版本代码
3. 恢复配置文件和日志
4. 重新编译运行

---

## 系统维护

### 日志清理
CSV日志会持续增长，建议定期备份和清理：
```powershell
# 备份旧日志
Copy-Item c:\growatt\GrowattMonitor.NET\logs\* c:\backup\growatt_logs\

# 删除3个月前的日志
Get-ChildItem c:\growatt\GrowattMonitor.NET\logs\*.csv | 
  Where-Object {$_.LastWriteTime -lt (Get-Date).AddMonths(-3)} | 
  Remove-Item
```

### 监控系统运行
查看实时日志：
```powershell
cd c:\growatt\GrowattMonitor.NET
dotnet run | Tee-Object -FilePath system.log
```

---

## 技术支持

### 查看版本信息
```powershell
dotnet --info
```

### 查看依赖包
```powershell
cd c:\growatt\GrowattMonitor.NET
dotnet list package
```

### 重建项目
如果遇到问题，尝试清理重建：
```powershell
dotnet clean
dotnet restore
如果只是快速测试，只需3步：

1. **安装 .NET SDK (≥8.0)**
   - 下载最新版: https://dotnet.microsoft.com/download
   - 或下载 .NET 8.0 LTS: https://dotnet.microsoft.com/download/dotnet/8.0
   - 安装完成（如已有 .NET 9/10/11 等更高版本则跳过）

2. **解压项目到 c:\growatt**
如果只是快速测试，只需3步：

1. **安装 .NET 8.0 SDK**
   - 下载: https://dotnet.microsoft.com/download/dotnet/8.0
   - 安装完成

2. **解压项目到 c:\growatt**
   - 确保路径为 `c:\growatt\GrowattMonitor.NET\`

3. **运行**
   ```powershell
   cd c:\growatt\GrowattMonitor.NET
   dotnet run
   ```

打开浏览器访问 http://localhost:5000 即可！

---

## 常见问题FAQ

**Q: 需要安装数据库吗？**  
A: 不需要，数据保存在CSV文件中。
**Q: 可以在Linux上运行吗？**  
A: 可以！.NET 8.0支持跨平台，只需安装Linux版的.NET SDK。

**Q: 我已经安装了 .NET 10，需要降级到 .NET 8吗？**  
A: 不需要！.NET向上兼容，项目可以在任何 ≥8.0 的版本运行。建议使用最新版本以获得更好性能。

**Q: 耗电量如何？**  
A: 非常低，CPU占用 <1%，内存约50MB.
A: 非常低，CPU占用 <1%，内存约50MB。

**Q: 支持多个逆变器吗？**  
A: 当前版本仅支持单个逆变器，需要修改代码支持多个。

**Q: 数据多久保存一次？**  
A: 每次采集数据（默认30秒）都会立即保存到CSV。

---

## 许可证

本项目基于原Python版本改写，请遵守相应的开源协议。

---

**祝使用愉快！如有问题请查看日志文件或联系技术支持。**
