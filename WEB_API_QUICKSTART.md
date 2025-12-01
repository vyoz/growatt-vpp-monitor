# 🌐 Growatt Web API 快速开始

## 🎯 三步切换到稳定的Web API

### 步骤 1：获取设备信息

运行 `get-device-info.bat`，输入您的Growatt账号密码：

```
用户名: your_email@example.com
密码: your_password
```

脚本会自动获取并显示：
- ✅ Plant ID（电站ID）
- ✅ Serial Number（逆变器序列号）

### 步骤 2：配置账号信息

编辑 `appsettings.json`，找到 `"Web"` 部分，填入信息：

```json
"Web": {
  "Username": "your_email@example.com",
  "Password": "your_password",
  "PlantId": "123456",
  "SerialNumber": "ABC1234567890"
}
```

### 步骤 3：切换数据源

方法A - 使用切换工具（推荐）:
```
运行 switch-data-source.bat
选择 "2" (Web API)
```

方法B - 手动修改:
```json
"DataSource": "web"  // 改为 "web"
```

### 步骤 4：重启程序

```
运行 restart-clean.bat
```

---

## ✅ 验证连接

查看程序日志，应该看到：
```
Data Polling Service started. Source: web
Using Growatt Web API as data source
Successfully logged in to Growatt server
Retrieved data from Growatt API: Solar=1.5kW, Load=0.8kW
```

---

## 🔄 切换回Modbus

如果想切换回本地Modbus：

```
运行 switch-data-source.bat
选择 "1" (Modbus TCP)
运行 restart-clean.bat
```

---

## 🆚 对比

| 特性 | Modbus TCP | Web API |
|------|-----------|---------|
| **稳定性** | ⚠️ 经常卡住 | ✅ **稳定可靠** |
| **延迟** | ✅ 实时 | ⚠️ 30-60秒延迟 |
| **配置** | ✅ 简单 | ⚠️ 需要账号 |
| **网络** | ✅ 仅局域网 | ⚠️ 需要互联网 |
| **推荐** | ❌ | ✅ **推荐** |

---

## ❓ 故障排除

### 登录失败
- 检查用户名/密码是否正确
- 在浏览器中测试能否登录 https://server.growatt.com

### 找不到设备
- 确认 Plant ID 和 Serial Number 正确
- 运行 `get-device-info.bat` 重新获取

### 数据不更新
- 检查网络连接
- 查看程序日志了解详细错误

---

## 📝 配置示例

完整的 `appsettings.json` 配置：

```json
{
  "Growatt": {
    "DataSource": "web",
    "Modbus": {
      "IpAddress": "192.168.0.156",
      "Port": 502,
      "UnitId": 1
    },
    "Web": {
      "Username": "your_email@example.com",
      "Password": "your_password",
      "PlantId": "123456",
      "SerialNumber": "ABC1234567890"
    },
    "PollingInterval": 60,
    "HistorySize": 2000,
    "LogDirectory": "./logs",
    "RetryTimeout": 8,
    "RetryDelay": 0.5
  }
}
```

---

## 🎉 享受稳定的数据采集！

切换到Web API后，程序将：
- ✅ 不再卡住
- ✅ 稳定运行24/7
- ✅ 数据完整可靠
- ✅ 无需手动重启
