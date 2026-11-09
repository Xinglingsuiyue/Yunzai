PS1='\[\e[38;5;245m\]\W\[\e[0m\] \$ '
PROMPT_COMMAND=''
HISTFILE=/dev/null
HISTSIZE=500
shopt -s huponexit
stty rows "${YUNZAI_TERM_ROWS:-32}" cols "${YUNZAI_TERM_COLS:-120}" 2>/dev/null
bind 'set enable-bracketed-paste off' 2>/dev/null
bind 'set bell-style none' 2>/dev/null
bind 'set blink-matching-paren off' 2>/dev/null

if [ -n "$YUNZAI_NODE_DIR" ] && [ -d "$YUNZAI_NODE_DIR" ]; then
  case ":$PATH:" in
    *":$YUNZAI_NODE_DIR:"*) ;;
    *) PATH="$YUNZAI_NODE_DIR:$PATH" ;;
  esac
fi
