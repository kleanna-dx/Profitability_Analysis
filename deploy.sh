#!/bin/bash
# ============================================================
# NLQ 수익성분석 서비스 배포 스크립트
# 위치: /data/analytics/deploy.sh
# 사용: bash /data/analytics/deploy.sh [옵션]
#
# 옵션:
#   (없음)     전체 배포 (소스 pull + 파일 복사 + npm install + Spring Boot 빌드 + 서비스 재시작)
#   --quick    빠른 배포 (소스 pull + 파일 복사 + 서비스 재시작, npm install/빌드 생략)
#   --restart  서비스만 재시작 (소스 업데이트 없이)
#   --status   서비스 상태 확인만
#   --logs     최근 로그 확인 (nlq-server + spring-boot)
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

# ── Spring Boot 경로 설정 ──
SPRING_MODULE_DIR="${SOURCE_DIR}/module-profit"
SPRING_LIBS_DIR="${SPRING_MODULE_DIR}/libs"
SPRING_JAR_NAME="module-profit.jar"
SPRING_PID_FILE="${BASE_DIR}/spring-boot.pid"
SPRING_LOG_FILE="${LOG_DIR}/spring-boot.log"
JAVA_LIBRARY_PATH="${SPRING_LIBS_DIR}"

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

# Spring Boot PID 확인
get_spring_pid() {
    if [ -f "${SPRING_PID_FILE}" ]; then
        local pid=$(cat "${SPRING_PID_FILE}")
        if kill -0 "${pid}" 2>/dev/null; then
            echo "${pid}"
            return 0
        fi
    fi
    # PID 파일이 없거나 프로세스가 없으면 java 프로세스에서 찾기
    local pid=$(pgrep -f "${SPRING_JAR_NAME}" 2>/dev/null | head -1)
    if [ -n "${pid}" ]; then
        echo "${pid}"
        return 0
    fi
    return 1
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

    # Spring Boot
    local spring_pid
    if spring_pid=$(get_spring_pid); then
        log_ok "spring-boot (module-profit): running (PID: ${spring_pid})"
    else
        log_error "spring-boot (module-profit): stopped"
    fi

    echo ""
    log_info "── 포트 확인 ──"
    ss -tlnp | grep -E "3000|8080|18083" || log_warn "리스닝 포트 없음"

    echo ""
    log_info "── 헬스체크 ──"
    if curl -sf http://localhost:3000/api/status > /dev/null 2>&1; then
        local status_json=$(curl -s http://localhost:3000/api/status 2>/dev/null)
        log_ok "Node.js    (3000): 정상"
        echo "  ${status_json}" | head -1
    else
        log_error "Node.js    (3000): 응답 없음"
    fi

    if curl -sf http://localhost:8080/profit-api/sap-rfc/check/202601 > /dev/null 2>&1; then
        log_ok "Spring Boot(8080): 정상"
    else
        log_warn "Spring Boot(8080): 응답 없음"
    fi

    if curl -sf http://localhost:18083/api/status > /dev/null 2>&1; then
        log_ok "Nginx      (18083): 정상"
    else
        log_warn "Nginx      (18083): 응답 없음"
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

# ── Spring Boot 빌드 ──
build_spring() {
    log_info "Spring Boot 빌드 중..."

    # SAP JCo 라이브러리 확인
    if [ ! -f "${SPRING_LIBS_DIR}/sapjco3.jar" ]; then
        log_warn "sapjco3.jar 없음: ${SPRING_LIBS_DIR}/sapjco3.jar"
        log_warn "SAP RFC 기능은 JCo 라이브러리 설치 후 사용 가능합니다."
    fi
    if [ ! -f "${SPRING_LIBS_DIR}/libsapjco3.so" ]; then
        log_warn "libsapjco3.so 없음: ${SPRING_LIBS_DIR}/libsapjco3.so"
        log_warn "SAP RFC 기능은 네이티브 라이브러리 설치 후 사용 가능합니다."
    fi

    cd "${SOURCE_DIR}"

    # Gradle 빌드
    if [ -f "./gradlew" ]; then
        chmod +x ./gradlew
        ./gradlew :module-profit:bootJar --no-daemon -q 2>&1 | tail -10
    else
        log_error "gradlew가 없습니다: ${SOURCE_DIR}/gradlew"
        exit 1
    fi

    # 빌드된 JAR 확인
    local jar_file=$(find "${SPRING_MODULE_DIR}/build/libs" -name "*.jar" ! -name "*-plain.jar" 2>/dev/null | head -1)
    if [ -n "${jar_file}" ]; then
        log_ok "Spring Boot 빌드 완료: $(basename ${jar_file})"
    else
        log_error "빌드된 JAR 파일을 찾을 수 없습니다."
        exit 1
    fi
    echo ""
}

# ── Spring Boot 시작 ──
start_spring() {
    log_info "Spring Boot 시작 중..."

    # 이미 실행 중인지 확인
    local existing_pid
    if existing_pid=$(get_spring_pid); then
        log_warn "Spring Boot가 이미 실행 중입니다 (PID: ${existing_pid})"
        return 0
    fi

    # 로그 디렉토리 생성
    mkdir -p "${LOG_DIR}"

    # 빌드된 JAR 찾기
    local jar_file=$(find "${SPRING_MODULE_DIR}/build/libs" -name "*.jar" ! -name "*-plain.jar" 2>/dev/null | head -1)
    if [ -z "${jar_file}" ]; then
        log_error "JAR 파일이 없습니다. 먼저 빌드를 실행하세요."
        log_info "빌드 명령: bash deploy.sh (전체 배포)"
        return 1
    fi

    # Spring Boot 실행 (백그라운드)
    nohup java \
        -Djava.library.path="${JAVA_LIBRARY_PATH}" \
        -Dspring.profiles.active=sap \
        -Xmx512m \
        -jar "${jar_file}" \
        >> "${SPRING_LOG_FILE}" 2>&1 &

    local pid=$!
    echo "${pid}" > "${SPRING_PID_FILE}"

    # 시작 대기 (최대 30초)
    log_info "Spring Boot 시작 대기 중... (PID: ${pid})"
    local waited=0
    while [ $waited -lt 30 ]; do
        if curl -sf http://localhost:8080/profit-api/sap-rfc/check/202601 > /dev/null 2>&1; then
            log_ok "Spring Boot 시작 완료 (${waited}초, PID: ${pid})"
            return 0
        fi
        # 프로세스가 죽었는지 확인
        if ! kill -0 "${pid}" 2>/dev/null; then
            log_error "Spring Boot 시작 실패! (프로세스 종료됨)"
            log_info "로그 확인: tail -50 ${SPRING_LOG_FILE}"
            tail -20 "${SPRING_LOG_FILE}" 2>/dev/null
            return 1
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done

    echo ""
    log_warn "Spring Boot 시작 지연 (30초 초과, PID: ${pid})"
    log_info "백그라운드에서 계속 시작 중일 수 있습니다."
    log_info "로그 확인: tail -f ${SPRING_LOG_FILE}"
    echo ""
}

# ── Spring Boot 중지 ──
stop_spring() {
    log_info "Spring Boot 중지 중..."

    local pid
    if pid=$(get_spring_pid); then
        kill "${pid}" 2>/dev/null
        # 종료 대기 (최대 15초)
        local waited=0
        while [ $waited -lt 15 ]; do
            if ! kill -0 "${pid}" 2>/dev/null; then
                rm -f "${SPRING_PID_FILE}"
                log_ok "Spring Boot 중지 완료 (PID: ${pid})"
                return 0
            fi
            sleep 1
            waited=$((waited + 1))
        done
        # 강제 종료
        kill -9 "${pid}" 2>/dev/null
        rm -f "${SPRING_PID_FILE}"
        log_warn "Spring Boot 강제 종료됨 (PID: ${pid})"
    else
        log_warn "Spring Boot가 실행 중이 아닙니다."
    fi
}

# ── Spring Boot 재시작 ──
restart_spring() {
    stop_spring
    sleep 2
    start_spring
}

# 서비스 재시작 (전체)
restart_services() {
    log_info "서비스 재시작 중..."

    # Spring Boot 재시작
    restart_spring

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

# 서비스 중지 (전체)
stop_services() {
    log_info "서비스 중지 중..."
    sudo systemctl stop analytics 2>/dev/null && log_ok "analytics (nginx) 중지" || log_warn "analytics 이미 중지됨"
    sudo systemctl stop nlq-server 2>/dev/null && log_ok "nlq-server 중지" || log_warn "nlq-server 이미 중지됨"
    stop_spring
    echo ""
}

# 서비스 시작 (전체)
start_services() {
    log_info "서비스 시작 중..."

    # Spring Boot 먼저 시작 (nlq-server가 Spring Boot에 요청하므로)
    start_spring

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

    # Node.js 헬스체크
    while [ $waited -lt $max_wait ]; do
        if curl -sf http://localhost:3000/api/status > /dev/null 2>&1; then
            log_ok "Node.js (3000) 정상 응답 확인 (${waited}초)"
            break
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done

    if [ $waited -ge $max_wait ]; then
        echo ""
        log_error "Node.js: ${max_wait}초 내에 응답 없음"
        sudo journalctl -u nlq-server -n 30 --no-pager
    fi

    # Spring Boot 헬스체크
    if curl -sf http://localhost:8080/profit-api/sap-rfc/check/202601 > /dev/null 2>&1; then
        log_ok "Spring Boot (8080) 정상 응답 확인"
    else
        log_warn "Spring Boot (8080) 응답 없음 (시작 지연 가능)"
        log_info "로그 확인: tail -f ${SPRING_LOG_FILE}"
    fi

    echo ""
}

# ── 전체 배포 ──
deploy_full() {
    print_header
    log_info "전체 배포 시작"
    echo ""

    update_source
    copy_files
    install_deps
    build_spring
    restart_services
    wait_healthy
    check_status

    log_ok "배포 완료!"
    echo ""
}

# ── 빠른 배포 (npm install + Spring Boot 빌드 생략) ──
deploy_quick() {
    print_header
    log_info "빠른 배포 시작 (npm install + Spring Boot 빌드 생략)"
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
        echo ""
        log_info "── Spring Boot 최근 로그 (100줄) ──"
        if [ -f "${SPRING_LOG_FILE}" ]; then
            tail -100 "${SPRING_LOG_FILE}"
        else
            log_warn "Spring Boot 로그 파일 없음: ${SPRING_LOG_FILE}"
        fi
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
        echo "  (없음)     전체 배포 (pull + 복사 + npm install + Spring Boot 빌드 + 재시작)"
        echo "  --quick    빠른 배포 (pull + 복사 + 재시작, npm install/빌드 생략)"
        echo "  --restart  서비스만 재시작"
        echo "  --status   서비스 상태 확인"
        echo "  --logs     최근 로그 확인"
        echo "  --stop     모든 서비스 중지"
        echo "  --start    모든 서비스 시작"
        echo "  --help     도움말"
        echo ""
        echo "서비스 목록:"
        echo "  1. nlq-server    (Node.js, 포트 3000)  - 웹 UI + API"
        echo "  2. spring-boot   (Java,    포트 8080)  - SAP RFC 동기화"
        echo "  3. analytics     (Nginx,   포트 18083) - 리버스 프록시"
        echo ""
        echo "Spring Boot 관련 경로:"
        echo "  JAR:     ${SPRING_MODULE_DIR}/build/libs/"
        echo "  JCo:     ${SPRING_LIBS_DIR}/sapjco3.jar + libsapjco3.so"
        echo "  로그:    ${SPRING_LOG_FILE}"
        echo "  PID:     ${SPRING_PID_FILE}"
        echo ""
        echo "예시:"
        echo "  bash /data/analytics/deploy.sh              # 전체 배포"
        echo "  bash /data/analytics/deploy.sh --quick      # package.json/Java 변경 없을 때"
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
