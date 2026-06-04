-- ============================================================
-- 운영 배포 스크립트: PR #85 ~ PR #92 통합 마이그레이션
-- 제목: 인터페이스 관리 (batch_master / batch_jobs) 후속 정리
-- 대상 DB: MariaDB 10.5+ (검증: 11.8 / company_board)
-- ============================================================
--
-- ★ 이 파일 하나만 운영 DB 에 실행하면, 개발 환경과 동일한 스키마가 됩니다.
-- ★ 모든 ALTER 는 MariaDB 네이티브 IF [NOT] EXISTS 절을 사용 → 멱등.
-- ★ 모든 UPDATE 는 WHERE 가드 → 재실행 안전.
-- ★ 사용자 변수(SET @...) / PREPARE / EXECUTE 같은 동적 SQL 미사용.
-- ★ 026 통합본(PR #67~#79) 이 이미 적용된 환경 기준으로 추가 변경만 포함.
--
-- ▶ 실행 방법:
--     mysql -u company -p company_board < deploy_pr85_to_pr92.sql
--   또는 Adminer / DBeaver / HeidiSQL 에서 통째로 붙여넣고 실행.
--
-- ▶ 포함된 변경 (PR 별):
--     PR #85     : Revert PR #84 (코드만, DB 변경 없음)
--     PR #86~#88 : UI / API 변경 (DB 변경 없음)
--     PR #89     : 027 NO-OP
--     PR #90     : batch_master 매핑 컬럼 추가 (PR #91 에서 정리되므로 운영은 곧장 #91 패턴)
--     PR #91     : batch_master 에 IFTBL 컬럼 (인터페이스 테이블) — 028 우회, 곧장 IFTBL 만 도입
--     PR #92-①   : batch_jobs.interface_id 컬럼/인덱스 보장 + NULL 백필
--     PR #92-②   : batch_master.allowed_modes / exec_command 컬럼 삭제
--     PR #92-③   : batch_master.receiver 정규화 ('S&OP' / NULL → 'analytics')
-- ============================================================


-- ============================================================
-- [SECTION 1] PR #91 — batch_master.IFTBL 컬럼 도입
--   - 원래 PR #90 에서 data_table / data_month_column 두 컬럼을 추가했으나
--     PR #91 에서 data_table → IFTBL 리네임 + data_month_column 삭제로 정리됨.
--   - 운영은 028 (data_table 추가) 을 건너뛰고 곧장 IFTBL 만 도입.
-- ============================================================

-- 1-1) data_table 컬럼이 만약 존재한다면 IFTBL 로 리네임
--      (운영은 028 을 적용하지 않으므로 보통 NO-OP. 혹시 적용했어도 안전.)
ALTER TABLE batch_master
  CHANGE COLUMN IF EXISTS data_table IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블';

-- 1-2) IFTBL 컬럼이 아직 없으면 추가 (신규 환경 / 028 안 탄 환경)
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블' AFTER rfc_param;

-- 1-3) IFTBL 코멘트는 항상 보정 (멱등)
ALTER TABLE batch_master
  MODIFY COLUMN IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블';

-- 1-4) data_month_column 컬럼이 있다면 삭제 (PR #91 에서 over-engineering 판단으로 제거)
ALTER TABLE batch_master
  DROP COLUMN IF EXISTS data_month_column;

-- 1-5) NLP_RFC_001 시드 보정 — IFTBL 이 비어 있으면 'bw_profitability_data' 로 채움
UPDATE batch_master
   SET IFTBL = 'bw_profitability_data'
 WHERE interface_id = 'NLP_RFC_001'
   AND (IFTBL IS NULL OR IFTBL = '');


-- ============================================================
-- [SECTION 2] PR #92-① — batch_jobs.interface_id 보장 + NULL 백필
--   - [인터페이스 이력관리] 탭에서 인터페이스 ID 필터링이 동작하도록
--     batch_jobs 의 모든 행이 interface_id 를 가지게 만든다.
-- ============================================================

