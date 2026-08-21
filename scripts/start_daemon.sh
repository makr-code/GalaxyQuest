#!/bin/bash
# Daemon wrapper script
# Writes all output to a log file

LOG_FILE="/tmp/daemon_trellis2.log"
PID_FILE="/tmp/daemon_trellis2.pid"

# Check if daemon is already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Daemon already running with PID $OLD_PID"
        exit 0
    fi
fi

# Start daemon
echo "Starting TRELLIS2 daemon..." > "$LOG_FILE"
nohup php /var/www/html/scripts/daemon_trellis2_jobs_v2.php >> "$LOG_FILE" 2>&1 &
DAEMON_PID=$!

echo $DAEMON_PID > "$PID_FILE"
echo "Daemon started with PID $DAEMON_PID" | tee -a "$LOG_FILE"
