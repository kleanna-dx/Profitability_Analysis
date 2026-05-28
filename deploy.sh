#!/bin/bash
# ============================================================
# NLQ 수익성분석 서비스 배포 스크립트
# 위치: /data/analytics/deploy.sh
# 사용: bash /data/analytics/deploy.sh [옵션]
#
# 서비스 구성:
#   1. nlq-server     - Node.js Express (port 3000)
#   2. module-profit   - Spring Boot JAR (port 18093)
#   3. analytics       - Nginx reverse proxy (port 18083 → 3000 + 18093)
#
# 포트 구조:
#   Nginx(18083) ─→ Node.js(3000)    : /api/*, /pages/*, etc.
#                ─→ SpringBoot(18093) : /profit-api/*
#
# 옵션:
#   (없음)        전체 배포 (pull + 빌드 + 복사 + npm install + 재시작)
#   --quick       빠른 배포 (pull + 복사 + 재시작, npm install/gradle 생략)
#   --restart     모든 서비스 재시작 (소스 업데이트 없이)
#   --status      서비스 상태 확인만
#   --logs        최근 로그 확인
#   --stop        모든 서비스 중지
#   --start       모든 서비스 시작
#   --build-java  module-profit JAR만 빌드 (서비스 재시작 안 함)
#   --java-only   module-profit만 빌드 + 재시작
# ============================================================

set -e

# ── 경로 설정 ──
BASE_DIR="/data/analytics"
SOURCE_DIR="${BASE_DIR}/source"
APP_DIR="${BASE_DIR}/app"
CONFIG_DIR="${BASE_DIR}/config"
LOG_DIR="${BASE_DIR}/logs"

# module-profit 경로
PROFIT_SOURCE_DIR="${SOURCE_DIR}/module-profit"
PROFIT_JAR_NAME="module-profit.jar"
PROFIT_JAR_PATH="${APP_DIR}/${PROFIT_JAR_NAME}"
PROFIT_LIBS_DIR="${PROFIT_SOURCE_DIR}/libs"
PROFIT_LOG="${LOG_DIR}/module-profit.log"

# 포트 설정
SPRING_BOOT_PORT=18093
NGINX_PORT=18083
NODEJS_PORT=3000

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

# ── module-profit systemd 서비스 설치/업데이트 ──
ensure_profit_service() {
    local service_file="/etc/systemd/system/module-profit.service"
    local service_version="v2-port18093"

    # 서비스 파일이 있고 버전 태그도 있으면 스킵
    if [ -f "${service_file}" ] && grep -q "${service_version}" "${service_file}" 2>/dev/null; then
        return 0
    fi

    log_info "module-profit systemd 서비스 파일 생성 중..."

    sudo tee "${service_file}" > /dev/null << UNIT
# ${service_version}
[Unit]
Description=Module-Profit Spring Boot Application (port ${SPRING_BOOT_PORT})
Documentation=https://github.com/kleanna-dx/Profitability_Analysis
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/data/analytics/app
ExecStart=/usr/bin/java \\
    -Djava.library.path=/data/analytics/source/module-profit/libs \\
    -Xms512m -Xmx2g \\
    -XX:+UseG1GC \\
    -XX:MaxGCPauseMillis=200 \\
    -jar /data/analytics/app/module-profit.jar \\
    --spring.config.location=file:/data/analytics/source/module-profit/src/main/resources/application.yml
ExecStop=/bin/kill -TERM \$MAINPID
Restart=on-failure
RestartSec=10
SuccessExitStatus=143
StandardOutput=journal
StandardError=journal
SyslogIdentifier=module-profit

# 환경 변수
Environment=JAVA_HOME=/usr/lib/jvm/java-17
Environment=LANG=ko_KR.UTF-8

[Install]
WantedBy=multi-user.target
UNIT

    sudo systemctl daemon-reload
    sudo systemctl enable module-profit
    log_ok "module-profit 서비스 등록 완료 (port ${SPRING_BOOT_PORT})"
}

