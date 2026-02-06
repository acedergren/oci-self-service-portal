#!/bin/bash
set -euo pipefail

# Advanced Test Scenarios for OCI AI Chat
# Tests streaming, tool use, context management, and multi-turn conversations

BASE_URL="${1:-http://localhost:5173}"
MODEL="${2:-meta.llama-3.3-70b-instruct}"

# Validate MODEL to prevent injection via curl JSON body
if [[ ! "$MODEL" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "ERROR: Invalid model name '$MODEL'. Only alphanumeric, dots, hyphens, and underscores allowed." >&2
    exit 1
fi

# Portable millisecond timer (macOS date doesn't support %N)
get_time_ms() {
    if date +%s%N | grep -q 'N$'; then
        python3 -c "import time; print(int(time.time()*1000))"
    else
        echo $(( $(date +%s%N) / 1000000 ))
    fi
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}OCI AI Chat - Advanced Test Scenarios${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Base URL: $BASE_URL"
echo -e "Model: $MODEL"
echo ""

# Helper function to make chat requests
chat_request() {
    local messages="$1"
    local description="$2"
    
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Test: $description${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    response=$(curl -s --connect-timeout 10 --max-time 120 -X POST "$BASE_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"messages\": $messages, \"model\": \"$MODEL\"}" 2>&1)
    
    # Check for errors
    if echo "$response" | grep -q '"type":"error"'; then
        echo -e "${RED}ERROR:${NC}"
        echo "$response" | grep -o '"errorText":"[^"]*"' | sed 's/"errorText":"//;s/"$//'
        return 1
    fi
    
    # Extract tool calls
    tool_calls=$(echo "$response" | grep -o '"toolName":"[^"]*"' | sed 's/"toolName":"//;s/"$//' | sort -u)
    if [ -n "$tool_calls" ]; then
        echo -e "${GREEN}Tools Called:${NC}"
        echo "$tool_calls" | while read tool; do
            echo "  • $tool"
        done
    fi
    
    # Extract final text response
    text_content=$(echo "$response" | grep '"type":"text-delta"' | grep -o '"delta":"[^"]*"' | sed 's/"delta":"//;s/"$//' | tr -d '\n')
    if [ -n "$text_content" ]; then
        echo -e "${GREEN}Response:${NC}"
        echo "$text_content" | fold -w 80 -s | head -10
        if [ $(echo "$text_content" | wc -c) -gt 800 ]; then
            echo "... (truncated)"
        fi
    fi
    
    # Check finish reason
    finish_reason=$(echo "$response" | grep -o '"finishReason":"[^"]*"' | tail -1 | sed 's/"finishReason":"//;s/"$//')
    echo -e "${BLUE}Finish Reason:${NC} $finish_reason"
    echo ""
    
    return 0
}

# ============================================
# SCENARIO 1: Single Tool Call
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 1: Single Tool Call            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "List all my compute instances", "parts": [{"type": "text", "text": "List all my compute instances"}]}
]' "Basic tool invocation - listInstances"

# ============================================
# SCENARIO 2: Tool with Parameters
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 2: Tool with Parameters        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "Show me only RUNNING compute instances, limit to 5 results", "parts": [{"type": "text", "text": "Show me only RUNNING compute instances, limit to 5 results"}]}
]' "Tool with filters - lifecycleState and limit parameters"

# ============================================
# SCENARIO 3: Multiple Tools in Single Turn
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 3: Multiple Tools (Parallel)   ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "Give me an overview of my infrastructure: list compartments, VCNs, and autonomous databases", "parts": [{"type": "text", "text": "Give me an overview of my infrastructure: list compartments, VCNs, and autonomous databases"}]}
]' "Multiple tool calls - infrastructure overview"

# ============================================
# SCENARIO 4: Multi-Turn with Context
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 4: Multi-Turn Context          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

# First turn - get compartments
echo -e "${YELLOW}Turn 1: Getting compartments...${NC}"
chat_request '[
    {"id": "1", "role": "user", "content": "What compartments do I have?", "parts": [{"type": "text", "text": "What compartments do I have?"}]}
]' "Multi-turn setup - list compartments"

# Second turn - reference previous context
echo -e "${YELLOW}Turn 2: Referencing previous context...${NC}"
chat_request '[
    {"id": "1", "role": "user", "content": "What compartments do I have?", "parts": [{"type": "text", "text": "What compartments do I have?"}]},
    {"id": "2", "role": "assistant", "content": "You have 2 compartments: running-days and runningdays.", "parts": [{"type": "text", "text": "You have 2 compartments: running-days and runningdays."}]},
    {"id": "3", "role": "user", "content": "List the VCNs in the runningdays compartment", "parts": [{"type": "text", "text": "List the VCNs in the runningdays compartment"}]}
]' "Multi-turn context - using compartment from previous turn"

