#!/bin/bash

# Memory monitoring script for tag-editor uploads
# Usage: ./monitor-upload.sh

echo "Starting memory monitoring for tag-editor container..."
echo "Press Ctrl+C to stop monitoring"
echo ""

# Function to format bytes
format_bytes() {
    local bytes=$1
    if [ $bytes -ge 1073741824 ]; then
        echo "$(( bytes / 1073741824 ))GB"
    elif [ $bytes -ge 1048576 ]; then
        echo "$(( bytes / 1048576 ))MB"
    elif [ $bytes -ge 1024 ]; then
        echo "$(( bytes / 1024 ))KB"
    else
        echo "${bytes}B"
    fi
}

# Monitor loop
while true; do
    # Get container stats
    STATS=$(docker stats tag-editor-tag-editor-1 --no-stream --format "table {{.MemUsage}}\t{{.CPUPerc}}")
    
    if [ $? -eq 0 ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - $STATS"
        
        # Check if memory usage is above 6GB
        MEM_USAGE=$(echo "$STATS" | tail -n +2 | awk '{print $1}' | cut -d'/' -f1 | sed 's/[^0-9.]//g')
        MEM_UNIT=$(echo "$STATS" | tail -n +2 | awk '{print $1}' | cut -d'/' -f1 | sed 's/[0-9.]//g')
        
        if [[ "$MEM_UNIT" == "GiB" && $(echo "$MEM_USAGE > 6" | bc -l) -eq 1 ]]; then
            echo "⚠️  WARNING: Memory usage above 6GB!"
        fi
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Container not running or error getting stats"
    fi
    
    sleep 5
done