# ── 서비스 상태 확인 ──
check_status() {
    echo ""
    log_info "── 서비스 상태 ──"
    echo ""

    # nlq-server
    if systemctl is-active --quiet nlq-server 2>/dev/null; then
        log_ok "nlq-server:     $(systemctl is-active nlq-server)"
    else
        log_error "nlq-server:     $(systemctl is-active nlq-server 2>/dev/null || echo 'not found')"
    fi

    # module-profit (Spring Boot)
    if systemctl is-active --quiet module-profit 2>/dev/null; then
        log_ok "module-profit:  $(systemctl is-active module-profit)"
    else
        log_warn "module-profit:  $(systemctl is-active module-profit 2>/dev/null || echo 'not found')"
    fi

    # analytics (nginx)
    if systemctl is-active --quiet analytics 2>/dev/null; then
        log_ok "analytics:      $(systemctl is-active analytics)"
    else
        log_error "analytics:      $(systemctl is-active analytics 2>/dev/null || echo 'not found')"
    fi

    echo ""
    log_info "── 포트 확인 ──"
    ss -tlnp | grep -E "${NODEJS_PORT}|${SPRING_BOOT_PORT}|${NGINX_PORT}" || log_warn "리스닝 포트 없음"

    echo ""
    log_info "── 헬스체크 ──"

    # Node.js (3000)
    if curl -sf http://localhost:${NODEJS_PORT}/api/status > /dev/null 2>&1; then
        local status_json=$(curl -s http://localhost:${NODEJS_PORT}/api/status 2>/dev/null)
        log_ok "Node.js    (${NODEJS_PORT}):  정상"
        echo "  ${status_json}" | head -1
    else
        log_error "Node.js    (${NODEJS_PORT}):  응답 없음"
    fi

    # Spring Boot (18093) - profit-api 엔드포인트로 확인
    if curl -sf http://localhost:${SPRING_BOOT_PORT}/profit-api/metrics > /dev/null 2>&1; then
        log_ok "SpringBoot (${SPRING_BOOT_PORT}): 정상"
    elif curl -sf http://localhost:${SPRING_BOOT_PORT}/profit-api/sap-rfc/check/202501 > /dev/null 2>&1; then
        log_ok "SpringBoot (${SPRING_BOOT_PORT}): 정상 (SAP RFC 응답)"
    else
        log_warn "SpringBoot (${SPRING_BOOT_PORT}): 응답 없음"
    fi

    # Nginx proxy 확인
    if curl -sf http://localhost:${NGINX_PORT}/api/status > /dev/null 2>&1; then
        log_ok "Nginx      (${NGINX_PORT}): 프록시 정상"
    else
        log_warn "Nginx      (${NGINX_PORT}): 프록시 응답 없음"
    fi

    # JAR 파일 확인
    echo ""
    log_info "── JAR 파일 ──"
    if [ -f "${PROFIT_JAR_PATH}" ]; then
        local jar_size=$(du -h "${PROFIT_JAR_PATH}" | cut -f1)
        local jar_date=$(stat -c '%y' "${PROFIT_JAR_PATH}" 2>/dev/null | cut -d'.' -f1)
        log_ok "${PROFIT_JAR_NAME}: ${jar_size} (${jar_date})"
    else
        log_warn "${PROFIT_JAR_NAME}: 파일 없음"
    fi

    # SAP JCo 라이브러리 확인
    if [ -f "${PROFIT_LIBS_DIR}/sapjco3.jar" ] && [ -f "${PROFIT_LIBS_DIR}/libsapjco3.so" ]; then
        log_ok "SAP JCo: sapjco3.jar + libsapjco3.so"
    else
        log_warn "SAP JCo: 라이브러리 누락 (${PROFIT_LIBS_DIR})"
    fi

    echo ""
}

# ── 소스 업데이트 (git pull) ──
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
        log_ok "업데이트 완료: ${before} -> ${after}"
        git log --oneline "${before}..${after}" | head -10
    fi
    echo ""
}