-- 2-1) interface_id 컬럼 보장 (026 에서 이미 추가되었지만 안전하게 IF NOT EXISTS)
ALTER TABLE batch_jobs
  ADD COLUMN IF NOT EXISTS interface_id VARCHAR(50) NULL
    COMMENT '인터페이스 ID (batch_master)' AFTER job_type;

-- 2-2) 코멘트는 항상 보정 (멱등)
ALTER TABLE batch_jobs
  MODIFY COLUMN interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)';

-- 2-3) interface_id 인덱스 보장
ALTER TABLE batch_jobs
  ADD INDEX IF NOT EXISTS idx_batch_jobs_interface (interface_id);

-- 2-4) NULL 백필 ① — created_by 가 'scheduler:<interface_id>' 형식이면 거기서 추출
UPDATE batch_jobs
   SET interface_id = SUBSTRING(created_by, 11)
 WHERE interface_id IS NULL
   AND created_by LIKE 'scheduler:%'
   AND LENGTH(created_by) > 10;

-- 2-5) NULL 백필 ② — 그 외 NULL 행은 'NLP_RFC_001' (현 운영 메인 인터페이스) 로 fallback
UPDATE batch_jobs
   SET interface_id = 'NLP_RFC_001'
 WHERE interface_id IS NULL;


-- ============================================================
-- [SECTION 3] PR #92-② — batch_master.allowed_modes / exec_command 컬럼 삭제
--   - allowed_modes: 모든 인터페이스가 'replace,append,dry-run' 동일값 → 차등화 의미 0
--     → server.mjs 의 상수(ALLOWED_MODES_LIST)로 일원화
--   - exec_command: 실제 실행 분기에서 사용되지 않는 죽은 필드 → 제거
-- ============================================================

ALTER TABLE batch_master
  DROP COLUMN IF EXISTS allowed_modes;

ALTER TABLE batch_master
  DROP COLUMN IF EXISTS exec_command;


-- ============================================================
-- [SECTION 4] PR #92-③ — batch_master.receiver 정규화
--   - 사용자 정책: 수신 시스템은 'analytics' 로 고정
--   - 'S&OP' / 'snop' / NULL / 빈문자열 등 잔여값을 일괄 'analytics' 로 갱신
-- ============================================================

UPDATE batch_master
   SET receiver = 'analytics'
 WHERE receiver IS NULL
    OR receiver = ''
    OR LOWER(receiver) IN ('s&op', 'snop', 's-op', 's_op');


-- ============================================================
-- [SECTION 5] 결과 확인 (참고용 SELECT)
--   - 운영 적용 후 아래 결과를 확인해 주세요.
-- ============================================================

SELECT '=== batch_master 컬럼 ===' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_master'
 ORDER BY ORDINAL_POSITION;

SELECT '=== batch_master 행 ===' AS info;
SELECT interface_id, sender, receiver, default_mode, IFTBL
  FROM batch_master
 ORDER BY interface_id;

SELECT '=== batch_jobs.interface_id 통계 ===' AS info;
SELECT COUNT(*)                      AS total_rows,
       SUM(interface_id IS NULL)     AS null_left,
       SUM(interface_id IS NOT NULL) AS has_iface
  FROM batch_jobs;

-- ============================================================
-- ✅ 완료.
--
-- 기대값:
--   - batch_master :
--       * IFTBL 컬럼 존재 (코멘트 '인터페이스 테이블')
--       * data_month_column / allowed_modes / exec_command 없음
--       * 모든 행의 receiver = 'analytics'
--       * NLP_RFC_001 의 IFTBL = 'bw_profitability_data'
--   - batch_jobs :
--       * interface_id 컬럼 존재 + idx_batch_jobs_interface 인덱스 존재
--       * null_left = 0
-- ============================================================
