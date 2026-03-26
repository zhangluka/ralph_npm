#!/bin/bash

# 脚本名称: unified_processor.sh
# 功能: 根据YAML配置文件扫描和处理文件，支持多种运行模式
# 使用方法: bash unified_processor.sh --config ./config.yml

# 日志配置
SCRIPT_NAME=""
DEBUG_MODE=false
TEMP_LOG_NAME=$(pwd)/$(date "+%Y%m%d%H%M%S").log

# 全局变量存储失败文件列表
FAILED_FILES=()

# 日志函数
printLog() {
    if [ "$1" = "DEBUG" ] && [ "$DEBUG_MODE" = "false" ]; then
        return
    fi
	echo "[${1}][$(date "+%Y-%m-%d %H:%M:%S")]:${2}" | tee -a "$TEMP_LOG_NAME"
}

# 显示用法信息
show_usage() {
    printLog "INFO" "显示用法信息"
	echo ""
    echo "用法: devAgentBatch --config <config_file>"
	echo "示例: devAgentBatch --config ./config.yml"
    echo "选项:"
    echo "  --config    指定YAML配置文件路径"
    echo "  --help      显示帮助信息"
    exit 1
}

# 检查yq是否安装
check_dependencies() {
    printLog "INFO" "开始检查依赖"
    if ! command -v yq &> /dev/null; then
        printLog "ERROR" "未找到yq命令，请先安装yq"
        echo "安装方法:"
        echo "  macOS: brew install yq"
        echo "  Linux: sudo snap install yq 或从GitHub releases下载"
        exit 1
    fi
    printLog "INFO" "依赖检查完成"
}

# 解析命令行参数
parse_arguments() {
    printLog "INFO" "开始解析命令行参数"
    if [ $# -eq 0 ]; then
        printLog "WARN" "未提供命令行参数"
        show_usage
    fi

    while [ $# -gt 0 ]; do
        case "$1" in
            --config)
                CONFIG_FILE="$2"
                printLog "DEBUG" "设置配置文件路径: $CONFIG_FILE"
                shift 2
                ;;
            --help)
                printLog "INFO" "显示帮助信息"
                show_usage
                ;;
            *)
                printLog "ERROR" "未知参数: $1"
                show_usage
                ;;
        esac
    done

    # 检查配置文件参数是否提供
    if [ -z "$CONFIG_FILE" ]; then
        printLog "ERROR" "未指定配置文件路径"
        show_usage
    fi

    # 检查配置文件是否存在
    if [ ! -f "$CONFIG_FILE" ]; then
        printLog "ERROR" "配置文件不存在: $CONFIG_FILE"
        exit 1
    fi
    printLog "INFO" "命令行参数解析完成"
}

