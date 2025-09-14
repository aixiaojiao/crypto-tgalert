#!/bin/bash

# Debug日志报告发送脚本
# 每天早上8点(UTC+8)通过Telegram Bot发送未修复的debug记录

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$REPO_DIR/logs/debug-report.log"
DEBUG_FILE="$REPO_DIR/logs/debug-records.md"

# 日志记录函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🔍 开始生成每日Debug报告"

# 检查debug记录文件是否存在
if [ ! -f "$DEBUG_FILE" ]; then
    log "⚠️  Debug记录文件不存在: $DEBUG_FILE"
    exit 0
fi

# 检查环境变量
if [ ! -f "$REPO_DIR/.env" ]; then
    log "❌ 未找到.env文件"
    exit 1
fi

# 加载环境变量
source "$REPO_DIR/.env"

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    log "❌ 缺少必要的Telegram配置 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)"
    exit 1
fi

# 创建临时文件存储未修复的debug记录
TEMP_FILE="/tmp/unfixed-debug-records.txt"
> "$TEMP_FILE"

# 解析debug-records.md文件，提取未修复记录
awk '
BEGIN { 
    in_pending = 0
    current_record = ""
    record_count = 0
}

# 匹配PENDING状态的记录开始
/^## \[PENDING\]/ {
    in_pending = 1
    current_record = $0 "\n"
    next
}

# 匹配下一个记录的开始（FIXED或PENDING）或文件结束
/^## \[/ && in_pending && !/^## \[PENDING\]/ {
    in_pending = 0
    if (current_record != "") {
        print current_record
        record_count++
        current_record = ""
    }
}

# 收集当前PENDING记录的内容
in_pending {
    current_record = current_record $0 "\n"
}

# 文件结束时处理最后一个PENDING记录
END {
    if (in_pending && current_record != "") {
        print current_record
        record_count++
    }
    # 输出统计信息到stderr，方便shell脚本获取
    print record_count > "/dev/stderr"
}
' "$DEBUG_FILE" > "$TEMP_FILE" 2>/tmp/record_count.txt

# 获取未修复记录数量
UNFIXED_COUNT=$(cat /tmp/record_count.txt 2>/dev/null || echo "0")

log "📊 发现 $UNFIXED_COUNT 个未修复的Debug记录"

# 如果没有未修复记录，发送无问题报告
if [ "$UNFIXED_COUNT" -eq 0 ]; then
    REPORT_MSG="✅ **每日Debug状态报告**

📅 **日期**: $(date '+%Y年%m月%d日 %H:%M')
🖥️ **服务器**: $(hostname)
⏱️ **运行时长**: $(uptime -p)

🎉 **状态**: 系统运行良好，无待修复Debug记录

📈 **系统概况**:
• 内存使用: $(free -h | grep '^Mem:' | awk '{print $3 "/" $2}')
• 磁盘使用: $(df -h / | tail -1 | awk '{print $3 "/" $2}')
• 进程状态: $(pm2 jlist 2>/dev/null | jq -r '.[0].pm2_env.status' 2>/dev/null || echo "运行中")

---
*自动化Debug监控系统*"

else
    # 格式化未修复记录为Telegram消息
    REPORT_MSG="🚨 **每日Debug状态报告**

📅 **日期**: $(date '+%Y年%m月%d日 %H:%M')
🖥️ **服务器**: $(hostname)
⚠️ **待修复问题**: $UNFIXED_COUNT 个

$(
# 处理每个未修复记录
record_num=1
while IFS= read -r line; do
    if [[ "$line" =~ ^\#\#\ \[PENDING\] ]]; then
        # 提取时间戳和Debug ID
        timestamp=$(echo "$line" | sed -E 's/.*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2}).*/\1/')
        debug_id=$(echo "$line" | sed -E 's/.*(debug-[0-9]{8}-[0-9]{6}-[a-zA-Z0-9]+).*/\1/')
        echo ""
        echo "**🔸 问题 #$record_num**"
        echo "**时间**: $timestamp"
        echo "**ID**: \`$debug_id\`"
        record_num=$((record_num + 1))
    elif [[ "$line" =~ ^\*\*用户ID\*\* ]]; then
        user_id=$(echo "$line" | sed -E 's/.*: ([0-9]+).*/\1/')
        echo "**用户**: $user_id"
    elif [[ "$line" =~ ^\*\*Debug内容\*\* ]]; then
        # 读取下一行作为debug内容
        debug_content=""
        while IFS= read -r next_line && [[ ! "$next_line" =~ ^--- ]]; do
            if [[ -n "$next_line" ]]; then
                debug_content="$debug_content$next_line "
            fi
        done
        if [[ -n "$debug_content" ]]; then
            echo "**问题**: $debug_content"
        fi
        echo ""
    fi
done < "$TEMP_FILE"
)

📈 **系统状态**:
• 内存: $(free -h | grep '^Mem:' | awk '{print $3 "/" $2}')
• 磁盘: $(df -h / | tail -1 | awk '{print $3 "/" $2}')
• 进程: $(pm2 jlist 2>/dev/null | jq -r '.[0].pm2_env.status' 2>/dev/null || echo "运行中")

---
*发现问题请及时处理并标记为 [FIXED]*"

fi

# 由于Telegram消息长度限制，如果内容过长则分割发送
MESSAGE_MAX_LENGTH=4000
MESSAGE_LENGTH=${#REPORT_MSG}

if [ "$MESSAGE_LENGTH" -gt "$MESSAGE_MAX_LENGTH" ]; then
    log "⚠️  消息过长 ($MESSAGE_LENGTH 字符)，分割发送"
    
    # 发送标题部分
    HEADER_MSG="🚨 **每日Debug状态报告**

📅 **日期**: $(date '+%Y年%m月%d日 %H:%M')
🖥️ **服务器**: $(hostname)
⚠️ **待修复问题**: $UNFIXED_COUNT 个

---
*报告内容较多，分多条消息发送*"
    
    "$REPO_DIR/scripts/send-notification.sh" "$HEADER_MSG"
    sleep 2
    
    # 分割问题详情发送
    problem_count=0
    current_msg=""
    
    while IFS= read -r line; do
        if [[ "$line" =~ ^\*\*🔸\ 问题 ]]; then
            if [[ -n "$current_msg" && ${#current_msg} -gt 500 ]]; then
                "$REPO_DIR/scripts/send-notification.sh" "$current_msg"
                sleep 2
                current_msg=""
            fi
        fi
        current_msg="$current_msg$line"$'\n'
    done < <(echo "$REPORT_MSG" | grep -A 20 "**🔸 问题")
    
    if [[ -n "$current_msg" ]]; then
        "$REPO_DIR/scripts/send-notification.sh" "$current_msg"
    fi
    
else
    # 消息长度合适，直接发送
    "$REPO_DIR/scripts/send-notification.sh" "$REPORT_MSG"
fi

# 清理临时文件
rm -f "$TEMP_FILE" /tmp/record_count.txt

log "✅ Debug报告发送完成，包含 $UNFIXED_COUNT 个待修复问题"

# 记录发送历史
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 发送Debug报告: $UNFIXED_COUNT 个待修复问题" >> "$REPO_DIR/logs/debug-report-history.log"