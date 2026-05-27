#!/bin/bash
# ============================================================
# SAP RFC 환경 확인 스크립트
# 운영서버(10.2.14.246)에서 실행
# ============================================================

echo "=========================================="
echo "  SAP RFC 환경 확인"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# 1. SAP NW RFC SDK 확인
echo ""
echo "[1] SAP NW RFC SDK 확인"
echo "---"
if [ -d "/usr/sap" ]; then
    echo "  /usr/sap 존재"
    ls -la /usr/sap/ 2>/dev/null
fi
if [ -d "/usr/local/sap" ]; then
    echo "  /usr/local/sap 존재"
    ls -la /usr/local/sap/ 2>/dev/null
fi

# libsapnwrfc.so 검색
echo ""
echo "  libsapnwrfc.so 검색:"
find / -name "libsapnwrfc*" 2>/dev/null | head -10
find / -name "sapnwrfc*" 2>/dev/null | head -10

# SAPNWRFC_HOME 환경변수
echo ""
echo "  SAPNWRFC_HOME: ${SAPNWRFC_HOME:-'(미설정)'}"
echo "  LD_LIBRARY_PATH: ${LD_LIBRARY_PATH:-'(미설정)'}"

# 2. Python pyrfc 확인
echo ""
echo "[2] Python pyrfc 확인"
echo "---"
python3 --version 2>/dev/null || echo "  python3 없음"
pip3 list 2>/dev/null | grep -i pyrfc || echo "  pyrfc 미설치"
pip3 list 2>/dev/null | grep -i pymysql || echo "  pymysql 미설치"

# 3. Java JCo 확인
echo ""
echo "[3] Java JCo (sapjco3.jar) 확인"
echo "---"
find / -name "sapjco3*" 2>/dev/null | head -5 || echo "  sapjco3 없음"
java -version 2>&1 | head -1 || echo "  java 없음"

# 4. 네트워크 확인
echo ""
echo "[4] 네트워크 연결 확인"
echo "---"
echo -n "  SAP BWP (10.2.14.220:3301): "
timeout 3 bash -c 'echo > /dev/tcp/10.2.14.220/3301' 2>/dev/null && echo "OK" || echo "FAIL"
echo -n "  SAP BWP (10.2.14.220:3201): "
timeout 3 bash -c 'echo > /dev/tcp/10.2.14.220/3201' 2>/dev/null && echo "OK" || echo "FAIL"
echo -n "  MariaDB (10.2.14.247:3306): "
timeout 3 bash -c 'echo > /dev/tcp/10.2.14.247/3306' 2>/dev/null && echo "OK" || echo "FAIL"

# 5. 기존 RFC 관련 프로세스/서비스 확인
echo ""
echo "[5] 기존 RFC/SAP 관련 프로세스"
echo "---"
ps aux | grep -i "sap\|rfc\|jco" | grep -v grep | head -10 || echo "  관련 프로세스 없음"

# 6. integration DB의 기존 테이블 확인
echo ""
echo "[6] integration DB 테이블 확인 (RFC 관련)"
echo "---"
mysql -h 10.2.14.247 -u appuser -p'Kleannara12#' integration -e "
  SHOW TABLES LIKE '%rfc%';
  SHOW TABLES LIKE '%sap%';
  SHOW TABLES LIKE '%bw%';
  SHOW TABLES LIKE '%sync%';
" 2>/dev/null || echo "  DB 접속 실패"

echo ""
echo "=========================================="
echo "  확인 완료"
echo "=========================================="