# 从YAML配置文件中读取参数
read_config() {
    printLog "INFO" "开始读取配置文件: $CONFIG_FILE"

    # 读取任务名称（必传）
    SCRIPT_NAME=$(yq e '.name' "$CONFIG_FILE")
    if [ -z "$SCRIPT_NAME" ] || [ "$SCRIPT_NAME" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 name"
        exit 1
    fi

    # 读取debug模式（必传）
    DEBUG_MODE=$(yq e '.log.debug' "$CONFIG_FILE")
    if [ -z "$DEBUG_MODE" ] || [ "$DEBUG_MODE" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 log.debug"
        exit 1
    fi

    # 验证debug参数值
    if [ "$DEBUG_MODE" != "true" ] && [ "$DEBUG_MODE" != "false" ]; then
        printLog "ERROR" "debug参数值必须为 true 或 false，当前值为: $DEBUG_MODE"
        exit 1
    fi

    # 读取mode（必传）
    MODE=$(yq e '.run_mode.type' "$CONFIG_FILE")
    if [ -z "$MODE" ] || [ "$MODE" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 run_mode.type"
        exit 1
    fi

    # 验证mode参数值
    if [ "$MODE" -ne 1 ] && [ "$MODE" -ne 2 ] && [ "$MODE" -ne 3 ]; then
        printLog "ERROR" "run_mode.type参数值必须为 1、2 或 3，当前值为: $MODE"
        exit 1
    fi

    # 读取日志路径（必传）
    LOG_FILE=$(yq e '.log.path' "$CONFIG_FILE")
    if [ -z "$LOG_FILE" ] || [ "$LOG_FILE" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 log.path"
        exit 1
    fi

    # 读取日志标志（必传）
    LOG_FLAG=$(yq e '.log.console_flag' "$CONFIG_FILE")
    if [ -z "$LOG_FLAG" ] || [ "$LOG_FLAG" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 log.console_flag"
        exit 1
    fi

    # 创建日志目录（如果不存在）
    LOG_DIR=$(dirname "$LOG_FILE")
    if [ ! -d "$LOG_DIR" ]; then
        mkdir -p "$LOG_DIR"
        printLog "INFO" "创建日志目录: $LOG_DIR"
    fi
 
	# 读取日志路径（必传）
    LOG_TASK_FILE=$(yq e '.log.task_path' "$CONFIG_FILE")
    if [ -z "$LOG_TASK_FILE" ] || [ "$LOG_TASK_FILE" == "null" ]; then
        printLog "ERROR" "配置文件中未找到 log.task_path"
        exit 1
    fi

    # 创建日志目录（如果不存在）
    LOG_TASK_DIR=$(dirname "$LOG_TASK_FILE")
    if [ ! -d "$LOG_TASK_DIR" ]; then
        mkdir -p "$LOG_TASK_DIR"
        printLog "INFO" "创建任务日志目录: $LOG_TASK_DIR"
    fi
 

    # 根据mode读取相应的配置
    if [ "$MODE" -eq 1 ] || [ "$MODE" -eq 2 ]; then
        # mode=1或2时，需要读取目标目录相关配置
        TARGET_DIR=$(yq e '.target.directory' "$CONFIG_FILE")
        if [ -z "$TARGET_DIR" ] || [ "$TARGET_DIR" == "null" ]; then
            printLog "ERROR" "配置文件中未找到 target.directory"
            exit 1
        fi

        # 读取包含的文件后缀
        INCLUDE_EXTENSIONS=()
        INCLUDE_ALL_FILES=false
        
        # 检查target.include是否存在且不为空
        if yq e '.target.include' "$CONFIG_FILE" | grep -q "null" || [ $(yq e '.target.include | length' "$CONFIG_FILE") -eq 0 ]; then
            printLog "INFO" "target.include 为空，将扫描所有文件"
            INCLUDE_ALL_FILES=true
        else
            while IFS= read -r line; do
                if [ -n "$line" ] && [ "$line" != "null" ]; then
                    INCLUDE_EXTENSIONS+=("$line")
                fi
            done < <(yq e '.target.include[]' "$CONFIG_FILE")
            printLog "INFO" "将扫描指定后缀的文件: ${INCLUDE_EXTENSIONS[*]}"
        fi

        # 读取排除的路径
        EXCLUDE_PATHS=()
        while IFS= read -r line; do
            if [ -n "$line" ] && [ "$line" != "null" ]; then
                EXCLUDE_PATHS+=("$line")
            fi
        done < <(yq e '.target.exclude[]' "$CONFIG_FILE")
    fi

    # 根据mode读取prompt或CSV配置
    if [ "$MODE" -eq 1 ]; then
        # mode=1: 从yml中读取prompt
        PROMPT=$(yq e '.run_mode.prompt' "$CONFIG_FILE")
        if [ -z "$PROMPT" ] || [ "$PROMPT" == "null" ]; then
            printLog "ERROR" "配置文件中未找到 prompt"
            exit 1
        fi
        printLog "DEBUG" "使用YAML中的prompt"
    elif [ "$MODE" -eq 2 ]; then
        # mode=2: 从文件中读取prompt
        PROMPT_TEMPLATE_FILE=$(yq e '.run_mode.prompt_template_path' "$CONFIG_FILE")
        if [ -z "$PROMPT_TEMPLATE_FILE" ] || [ "$PROMPT_TEMPLATE_FILE" == "null" ]; then
            printLog "ERROR" "mode=2时，配置文件中未找到 prompt_template_path"
            exit 1
        fi

        # 检查prompt模板文件是否存在
        if [ ! -f "$PROMPT_TEMPLATE_FILE" ]; then
            printLog "ERROR" "prompt模板文件不存在: $PROMPT_TEMPLATE_FILE"
            exit 1
        fi

        # 读取文件内容作为prompt
        PROMPT=$(cat "$PROMPT_TEMPLATE_FILE")
        if [ -z "$PROMPT" ]; then
            printLog "ERROR" "prompt模板文件内容为空: $PROMPT_TEMPLATE_FILE"
            exit 1
        fi
        printLog "DEBUG" "使用文件中的prompt模板: $PROMPT_TEMPLATE_FILE"
    elif [ "$MODE" -eq 3 ]; then
        # mode=3: 从CSV文件中读取数据
        CSV_PATH=$(yq e '.run_mode.csv_template_path' "$CONFIG_FILE")
        if [ -z "$CSV_PATH" ] || [ "$CSV_PATH" == "null" ]; then
            printLog "ERROR" "mode=3时，配置文件中未找到 run_mode.csv_template_path"
            exit 1
        fi

        # 检查CSV文件是否存在
        if [ ! -f "$CSV_PATH" ]; then
            printLog "ERROR" "CSV文件不存在: $CSV_PATH"
            exit 1
        fi
        printLog "DEBUG" "使用CSV文件: $CSV_PATH"
    fi

    printLog "INFO" "配置读取完成"
    printLog "DEBUG" "任务名称: $SCRIPT_NAME"
	printLog "DEBUG" "Debug模式: $DEBUG_MODE"
    printLog "DEBUG" "模式: $MODE"
    printLog "DEBUG" "日志文件: $LOG_FILE"
    printLog "DEBUG" "日志标志: $LOG_FLAG"
	printLog "DEBUG" "任务日志目录: $LOG_TASK_FILE"
    if [ "$MODE" -eq 1 ] || [ "$MODE" -eq 2 ]; then
        printLog "DEBUG" "目标目录: $TARGET_DIR"
        if [ "$INCLUDE_ALL_FILES" = "true" ]; then
            printLog "DEBUG" "包含后缀: 所有文件"
        else
            printLog "DEBUG" "包含后缀: ${INCLUDE_EXTENSIONS[*]}"
        fi
        printLog "DEBUG" "排除路径: ${EXCLUDE_PATHS[*]}"
    fi
    if [ "$MODE" -eq 1 ] || [ "$MODE" -eq 2 ]; then
        printLog "DEBUG" "提示信息: $PROMPT"
    fi
    if [ "$MODE" -eq 2 ]; then
        printLog "DEBUG" "Prompt模板文件: $PROMPT_TEMPLATE_FILE"
    fi
    if [ "$MODE" -eq 3 ]; then
        printLog "DEBUG" "CSV文件路径: $CSV_PATH"
    fi
    printLog "INFO" "配置文件读取完成"
}


# 检查文件是否在排除列表中
is_excluded() {
    local file_path="$1"

    for exclude_path in "${EXCLUDE_PATHS[@]}"; do
        # 使用通配符匹配
        if [[ "$file_path" == $exclude_path* ]]; then
            printLog "DEBUG" "文件被排除: $file_path (匹配排除模式: $exclude_path)"
            return 0  # 被排除
        fi
    done

    return 1  # 不被排除
}

# 检查文件后缀是否符合要求
has_valid_extension() {
    local file_path="$1"

    # 如果设置为包含所有文件，则直接返回true
    if [ "$INCLUDE_ALL_FILES" = "true" ]; then
        return 0  # 所有文件都符合
    fi

    # 否则检查文件后缀
    for extension in "${INCLUDE_EXTENSIONS[@]}"; do
        if [[ "$file_path" == *".$extension" ]]; then
            return 0  # 后缀符合
        fi
    done

    return 1  # 后缀不符合
}

# 扫描文件
scan_files() {
    printLog "INFO" "开始扫描文件，目标目录: $TARGET_DIR"

    # 检查目标目录是否存在
    if [ ! -d "$TARGET_DIR" ]; then
        printLog "ERROR" "目标目录不存在: $TARGET_DIR"
        exit 1
    fi

    # 查找所有文件
    local found_files=()
    local total_files=0
    local excluded_files=0
    local invalid_extension_files=0

    while IFS= read -r -d '' file; do
        ((total_files++))
        printLog "DEBUG" "检查文件: $file"

        # 检查文件后缀
        if has_valid_extension "$file"; then
            # 检查是否在排除列表中
            if ! is_excluded "$file"; then
                found_files+=("$file")
                printLog "DEBUG" "文件符合条件: $file"
            else
                ((excluded_files++))
            fi
        else
            ((invalid_extension_files++))
            printLog "DEBUG" "文件后缀不符合: $file"
        fi
    done < <(find "$TARGET_DIR" -type f -print0 2>/dev/null)

    printLog "INFO" "扫描完成统计:"
    printLog "INFO" "总文件数: $total_files"
    printLog "INFO" "符合条件的文件: ${#found_files[@]}"
    printLog "INFO" "被排除的文件: $excluded_files"
    printLog "INFO" "后缀不符合的文件: $invalid_extension_files"

    if [ ${#found_files[@]} -eq 0 ]; then
        printLog "WARN" "未找到任何符合条件的文件"
    else
        printLog "INFO" "找到 ${#found_files[@]} 个符合条件的文件"
        for file in "${found_files[@]}"; do
            printLog "INFO" "符合条件文件: $file"
        done
    fi

    # 返回找到的文件数组
    SCANNED_FILES=("${found_files[@]}")
}

# 检查结果中是否包含特定错误
check_result_error() {
    local result="$1"
    local file_path="$2"

    # 检查是否包含指定的错误信息
    if echo "$result" | grep -q "OpenAI API Streaming Error: 580 status code"; then
        printLog "ERROR" "检测到 OpenAI API Streaming Error: 580 status code"
        # 添加到失败文件列表
        FAILED_FILES+=("$file_path")
        return 1  # 表示有错误
    fi

    return 0  # 表示没有错误
}

# 从CSV文件中读取所有数据
read_csv_data() {
    local csv_file="$1"

    # 检查文件是否存在
    if [[ ! -f "$csv_file" ]]; then
        printLog "ERROR" "文件 '$csv_file' 不存在!"
        return 1
    fi

    # 读取CSV文件内容，跳过第一行标题
    # 使用awk来处理CSV，考虑字段中可能包含逗号的情况
    awk -F',' '
    NR > 1 {
        # 输出所有字段，用|分隔
        for(i=1; i<=NF; i++) {
            if(i>1) printf "|"
            # 去除字段前后的空格和引号
            gsub(/^[ \t"]+|[ \t"]+$/, "", $i)
            printf "%s", $i
        }
        printf "\n"
    }' "$csv_file"
}

# 获取CSV文件的标题行
get_csv_headers() {
    local csv_file="$1"

    # 读取第一行并处理
    head -1 "$csv_file" | awk -F',' '{
        for(i=1; i<=NF; i++) {
            # 去除字段前后的空格和引号
            gsub(/^[ \t"]+|[ \t"]+$/, "", $i)
            if(i>1) printf "|"
            printf "%s", $i
        }
        printf "\n"
    }'
}

# 替换模板中的变量
replace_template_variables() {
    local template="$1"
    local headers="$2"
    local values="$3"

    # 将标题和值分割成数组
    IFS='|' read -r -a header_array <<< "$headers"
    IFS='|' read -r -a value_array <<< "$values"

    local result="$template"

    # 遍历所有标题（从第3列开始，索引2）
    for ((i=2; i<${#header_array[@]}; i++)); do
        local var_name="${header_array[i]}"
        local var_value="${value_array[i]}"

        # 只有在变量值不为空时才进行替换
        if [ -n "$var_value" ]; then
            result="${result//\$\{${var_name}\}/$var_value}"
        fi
    done

    echo "$result"
}

# 处理CSV模式
process_csv_mode() {
    local csv_file="$CSV_PATH"

    printLog "INFO" "开始处理CSV文件: $csv_file"

    # 获取CSV标题
    local csv_headers
    csv_headers=$(get_csv_headers "$csv_file")
    if [ $? -ne 0 ]; then
        printLog "ERROR" "无法读取CSV文件的标题行"
        return 1
    fi

    printLog "DEBUG" "CSV标题: $csv_headers"

    # 读取CSV数据
    local csv_data
    csv_data=$(read_csv_data "$csv_file")
    if [ $? -ne 0 ]; then
        return 1
    fi

    # 创建处理日志目录
    local log_dir="$(dirname "$csv_file")/process_logs"
    if [ ! -d "$log_dir" ]; then
        mkdir -p "$log_dir"
        printLog "INFO" "创建处理日志目录: $log_dir"
    fi

    local line_count=0
    local success_count=0
    local failure_count=0
    local start_time=$(date +%s)

    # 逐行处理数据
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            ((line_count++))

            # 分割行数据
            IFS='|' read -r path prompt_value remaining_values <<< "$line"

            printLog "INFO" "[$line_count] 处理CSV第${line_count}行"
            printLog "DEBUG" "路径: $path"
            printLog "DEBUG" "提示词模板: $prompt_value"
            printLog "DEBUG" "其他值: $remaining_values"

            # 替换模板变量
            local final_prompt
            final_prompt=$(replace_template_variables "$prompt_value" "$csv_headers" "$line")
            printLog "INFO" "替换后的提示词: $final_prompt"

            # 生成日志文件名
            local log_file="$log_dir/csv_line_${line_count}.log"

            # 开始记录日志到文件
            {
                echo "========================================"
                echo "处理时间: $(date)"
                echo "CSV行号: $line_count"
                echo "工作目录: $path"
                echo "原始提示词: $prompt_value"
                echo "替换后提示词: $final_prompt"
                echo "----------------------------------------"
            } > "$log_file"

            # 执行命令
            local result=""
            local exit_code=0

            if [[ -n "$path" ]]; then
                printLog "DEBUG" "切换到目录: $path"
                # 切换到指定目录执行命令，并重定向输出到临时文件
                local temp_result_file=$(mktemp)

                (
                    cd "$path" || {
                        printLog "ERROR" "无法切换到目录: $path"
                        exit 1
                    }
                    # 执行命令，将结果保存到临时文件

                    if [[ "$LOG_FLAG" == "true" ]]; then
                        printLog "INFO" "执行结果:"
                        # 同时输出到控制台和临时文件
                        echo "$final_prompt" | devagent --yolo 2>&1 | tee "$temp_result_file"
                        exit_code=${PIPESTATUS[0]}
                    else
                        # 只保存到临时文件
                        echo "$final_prompt" | devagent --yolo 2>&1 > "$temp_result_file"
                        exit_code=$?
                    fi
                )

                # 读取执行结果
                result=$(cat "$temp_result_file")
                rm -f "$temp_result_file"
            else
                # 在当前目录执行命令
                local temp_result_file=$(mktemp)

                if [[ "$LOG_FLAG" == "true" ]]; then
                    printLog "INFO" "执行结果:"
                    echo "$final_prompt" | devagent --yolo 2>&1 | tee "$temp_result_file"
                    exit_code=${PIPESTATUS[0]}
                else
                    echo "$final_prompt" | devagent --yolo 2>&1 > "$temp_result_file"
                    exit_code=$?
                fi

                # 读取执行结果
                result=$(cat "$temp_result_file")
                rm -f "$temp_result_file"
            fi

            # 检查结果中是否包含特定错误
            check_result_error "$result" "CSV第${line_count}行"
            has_api_error=$?

            # 将结果追加到日志文件
            {
                echo "执行结果:"
                echo "$result"
                echo "----------------------------------------"
                echo "退出码: $exit_code"
                if [ $exit_code -eq 0 ] && [ $has_api_error -eq 0 ]; then
                    echo "状态: 成功"
                    ((success_count++))
                else
                    echo "状态: 失败"
                    if [ $has_api_error -eq 1 ]; then
                        echo "失败原因: 检测到 OpenAI API Streaming Error"
                    fi
                    ((failure_count++))
                fi
                echo "========================================"
            } >> "$log_file"

            # 将执行结果也记录到主日志中
            #printLog "INFO" "执行结果:"
            #echo "$result" | while IFS= read -r result_line; do
            #   printLog "INFO" "$result_line"
            #done
			if [[ "$LOG_FLAG" == "true" ]]; then
			#            printLog "INFO" "执行结果:"
						echo "$result" >> "$TEMP_LOG_NAME"
			#            printLog "INFO" "----------------------------------------"
					fi
            echo ""
        fi
    done <<< "$csv_data"

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # 将耗时转换为更友好的格式
    if [ $duration -lt 60 ]; then
        time_display="${duration}秒"
    elif [ $duration -lt 3600 ]; then
        minutes=$((duration / 60))
        seconds=$((duration % 60))
        time_display="${minutes}分${seconds}秒"
    else
        hours=$((duration / 3600))
        minutes=$(( (duration % 3600) / 60 ))
        seconds=$((duration % 60))
        time_display="${hours}小时${minutes}分${seconds}秒"
    fi

    # 打印最终统计结果
    printLog "INFO" "========================================"
    printLog "INFO" "CSV处理完成!"
    printLog "INFO" "成功: $success_count 行"
    printLog "INFO" "失败: $failure_count 行"
    printLog "INFO" "总计: $line_count 行"
    printLog "INFO" "运行时间：$time_display"
    printLog "INFO" "详细日志请查看 $log_dir 目录"
}

# 处理文件（mode 1和2）
process_files() {
    local files=("${SCANNED_FILES[@]}")
    local total_files=${#files[@]}
    local success_count=0
    local failure_count=0
    local start_time=$(date +%s)

    # 创建处理日志目录（使用log.task）
    local log_dir="$LOG_TASK_FILE/process_logs"
    if [ ! -d "$log_dir" ]; then
        mkdir -p "$log_dir"
        printLog "INFO" "创建处理日志目录: $log_dir"
    fi

    printLog "INFO" "开始处理 $total_files 个文件"

    # 循环处理每个文件
    for i in "${!files[@]}"; do
        file_path="${files[i]}"
        current_num=$((i + 1))

        # 生成日志文件名（基于原文件名，但不包含后缀）
        filename=$(basename "$file_path")
        filename_no_ext="${filename%.*}"  # 移除文件扩展名
        log_file="$log_dir/${filename_no_ext}.log"

        printLog "INFO" "[$current_num/$total_files] 正在处理: $file_path"
        printLog "DEBUG" "日志文件: $log_file"

        # 构建prompt：将${file}替换为实际文件路径
        custom_prompt="${PROMPT//\$\{file\}/$file_path}"

        printLog "INFO" "当前prompt为 $custom_prompt"

        # 获取文件所在目录
        file_dir=$(dirname "$file_path")
        printLog "DEBUG" "切换到文件目录: $file_dir"

        # 开始记录日志到文件
        {
            echo "========================================"
            echo "处理时间: $(date)"
            echo "文件: $file_path"
            echo "进度: [$current_num/$total_files]"
            echo "提示语: $custom_prompt"
            echo "工作目录: $file_dir"
            echo "----------------------------------------"
        } > "$log_file"

        # 执行命令并处理输出
        if [[ "$LOG_FLAG" == "true" ]]; then
            # 当需要显示日志时，使用tee同时输出到控制台和变量
            printLog "INFO" "执行结果:"

            # 创建临时文件来存储结果
            temp_file=$(mktemp)

            # 执行命令，使用tee同时输出到控制台和临时文件
            # 切换到文件目录执行命令
            (
                cd "$file_dir" || {
                    printLog "ERROR" "无法切换到目录: $file_dir"
                    exit 1
                }
                echo "$custom_prompt" | devagent --yolo 2>&1 | tee "$temp_file" | while IFS= read -r line; do
                    # 实时输出到控制台
                    echo "$line"
                done
            )

            # 获取退出码
            exit_code=$?

            # 从临时文件读取完整结果
            result=$(cat "$temp_file")
            rm "$temp_file"

        else
            # 当不需要显示日志时，只存储结果到变量
            # 切换到文件目录执行命令
            (
                cd "$file_dir" || {
                    printLog "ERROR" "无法切换到目录: $file_dir"
                    exit 1
                }
                result=$(echo "$custom_prompt" | devagent --yolo 2>&1)
            )
            exit_code=$?
        fi

        # 检查结果中是否包含特定错误
        check_result_error "$result" "$file_path"
        has_api_error=$?

        # 将结果追加到日志文件
        {
            echo "执行结果:"
            echo "$result"
            echo "----------------------------------------"
            echo "退出码: $exit_code"
            if [ $exit_code -eq 0 ] && [ $has_api_error -eq 0 ]; then
                echo "状态: 成功"
            else
                echo "状态: 失败"
                if [ $has_api_error -eq 1 ]; then
                    echo "失败原因: 检测到 OpenAI API Streaming Error"
                fi
            fi
            echo "========================================"
        } >> "$log_file"

        # 根据log标志决定是否在控制台打印结果
        if [[ "$LOG_FLAG" == "true" ]]; then
#            printLog "INFO" "执行结果:"
            echo "$result" >> "$TEMP_LOG_NAME"
#            printLog "INFO" "----------------------------------------"
        fi

        # 判断执行状态并更新计数器
        if [ $exit_code -eq 0 ] && [ $has_api_error -eq 0 ]; then
            ((success_count++))
            printLog "INFO" "命令执行成功"
        else
            ((failure_count++))
            printLog "ERROR" "命令执行失败，退出码: $exit_code"
            # 即使不显示完整结果，失败时也显示部分错误信息
            if [[ "$LOG_FLAG" == "false" ]]; then
                printLog "ERROR" "错误信息: $(echo "$result" | head -5)"  # 只显示前5行错误信息
            fi
        fi
        echo ""
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # 将耗时转换为更友好的格式
    if [ $duration -lt 60 ]; then
        time_display="${duration}秒"
    elif [ $duration -lt 3600 ]; then
        minutes=$((duration / 60))
        seconds=$((duration % 60))
        time_display="${minutes}分${seconds}秒"
    else
        hours=$((duration / 3600))
        minutes=$(( (duration % 3600) / 60 ))
        seconds=$((duration % 60))
        time_display="${hours}小时${minutes}分${seconds}秒"
    fi

    # 打印最终统计结果
    printLog "INFO" "========================================"
    printLog "INFO" "处理完成!"
    printLog "INFO" "成功: $success_count 个文件"
    printLog "INFO" "失败: $failure_count 个文件"
	# 打印失败文件列表（使用DEBUG级别）
    if [ ${#FAILED_FILES[@]} -gt 0 ]; then
        printLog "DEBUG" "失败文件列表:"
        for failed_file in "${FAILED_FILES[@]}"; do
            printLog "DEBUG" "  - $failed_file"
        done
    fi	
    printLog "INFO" "总计: $total_files 个文件"
    printLog "INFO" "运行时间：$time_display"
    printLog "INFO" "详细日志请查看 $log_dir 目录"
}

# 主函数
main() {
    local start_time=$(date +%s)

    # 检查依赖
    check_dependencies

    # 解析参数
    parse_arguments "$@"

    # 读取配置
    read_config

    # 现在使用配置中的name来记录启动日志
    printLog "INFO" "$SCRIPT_NAME 启动"
    printLog "DEBUG" "当前工作目录: $(pwd)"
	printLog "DEBUG" "Debug模式: $DEBUG_MODE"
    printLog "DEBUG" "运行模式: $MODE"

    # 根据不同的模式执行不同的处理逻辑
    if [ "$MODE" -eq 1 ] || [ "$MODE" -eq 2 ]; then
        # 扫描文件
        scan_files

        # 处理文件
        if [ ${#SCANNED_FILES[@]} -gt 0 ]; then
            process_files
        else
            printLog "WARN" "没有文件需要处理"
            exit 0
        fi
    elif [ "$MODE" -eq 3 ]; then
        # 处理CSV模式
        process_csv_mode
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    printLog "INFO" "脚本执行完成，总耗时: ${duration}秒"
	mv $TEMP_LOG_NAME $LOG_FILE
}

# 运行主函数
main "$@"