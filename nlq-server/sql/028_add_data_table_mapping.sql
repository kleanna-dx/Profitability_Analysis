-- ============================================================
-- Migration: 028_add_data_table_mapping.sql
-- Date    : 2026-06-04
-- Author  : AI Developer
-- ============================================================
--
-- ▶ 목적
--   batch_master 테이블에 "이 인터페이스가 데이터를 적재하는 대상 테이블/월컬럼"
--   매핑 정보를 추가한다.  지금까지는 NLP_RFC_001 → bw_profitability_data 매핑이
--   server.mjs 에 하드코딩되어 있었음. 이를 데이터 기반으로 분리.
--
-- ▶ 추가 컬럼
--   - data_table        : 적재 대상 테이블명 (예: 'bw_profitability_data')
--                         NULL 허용 (매핑이 아직 없는 인터페이스용)
--   - data_month_column : 월 단위 그룹핑에 사용할 컬럼명 (예: 'CALMONTH')
--                         NULL 이면 [인터페이스 관리]의 '월별 데이터 현황' 차트가
--                         "적재 테이블 매핑 없음" 안내 메시지를 표시.
--
-- ▶ 시드 갱신
--   - NLP_RFC_001 (수익성데이터) → data_table='bw_profitability_data',
--                                   data_month_column='CALMONTH'
--   - NLP_RFC_002 (제조원가)     → 그대로 NULL 유지 (운영팀이 적재 테이블 확정 후 채워넣음)
--
-- ▶ 멱등성
--   - MariaDB 네이티브 IF [NOT] EXISTS 문법 사용.
--   - 시드 UPDATE 는 항상 안전 (값이 이미 같아도 영향 없음).
-- ============================================================

-- ── 1. data_table 컬럼 추가 ──
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS data_table VARCHAR(100) NULL
    COMMENT '인터페이스가 적재하는 대상 테이블명 (예: bw_profitability_data)'
    AFTER rfc_param;

-- ── 2. data_month_column 컬럼 추가 ──
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS data_month_column VARCHAR(50) NULL
    COMMENT "월별 그룹핑 컬럼명 (예: CALMONTH). NULL 이면 월별 차트 비활성"
    AFTER data_table;

-- ── 3. NLP_RFC_001 (수익성데이터) 매핑 시드 ──
UPDATE batch_master
   SET data_table        = 'bw_profitability_data',
       data_month_column = 'CALMONTH'
 WHERE interface_id = 'NLP_RFC_001'
   AND (data_table IS NULL OR data_month_column IS NULL);

-- ── 4. 확인 (운영에서 실행 후 결과 검증용) ──
SELECT interface_id, interface_name, data_table, data_month_column
  FROM batch_master
 ORDER BY interface_id;
