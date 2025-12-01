# 测试脚本说明

## 注意事项

⚠️ **所有 `test-*.ps1` 和 `debug-*.ps1` 文件已被 `.gitignore` 排除，不会提交到 Git。**

这些脚本仅用于本地开发测试，包含账户信息，**不应提交到版本控制**。

## 使用测试脚本

### 1. 创建您的测试脚本

复制示例文件：

```powershell
Copy-Item test-api.ps1.sample test-api.ps1
```

### 2. 编辑测试脚本

编辑 `test-api.ps1`，填入您的实际账户信息：

```powershell
param(
    [string]$Username = "your-actual-username",
    [string]$Password = "your-actual-password",
    [string]$BaseUrl = "http://localhost:5000"
)
```

### 3. 运行测试

```powershell
.\test-api.ps1
```

或指定参数：

```powershell
.\test-api.ps1 -Username "user" -Password "pass" -BaseUrl "http://192.168.1.100:5000"
```

## 现有测试脚本

如果您已有包含账户信息的测试脚本，它们会被 `.gitignore` 自动排除，不会意外提交。

建议：
- 定期检查 `git status` 确保没有敏感文件
- 使用 `git add -p` 逐个确认要提交的文件
- 提交前运行 `git diff --staged` 检查暂存内容