# ── module-profit JAR 빌드 ──
build_java() {
    log_info "module-profit JAR 빌드 중..."

    if [ ! -f "${PROFIT_SOURCE_DIR}/gradlew" ]; then
        log_error "Gradle Wrapper가 없습니다: ${PROFIT_SOURCE_DIR}/gradlew"
        exit 1
    fi

    # SAP JCo 라이브러리 확인
    if [ ! -f "${PROFIT_LIBS_DIR}/sapjco3.jar" ]; then
        log_warn "SAP JCo JAR 없음: ${PROFIT_LIBS_DIR}/sapjco3.jar"
        log_warn "빌드는 계속하지만 SAP RFC 기능이 동작하지 않을 수 있습니다."
    fi

    cd "${PROFIT_SOURCE_DIR}"

    # Gradle 빌드 (테스트 제외)
    ./gradlew clean bootJar -x test 2>&1 | tail -20

    # 빌드 결과 확인
    local built_jar="${PROFIT_SOURCE_DIR}/build/libs/${PROFIT_JAR_NAME}"
    if [ -f "${built_jar}" ]; then
        local jar_size=$(du -h "${built_jar}" | cut -f1)
        log_ok "JAR 빌드 완료: ${built_jar} (${jar_size})"
    else
        log_error "JAR 파일 생성 실패!"
        ls -la "${PROFIT_SOURCE_DIR}/build/libs/" 2>/dev/null || echo "build/libs 디렉토리 없음"
        exit 1
    fi
    echo ""
}

# ── 파일 복사 ──
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

    # module-profit JAR 복사
    local built_jar="${PROFIT_SOURCE_DIR}/build/libs/${PROFIT_JAR_NAME}"
    if [ -f "${built_jar}" ]; then
        cp "${built_jar}" "${PROFIT_JAR_PATH}"
        log_ok "module-profit.jar 복사 완료 -> ${PROFIT_JAR_PATH}"
    else
        log_warn "빌드된 JAR 없음. 기존 JAR 유지."
        if [ ! -f "${PROFIT_JAR_PATH}" ]; then
            log_warn "${PROFIT_JAR_NAME}가 ${APP_DIR}에 없습니다. --build-java를 먼저 실행하세요."
        fi
    fi

    log_ok "파일 복사 완료"
    echo ""
}

# ── npm install ──
install_deps() {
    log_info "npm 패키지 설치 중... (production only)"
    cd "${APP_DIR}"
    npm install --omit=dev 2>&1 | tail -5
    log_ok "npm install 완료"
    echo ""
}