# ============================================
# SCENARIO 5: Tool Chain (Sequential)
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 5: Tool Chain (Sequential)     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "First list all subnets, then tell me which VCN each belongs to by looking up the VCN details", "parts": [{"type": "text", "text": "First list all subnets, then tell me which VCN each belongs to by looking up the VCN details"}]}
]' "Sequential tool chain - subnets → VCN lookup"

# ============================================
# SCENARIO 6: Error Recovery
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 6: Error Recovery              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "Get details for instance with ID ocid1.instance.oc1.fake-instance-id-12345", "parts": [{"type": "text", "text": "Get details for instance with ID ocid1.instance.oc1.fake-instance-id-12345"}]}
]' "Error handling - invalid instance ID"

# ============================================
# SCENARIO 7: Complex Analysis Request
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 7: Complex Analysis            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "Analyze my OCI setup: list all resources (instances, databases, VCNs, buckets) and provide a summary of what I have deployed, including any recommendations for cost optimization", "parts": [{"type": "text", "text": "Analyze my OCI setup: list all resources (instances, databases, VCNs, buckets) and provide a summary of what I have deployed, including any recommendations for cost optimization"}]}
]' "Complex analysis - full infrastructure audit"

# ============================================
# SCENARIO 8: Long Context Window
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 8: Long Context Window         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

chat_request '[
    {"id": "1", "role": "user", "content": "List my compartments", "parts": [{"type": "text", "text": "List my compartments"}]},
    {"id": "2", "role": "assistant", "content": "You have 2 compartments:\n1. running-days (HIPAA/GDPR compliant)\n2. runningdays (application resources)", "parts": [{"type": "text", "text": "You have 2 compartments:\n1. running-days (HIPAA/GDPR compliant)\n2. runningdays (application resources)"}]},
    {"id": "3", "role": "user", "content": "List VCNs", "parts": [{"type": "text", "text": "List VCNs"}]},
    {"id": "4", "role": "assistant", "content": "I found 3 VCNs in your compartment.", "parts": [{"type": "text", "text": "I found 3 VCNs in your compartment."}]},
    {"id": "5", "role": "user", "content": "List instances", "parts": [{"type": "text", "text": "List instances"}]},
    {"id": "6", "role": "assistant", "content": "You have 2 compute instances: app01 (RUNNING) and db01 (STOPPED).", "parts": [{"type": "text", "text": "You have 2 compute instances: app01 (RUNNING) and db01 (STOPPED)."}]},
    {"id": "7", "role": "user", "content": "Based on everything we discussed, give me a summary of my entire OCI infrastructure", "parts": [{"type": "text", "text": "Based on everything we discussed, give me a summary of my entire OCI infrastructure"}]}
]' "Long context - summarize previous conversation without new tool calls"

# ============================================
# SCENARIO 9: Streaming Validation
# ============================================
echo -e "\n${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SCENARIO 9: Streaming Performance       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Measuring time-to-first-token and streaming performance...${NC}"
start_time=$(get_time_ms)

# Capture streaming response with timing
response=$(curl -s --connect-timeout 10 --max-time 120 -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"messages\": [{\"id\": \"1\", \"role\": \"user\", \"content\": \"List my alarms\", \"parts\": [{\"type\": \"text\", \"text\": \"List my alarms\"}]}], \"model\": \"$MODEL\"}" 2>&1)

end_time=$(get_time_ms)
total_time=$(( end_time - start_time ))

# Count chunks
chunk_count=$(echo "$response" | grep -c "^data:")
tool_calls=$(echo "$response" | grep -c '"type":"tool-input-available"')
text_chunks=$(echo "$response" | grep -c '"type":"text-delta"')

echo -e "${GREEN}Streaming Stats:${NC}"
echo "  • Total time: ${total_time}ms"
echo "  • Total SSE chunks: $chunk_count"
echo "  • Tool calls: $tool_calls"
echo "  • Text chunks: $text_chunks"
echo ""

# ============================================
# SUMMARY
# ============================================
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Test Scenarios Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Run individual scenarios with:"
echo "  curl -X POST $BASE_URL/api/chat -H 'Content-Type: application/json' -d '{...}'"
