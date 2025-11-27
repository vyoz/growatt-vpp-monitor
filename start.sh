#!/bin/bash

# Growatt Solar Monitor - 一键启动脚本

echo "======================================"
echo "   Growatt Solar Monitor 启动脚本"
echo "======================================"
echo ""

# 检查Python版本
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到Python3,请先安装Python 3.8或更高版本"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "✅ 找到Python版本: $PYTHON_VERSION"

# 检查依赖是否安装
echo ""
echo "📦 检查依赖..."
if ! python3 -c "import flask" 2>/dev/null; then
    echo "⚠️  未找到Flask,正在安装依赖..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败,请手动运行: pip3 install -r requirements.txt"
        exit 1
    fi
    echo "✅ 依赖安装完成"
else
    echo "✅ 依赖已安装"
fi

# 检查配置文件
echo ""
echo "⚙️  检查配置文件..."
if [ ! -f "config.json" ]; then
    echo "⚠️  未找到config.json,使用默认配置"
    echo "   请根据需要修改config.json中的IP地址和其他设置"
else
    INVERTER_IP=$(grep -o '"ip"[[:space:]]*:[[:space:]]*"[^"]*"' config.json | cut -d'"' -f4)
    echo "✅ 配置文件存在,逆变器IP: $INVERTER_IP"
fi

# 启动API服务器
echo ""
echo "🚀 启动API服务器..."
echo "   访问地址: http://localhost:5000"
echo "   按 Ctrl+C 停止服务器"
echo ""
echo "======================================"
echo ""

# 使用nohup在后台运行,并将输出重定向到日志文件
PORT=5002 nohup python3 src/api_server.py >> api_server.log 2>&1 &
API_PID=$!

echo "API服务器PID: $API_PID"
echo ""

# 等待API服务器启动
echo "⏳ 等待API服务器启动..."
sleep 3

# 检查API服务器是否运行
if ps -p $API_PID > /dev/null; then
    echo "✅ API服务器运行中"
    echo ""
    echo "📊 现在可以打开仪表板了:"
    echo "   方式1: 直接在浏览器中打开 dashboard.html"
    echo "   方式2: 运行以下命令启动Web服务器:"
    echo "          python3 -m http.server 8000"
    echo "          然后访问 http://localhost:8000/dashboard.html"
    echo ""
    echo "📝 日志文件: api_server.log"
    echo ""
    echo "🛑 停止服务器: kill $API_PID"
    echo ""
    
    # 保存PID到文件
    echo $API_PID > api_server.pid
    echo "PID已保存到 api_server.pid"
    
    # 等待用户按Ctrl+C
    echo ""
    echo "按 Ctrl+C 停止服务器..."
    wait $API_PID
else
    echo "❌ API服务器启动失败,请检查日志: api_server.log"
    exit 1
fi