# ── 서비스 재시작 (전체) ──
restart_services() {
    log_info "서비스 재시작 중..."

    # 1) module-profit (Spring Boot) 먼저 시작 — Node.js가 이 서비스에 의존
    restart_profit_service

    # 2) nlq-server 재시작
    sudo systemctl restart nlq-server
    sleep 2

    if systemctl is-active --quiet nlq-server; then
        log_ok "nlq-server 재시작 완료"
    else
        log_error "nlq-server 시작 실패!"
        sudo journalctl -u nlq-server -n 20 --no-pager
        exit 1
    fi

    # 3) nginx 설정 검증 후 재시작
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

# ── module-profit 서비스 재시작 ──
restart_profit_service() {
    # systemd 서비스 파일 확인/생성
    ensure_profit_service

    # JAR 파일 존재 확인
    if [ ! -f "${PROFIT_JAR_PATH}" ]; then
        log_warn "module-profit.jar 없음. Spring Boot 서비스 시작을 건너뜁니다."
        log_warn "먼저 실행: bash deploy.sh --build-java"
        return 0
    fi

    log_info "module-profit 재시작 중..."
    sudo systemctl restart module-profit
    sleep 8  # Spring Boot 기동에 시간이 더 필요

    if systemctl is-active --quiet module-profit; then
        log_ok "module-profit 재시작 완료 (port ${SPRING_BOOT_PORT})"
    else
        log_error "module-profit 시작 실패!"
        sudo journalctl -u module-profit -n 30 --no-pager
        # Spring Boot 실패해도 Node.js 배포는 계속 진행
        log_warn "Spring Boot 실패이지만 나머지 배포를 계속합니다."
    fi
}

# ── 서비스 중지 ──
stop_services() {
    log_info "서비스 중지 중..."
    sudo systemctl stop analytics 2>/dev/null && log_ok "analytics (nginx) 중지" || log_warn "analytics 이미 중지됨"
    sudo systemctl stop nlq-server 2>/dev/null && log_ok "nlq-server 중지" || log_warn "nlq-server 이미 중지됨"
    sudo systemctl stop module-profit 2>/dev/null && log_ok "module-profit 중지" || log_warn "module-profit 이미 중지됨"
    echo ""
}

# ── 서비스 시작 ──
start_services() {
    log_info "서비스 시작 중..."

    # 1) module-profit 먼저 시작
    if [ -f "${PROFIT_JAR_PATH}" ]; then
        ensure_profit_service
        sudo systemctl start module-profit
        sleep 8
        if systemctl is-active --quiet module-profit; then
            log_ok "module-profit 시작 완료 (port ${SPRING_BOOT_PORT})"
        else
            log_error "module-profit 시작 실패!"
            sudo journalctl -u module-profit -n 20 --no-pager
            log_warn "Spring Boot 실패이지만 나머지 서비스를 시작합니다."
        fi
    else
        log_warn "module-profit.jar 없음 - Spring Boot 건너뜀"
    fi

    # 2) nlq-server
    sudo systemctl start nlq-server
    sleep 2
    if systemctl is-active --quiet nlq-server; then
        log_ok "nlq-server 시작 완료"
    else
        log_error "nlq-server 시작 실패!"
        sudo journalctl -u nlq-server -n 20 --no-pager
        exit 1
    fi

    # 3) analytics (nginx)
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

# ── 헬스체크 (서비스 안정화 대기) ──
wait_healthy() {
    echo ""
    log_info "헬스체크 대기 중..."
    local max_wait=30
    local waited=0

    # Node.js 헬스체크
    while [ $waited -lt $max_wait ]; do
        if curl -sf http://localhost:${NODEJS_PORT}/api/status > /dev/null 2>&1; then
            log_ok "Node.js 정상 응답 확인 (${waited}초)"
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

    # Spring Boot 헬스체크 (별도 타임아웃)
    if systemctl is-active --quiet module-profit 2>/dev/null; then
        local java_wait=0
        local java_max=60  # Spring Boot는 기동이 오래 걸림
        while [ $java_wait -lt $java_max ]; do
            if curl -sf http://localhost:${SPRING_BOOT_PORT}/profit-api/metrics > /dev/null 2>&1; then
                log_ok "Spring Boot 정상 응답 확인 (${java_wait}초)"
                break
            fi
            sleep 3
            java_wait=$((java_wait + 3))
            echo -n "."
        done
        if [ $java_wait -ge $java_max ]; then
            echo ""
            log_warn "Spring Boot: ${java_max}초 내에 응답 없음 (기동 중일 수 있음)"
            sudo journalctl -u module-profit -n 20 --no-pager
        fi
    fi

    echo ""
}

# ── 전체 배포 ──
deploy_full() {
    print_header
    log_info "전체 배포 시작 (Node.js + Spring Boot)"
    echo ""

    update_source
    build_java
    copy_files
    install_deps
    restart_services
    wait_healthy
    check_status

    log_ok "전체 배포 완료!"
    echo ""
}

# ── 빠른 배포 (npm install + gradle 빌드 생략) ──
deploy_quick() {
    print_header
    log_info "빠른 배포 시작 (npm install + gradle 빌드 생략)"
    echo ""

    update_source
    copy_files
    restart_services
    wait_healthy
    check_status

    log_ok "빠른 배포 완료!"
    echo ""
}

# ── Java만 빌드 + 재시작 ──
deploy_java_only() {
    print_header
    log_info "module-profit (Spring Boot) 배포 시작"
    echo ""

    update_source
    build_java
    copy_files
    restart_profit_service

    # Spring Boot 헬스체크
    if systemctl is-active --quiet module-profit 2>/dev/null; then
        local java_wait=0
        local java_max=60
        log_info "Spring Boot 헬스체크 대기 중..."
        while [ $java_wait -lt $java_max ]; do
            if curl -sf http://localhost:${SPRING_BOOT_PORT}/profit-api/metrics > /dev/null 2>&1; then
                log_ok "Spring Boot 정상 응답 확인 (${java_wait}초)"
                break
            fi
            sleep 3
            java_wait=$((java_wait + 3))
            echo -n "."
        done
        if [ $java_wait -ge $java_max ]; then
            echo ""
            log_warn "Spring Boot: ${java_max}초 내에 응답 없음"
        fi
    fi

    check_status
    log_ok "module-profit 배포 완료!"
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
        log_info "── module-profit 최근 로그 (50줄) ──"
        sudo journalctl -u module-profit -n 50 --no-pager 2>/dev/null || log_warn "module-profit 로그 없음"
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
    --build-java)
        print_header
        log_info "module-profit JAR 빌드만 실행"
        echo ""
        build_java
        # 빌드 후 app 디렉토리에 복사
        if [ -f "${PROFIT_SOURCE_DIR}/build/libs/${PROFIT_JAR_NAME}" ]; then
            cp "${PROFIT_SOURCE_DIR}/build/libs/${PROFIT_JAR_NAME}" "${PROFIT_JAR_PATH}"
            log_ok "JAR 복사 완료: ${PROFIT_JAR_PATH}"
        fi
        log_ok "빌드 완료! 재시작하려면: bash deploy.sh --java-only 또는 --restart"
        ;;
    --java-only)
        deploy_java_only
        ;;
    --help|-h)
        echo ""
        echo "사용법: bash deploy.sh [옵션]"
        echo ""
        echo "옵션:"
        echo "  (없음)        전체 배포 (pull + gradle빌드 + npm install + 재시작)"
        echo "  --quick       빠른 배포 (pull + 복사 + 재시작, 빌드/install 생략)"
        echo "  --restart     모든 서비스 재시작"
        echo "  --status      서비스 상태 확인"
        echo "  --logs        최근 로그 확인"
        echo "  --stop        모든 서비스 중지"
        echo "  --start       모든 서비스 시작"
        echo "  --build-java  module-profit JAR만 빌드 (재시작 안 함)"
        echo "  --java-only   module-profit만 빌드 + 재시작"
        echo "  --help        도움말"
        echo ""
        echo "서비스 구성:"
        echo "  nlq-server     Node.js Express  (port ${NODEJS_PORT})"
        echo "  module-profit  Spring Boot JAR  (port ${SPRING_BOOT_PORT})"
        echo "  analytics      Nginx proxy      (port ${NGINX_PORT})"
        echo ""
        echo "예시:"
        echo "  bash /data/analytics/deploy.sh              # 전체 배포"
        echo "  bash /data/analytics/deploy.sh --quick      # 소스만 변경 (빠른 배포)"
        echo "  bash /data/analytics/deploy.sh --java-only  # Spring Boot만 재배포"
        echo "  bash /data/analytics/deploy.sh --build-java # JAR만 빌드 (테스트용)"
        echo "  bash /data/analytics/deploy.sh --status     # 상태 확인"
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
