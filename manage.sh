#!/bin/bash

# KeyProxy Management Script for Linux/VPS
# Usage: ./manage.sh [start|stop|restart|status|logs]

PORT=8990
APP_NAME="KeyProxy"
LOG_DIR="./logs"
STDOUT_LOG="$LOG_DIR/stdout.log"
STDERR_LOG="$LOG_DIR/stderr.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

get_pid() {
    lsof -t -i :$PORT
}

case "$1" in
    start)
        pid=$(get_pid)
        if [ -n "$pid" ]; then
            echo -e "\e[33m✅ $APP_NAME is already running on port $PORT (PID: $pid)\e[0m"
        else
            echo -e "\e[36m🚀 Starting $APP_NAME in background...\e[0m"
            nohup node main.js > "$STDOUT_LOG" 2> "$STDERR_LOG" &
            sleep 2
            new_pid=$(get_pid)
            if [ -n "$new_pid" ]; then
                echo -e "\e[32m✅ $APP_NAME started (PID: $new_pid)\e[0m"
                echo "   Admin: http://localhost:$PORT/admin"
            else
                echo -e "\e[31m❌ Failed to start $APP_NAME. Check: $STDERR_LOG\e[0m"
            fi
        fi
        ;;
    stop)
        pid=$(get_pid)
        if [ -n "$pid" ]; then
            echo -e "\e[36m🛑 Stopping $APP_NAME (PID: $pid)...\e[0m"
            kill "$pid"
            sleep 1
            echo -e "\e[32m✅ $APP_NAME stopped.\e[0m"
        else
            echo -e "\e[33m$APP_NAME is not running on port $PORT.\e[0m"
        fi
        ;;
    restart)
        "$0" stop
        sleep 1
        "$0" start
        ;;
    status)
        pid=$(get_pid)
        if [ -n "$pid" ]; then
            echo -e "\e[32m✅ $APP_NAME is RUNNING (PID: $pid, Port: $PORT)\e[0m"
            echo "   Admin: http://localhost:$PORT/admin"
        else
            echo -e "\e[31m🔴 $APP_NAME is STOPPED\e[0m"
        fi
        ;;
    logs)
        if [ ! -f "$STDOUT_LOG" ]; then
            echo -e "\e[33mLog file not found: $STDOUT_LOG\e[0m"
            exit 1
        fi
        echo -e "\e[90mTailing $APP_NAME logs... (Ctrl+C to stop)\e[0m"
        tail -f "$STDOUT_LOG"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
