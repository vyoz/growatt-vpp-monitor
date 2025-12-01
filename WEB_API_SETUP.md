# Growatt Web API 配置指南

## 为什么使用Web API？

Modbus TCP连接不稳定，经常卡住。通过Growatt官方Web API获取数据更可靠。

## 配置步骤

### 方法1：使用配置向导（推荐）

1. 运行 `setup-web-api.ps1`
2. 按提示输入信息
3. 运行 `restart-clean.bat` 重启程序

### 方法2：手动配置

编辑 `appsettings.json`：

```json
{
  "Growatt": {
    "DataSource": "web",  // 改为 "web"
    "Web": {
      "Username": "您的Growatt账号",
      "Password": "您的Growatt密码",
      "PlantId": "电站ID",
      "SerialNumber": "逆变器序列号"
    }
  }
}
```

## 如何获取 PlantId 和 SerialNumber？

### 方法1：通过浏览器开发者工具

1. 访问 https://server.growatt.com 并登录
2. 按 F12 打开开发者工具
3. 切换到 **Network (网络)** 标签
4. 刷新页面
5. 查找以下请求：

**获取 PlantId:**
- 找到包含 `plantList` 或 `getPlantList` 的请求
- 查看响应内容，找到 `"id"` 或 `"plantId"` 字段
- 通常是一串数字，如：`123456`

**获取 SerialNumber:**
- 找到包含 `inverter` 或 `device` 的请求
- 查看响应内容，找到 `"sn"` 或 `"serialNumber"` 字段
- 通常格式类似：`ABCDE1234567890`

### 方法2：从URL中获取

登录后，查看浏览器地址栏的URL，可能包含这些参数：
- `plantId=123456`
- `sn=ABCDE1234567890`

### 方法3：使用测试脚本

运行 `test-web-api.ps1`（待创建），它会尝试登录并列出所有设备。

## 切换回 Modbus

如果想切换回本地Modbus连接：

编辑 `appsettings.json`：
```json
{
  "Growatt": {
    "DataSource": "modbus"  // 改为 "modbus"
  }
}
```

然后重启程序。

## 优势对比

| 特性 | Modbus TCP | Web API |
|------|-----------|---------|
| 稳定性 | ⚠️ 经常卡住 | ✅ 稳定 |
| 延迟 | ✅ 实时 | ⚠️ 略有延迟(30-60秒) |
| 数据完整性 | ✅ 完整 | ✅ 完整 |
| 需要网络 | ❌ 仅局域网 | ✅ 需要互联网 |
| 配置难度 | ✅ 简单 | ⚠️ 需要账号信息 |

## 故障排除

**登录失败：**
- 检查用户名和密码是否正确
- 确认能在浏览器中正常登录

**找不到数据：**
- 检查 PlantId 和 SerialNumber 是否正确
- 查看程序日志了解详细错误信息

**数据不更新：**
- 确认互联网连接正常
- Growatt服务器可能维护中，稍后再试
