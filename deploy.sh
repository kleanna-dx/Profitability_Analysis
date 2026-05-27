#!/bin/bash
# ============================================================
# NLQ 수익성분석 서비스 배포 스크립트
# 위치: /data/analytics/deploy.sh
# 사용: bash /data/analytics/deploy.sh [옵션]
#
# 옵션:
#   (없음)     전체 배포 (소스 pull + 파일 복사 + npm install + 서비스 재시작)
#   --quick    빠른 배포 (소스 pull + 파일 복사 + 서비스 재시작, npm install 생략)
#   --restart  서비스만 재시작 (소스 업데이트 없이)
#   --status   서비스 상태 확인만
#   --logs     최근 로그 확인 (nlq-server 100줄)
#   --stop     모든 서비스 중지
#   --start    모든 서비스 시작
# ============================================================

set -e

# ── 경로 설정 ──
BASE_DIR="/data/analytics"
SOURCE_DIR="${BASE_DIR}/source"
APP_DIR="${BASE_DIR}/app"
CONFIG_DIR="${BASE_DIR}/config"
LOG_DIR="${BASE_DIR}/logs"

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── 함수 ──
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

print_header() {
    echo ""
    echo "============================================"
    echo "  NLQ 수익성분석 서비스 배포"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "============================================"
    echo ""
}

