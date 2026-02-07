#!/usr/bin/env bash
# =============================================================================
# OCI Self-Service Portal - Multi-Service Deployment Script
# =============================================================================
# Deploys the Fastify API + SvelteKit frontend to production.
#
# Usage:
#   ./deploy.sh [OPTIONS]
#
# Options:
#   --env-file PATH    Path to .env file (default: .env)
#   --build            Force rebuild images before starting
#   --dev              Start in development mode with hot-reload
#   --logs             Follow logs after starting
#   --health           Check health after starting
#   --help             Show this help message
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - OCI CLI configured at ~/.oci/config
#   - Oracle wallet files at /data/wallets (or WALLET_PATH in .env)
#   - .env file with required credentials
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ENV_FILE="${SCRIPT_DIR}/.env"
BUILD_FLAG=""
DEV_MODE=false
FOLLOW_LOGS=false
CHECK_HEALTH=false

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

show_help() {
    sed -n '/^# Usage:/,/^# ====/p' "$0" | sed 's/^# //g' | sed 's/^#$//g'
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Install from https://docs.docker.com/get-docker/"
        exit 1
    fi

    # Docker Compose
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available. Upgrade to Docker Desktop or install Compose plugin."
        exit 1
    fi

    # .env file
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error ".env file not found at $ENV_FILE"
        log_info "Copy .env.example and fill in values:"
        log_info "  cp ${SCRIPT_DIR}/.env.example ${ENV_FILE}"
        exit 1
    fi

    # OCI CLI config (optional, warn if missing)
    if [[ ! -f "$HOME/.oci/config" ]]; then
        log_warn "OCI CLI config not found at ~/.oci/config"
        log_warn "Some features may not work without OCI credentials"
    fi

    log_success "Prerequisites check passed"
}

check_health_endpoints() {
    log_info "Checking health endpoints..."

    local max_attempts=30
    local attempt=1

    # Wait for nginx HTTP health endpoint
    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf http://localhost:80/nginx-health > /dev/null 2>&1; then
            log_success "Nginx is healthy at http://localhost:80/nginx-health"
            break
        fi
        log_info "Waiting for nginx... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done

    if [[ $attempt -gt $max_attempts ]]; then
        log_error "Nginx failed to become healthy after $max_attempts attempts"
        docker compose -f "${SCRIPT_DIR}/docker-compose.yml" logs nginx
        exit 1
    fi

    # Wait for proxied API health over HTTPS
    attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        if curl -skf https://localhost/health > /dev/null 2>&1; then
            log_success "API is healthy via nginx at https://localhost/health"
            break
        fi
        log_info "Waiting for API via nginx... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done

    if [[ $attempt -gt $max_attempts ]]; then
        log_error "API failed to become healthy via nginx after $max_attempts attempts"
        docker compose -f "${SCRIPT_DIR}/docker-compose.yml" logs api
        exit 1
    fi

    # Wait for frontend health endpoint over HTTPS
    attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        if curl -skf https://localhost/api/health > /dev/null 2>&1; then
            log_success "Frontend health endpoint is reachable at https://localhost/api/health"
            break
        fi
        log_info "Waiting for frontend health via nginx... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done

    if [[ $attempt -gt $max_attempts ]]; then
        log_error "Frontend health endpoint failed after $max_attempts attempts"
        docker compose -f "${SCRIPT_DIR}/docker-compose.yml" logs frontend
        exit 1
    fi

    log_success "All services are healthy!"
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        --build)
            BUILD_FLAG="--build"
            shift
            ;;
        --dev)
            DEV_MODE=true
            shift
            ;;
        --logs)
            FOLLOW_LOGS=true
            shift
            ;;
        --health)
            CHECK_HEALTH=true
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Main deployment
# ---------------------------------------------------------------------------
main() {
    log_info "Starting OCI Self-Service Portal deployment..."
    log_info "Project root: $PROJECT_ROOT"
    log_info "Environment file: $ENV_FILE"

    check_prerequisites

    # Change to script directory for Docker Compose
    cd "$SCRIPT_DIR"

    # Build compose file arguments
    local compose_files="-f docker-compose.yml"
    if [[ "$DEV_MODE" == true ]]; then
        compose_files+=" -f docker-compose.dev.yml"
        log_info "Starting in DEVELOPMENT mode with hot-reload"
    else
        log_info "Starting in PRODUCTION mode"
    fi

    # Stop existing containers
    log_info "Stopping existing containers..."
    docker compose $compose_files down

    # Start services
    log_info "Starting services..."
    docker compose $compose_files up -d $BUILD_FLAG

    log_success "Services started successfully!"

    # Show status
    docker compose $compose_files ps

    # Check health if requested
    if [[ "$CHECK_HEALTH" == true ]]; then
        check_health_endpoints
    fi

    # Follow logs if requested
    if [[ "$FOLLOW_LOGS" == true ]]; then
        log_info "Following logs (Ctrl+C to exit)..."
        docker compose $compose_files logs -f
    else
        log_info "To view logs, run:"
        log_info "  docker compose -f ${SCRIPT_DIR}/docker-compose.yml logs -f"
    fi

    log_success "Deployment complete!"
    log_info "HTTPS Endpoint: https://localhost"
    log_info "API via Proxy: https://localhost/api"
}

main
