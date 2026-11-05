# WebUI 终端启动脚本：只保留最小交互配置，不读取用户历史与个性化设置
PS1='\[\e[38;5;245m\]\W\[\e[0m\] \$ '
PROMPT_COMMAND=''
HISTFILE=/dev/null
HISTSIZE=500
shopt -s huponexit
stty rows 32 cols 120 2>/dev/null
bind 'set enable-bracketed-paste off' 2>/dev/null
bind 'set bell-style none' 2>/dev/null
bind 'set blink-matching-paren off' 2>/dev/null

# 让终端里直接使用机器人自身的 node 运行时
if [ -n "$YUNZAI_NODE_DIR" ] && [ -d "$YUNZAI_NODE_DIR" ]; then
  case ":$PATH:" in
    *":$YUNZAI_NODE_DIR:"*) ;;
    *) PATH="$YUNZAI_NODE_DIR:$PATH" ;;
  esac
fi