# 서비스 상태 확인
check_status() {
    echo ""
    log_info "── 서비스 상태 ──"
    echo ""

    # nlq-server
    if systemctl is-active --quiet nlq-server 2>/dev/null; then
        log_ok "nlq-server: $(systemctl is-active nlq-server)"
    else
        log_error "nlq-server: $(systemctl is-active nlq-server 2>/dev/null || echo 'not found')"
    fi

    # analytics (nginx)
    if systemctl is-active --quiet analytics 2>/dev/null; then
        log_ok "analytics (nginx): $(systemctl is-active analytics)"
    else
        log_error "analytics (nginx): $(systemctl is-active analytics 2>/dev/null || echo 'not found')"
    fi

    echo ""
    log_info "── 포트 확인 ──"
    ss -tlnp | grep -E "3000|18083" || log_warn "리스닝 포트 없음"

    echo ""
    log_info "── 헬스체크 ──"
    if curl -sf http://localhost:3000/api/status > /dev/null 2>&1; then
        local status_json=$(curl -s http://localhost:3000/api/status 2>/dev/null)
        log_ok "Node.js (3000): 정상"
        echo "  ${status_json}" | head -1
    else
        log_error "Node.js (3000): 응답 없음"
    fi

    if curl -sf http://localhost:18083/api/status > /dev/null 2>&1; then
        log_ok "Nginx  (18083): 정상"
    else
        log_warn "Nginx  (18083): 응답 없음"
    fi
    echo ""
}

# 소스 업데이트 (git pull)
update_source() {
    log_info "GitHub 소스 업데이트 중..."

    if [ ! -d "${SOURCE_DIR}/.git" ]; then
        log_error "Git 저장소가 아닙니다: ${SOURCE_DIR}"
        exit 1
    fi

    cd "${SOURCE_DIR}"

    # 현재 브랜치 확인
    local branch=$(git rev-parse --abbrev-ref HEAD)
    log_info "현재 브랜치: ${branch}"

    # 변경사항 확인 (로컬 수정 있으면 경고)
    if [ -n "$(git status --porcelain)" ]; then
        log_warn "로컬 변경사항이 있습니다. stash 처리합니다."
        git stash
    fi

    # pull
    local before=$(git rev-parse --short HEAD)
    git pull origin "${branch}"
    local after=$(git rev-parse --short HEAD)

    if [ "${before}" = "${after}" ]; then
        log_info "변경사항 없음 (${after})"
    else
        log_ok "업데이트 완료: ${before} → ${after}"
        git log --oneline "${before}..${after}" | head -10
    fi
    echo ""
}

# 앱 디렉토리에 파일 복사
copy_files() {
    log_info "소스 파일 복사 중..."

    # nlq-server 디렉토리 내용 복사
    cp -r "${SOURCE_DIR}/nlq-server/"* "${APP_DIR}/"

    # 상위 의존성 파일 복사
    cp "${SOURCE_DIR}/package.json" "${APP_DIR}/"
    cp "${SOURCE_DIR}/package-lock.json" "${APP_DIR}/"

    # uploads 디렉토리 확인
    mkdir -p "${APP_DIR}/uploads"

    # .env 심볼릭 링크 확인
    if [ ! -L "${APP_DIR}/.env" ]; then
        if [ -f "${CONFIG_DIR}/.env" ]; then
            ln -sf "${CONFIG_DIR}/.env" "${APP_DIR}/.env"
            log_info ".env 심볼릭 링크 생성"
        else
            log_warn ".env 파일이 없습니다: ${CONFIG_DIR}/.env"
        fi
    fi

    log_ok "파일 복사 완료"
    echo ""
}

# npm install
install_deps() {
    log_info "npm 패키지 설치 중... (production only)"
    cd "${APP_DIR}"
    npm install --omit=dev 2>&1 | tail -5
    log_ok "npm install 완료"
    echo ""
}

# 서비스 재시작
restart_services() {
    log_info "서비스 재시작 중..."

    # nlq-server 재시작
    sudo systemctl restart nlq-server
    sleep 2

    if systemctl is-active --quiet nlq-server; then
        log_ok "nlq-server 재시작 완료"
    else
        log_error "nlq-server 시작 실패!"
        sudo journalctl -u nlq-server -n 20 --no-pager
        exit 1
    fi

    # nginx 설정 검증 후 재시작
    if sudo nginx -t -c "${CONFIG_DIR}/application.yml" 2>/dev/null; then
        sudo systemctl restart analytics
        if systemctl is-active --quiet analytics; then
            log_ok "analytics (nginx) 재시작 완료"
        else
            log_error "analytics (nginx) 시작 실패!"
            sudo journalctl -u analytics -n 20 --no-pager
            exit 1
        fi
    else
        log_error "nginx 설정 검증 실패!"
        sudo nginx -t -c "${CONFIG_DIR}/application.yml"
        exit 1
    fi

    echo ""
}

# 서비스 중지
stop_services() {
    log_info "서비스 중지 중..."
    sudo systemctl stop analytics 2>/dev/null && log_ok "analytics (nginx) 중지" || log_warn "analytics 이미 중지됨"
    sudo systemctl stop nlq-server 2>/dev/null && log_ok "nlq-server 중지" || log_warn "nlq-server 이미 중지됨"
    echo ""
}

# 서비스 시작
start_services() {
    log_info "서비스 시작 중..."

    sudo systemctl start nlq-server
    sleep 2
    if systemctl is-active --quiet nlq-server; then
        log_ok "nlq-server 시작 완료"
    else
        log_error "nlq-server 시작 실패!"
        sudo journalctl -u nlq-server -n 20 --no-pager
        exit 1
    fi

    sudo systemctl start analytics
    if systemctl is-active --quiet analytics; then
        log_ok "analytics (nginx) 시작 완료"
    else
        log_error "analytics (nginx) 시작 실패!"
        sudo journalctl -u analytics -n 20 --no-pager
        exit 1
    fi
    echo ""
}

# 헬스체크 (서비스 안정화 대기)
wait_healthy() {
    log_info "헬스체크 대기 중..."
    local max_wait=30
    local waited=0

    while [ $waited -lt $max_wait ]; do
        if curl -sf http://localhost:3000/api/status > /dev/null 2>&1; then
            log_ok "서비스 정상 응답 확인 (${waited}초)"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done

    echo ""
    log_error "${max_wait}초 내에 응답 없음"
    sudo journalctl -u nlq-server -n 30 --no-pager
    return 1
}

# ── 전체 배포 ──
deploy_full() {
    print_header
    log_info "전체 배포 시작"
    echo ""

    update_source
    copy_files
    install_deps
    restart_services
    wait_healthy
    check_status

    log_ok "배포 완료!"
    echo ""
}

# ── 빠른 배포 (npm install 생략) ──
deploy_quick() {
    print_header
    log_info "빠른 배포 시작 (npm install 생략)"
    echo ""

    update_source
    copy_files
    restart_services
    wait_healthy
    check_status

    log_ok "빠른 배포 완료!"
    echo ""
}

# ── 메인 ──
case "${1:-}" in
    --quick)
        deploy_quick
        ;;
    --restart)
        print_header
        restart_services
        wait_healthy
        check_status
        ;;
    --status)
        check_status
        ;;
    --logs)
        echo ""
        log_info "── nlq-server 최근 로그 (100줄) ──"
        sudo journalctl -u nlq-server -n 100 --no-pager
        echo ""
        log_info "── analytics (nginx) 최근 로그 (30줄) ──"
        sudo journalctl -u analytics -n 30 --no-pager
        ;;
    --stop)
        print_header
        stop_services
        check_status
        ;;
    --start)
        print_header
        start_services
        wait_healthy
        check_status
        ;;
    --help|-h)
        echo ""
        echo "사용법: bash deploy.sh [옵션]"
        echo ""
        echo "옵션:"
        echo "  (없음)     전체 배포 (pull + 복사 + npm install + 재시작)"
        echo "  --quick    빠른 배포 (pull + 복사 + 재시작, npm install 생략)"
        echo "  --restart  서비스만 재시작"
        echo "  --status   서비스 상태 확인"
        echo "  --logs     최근 로그 확인"
        echo "  --stop     모든 서비스 중지"
        echo "  --start    모든 서비스 시작"
        echo "  --help     도움말"
        echo ""
        echo "예시:"
        echo "  bash /data/analytics/deploy.sh              # 전체 배포"
        echo "  bash /data/analytics/deploy.sh --quick      # package.json 변경 없을 때"
        echo "  bash /data/analytics/deploy.sh --status     # 상태만 확인"
        echo ""
        ;;
    "")
        deploy_full
        ;;
    *)
        log_error "알 수 없는 옵션: $1"
        echo "bash deploy.sh --help 로 사용법을 확인하세요."
        exit 1
        ;;
esac
