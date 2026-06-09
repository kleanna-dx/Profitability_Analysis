-- ============================================================================
-- 032_rename_bw_columns_to_bic_prefix.sql
--
-- 목적:
--   2026-06 기준 bw_profitability_data 테이블의 16개 컬럼이
--   BIC_ 프리픽스로 재네이밍되었다. 이에 맞춰 학습관리(ontology_column)에
--   등록된 옛 컬럼명 데이터를 신규 컬럼명으로 일괄 정정한다.
--
--   대상 컬럼 16개 (옛 → 새):
--     ZDISTCHAN    → BIC_ZDISTCHAN
--     ZORG_TEAM    → BIC_ZORG_TEAM
--     ZJPCODE      → BIC_ZJPCODE        / ZJPCODE_NM  → BIC_ZJPCODE_NM
--     ZBRAND       → BIC_ZBRAND         / ZBRAND_NM   → BIC_ZBRAND_NM
--     ZSBRAND      → BIC_ZSBRAND        / ZSBRAND_NM  → BIC_ZSBRAND_NM
--     ZKUNN2       → BIC_ZKUNN2         / ZKUNN2_NM   → BIC_ZKUNN2_NM
--     ZBOXUNIT     → BIC_ZBOXUNIT
--     ZBAGUNIT     → BIC_ZBAGUNIT
--     ZUNIT        → BIC_ZUNIT
--     ZQTY_BOX     → BIC_ZQTY_BOX
--     ZQTY_BAG     → BIC_ZQTY_BAG
--     ZQTY_KE      → BIC_ZQTY_KE
--
-- 적용 범위:
--   ontology_column (domain_code = PS/HL/MGMT 모두, 약 48행)
--   ※ ontology_synonym 은 column_id (외래키) 로만 ontology_column 을 참조하므로
--     별도 수정 불필요. (column_name 자체를 갖고 있지 않음)
--   ※ metric.formula 는 ZAMT001~ZAMT064 만 사용하므로 영향 없음.
--
-- 멱등성:
--   - 옛 이름(ZDISTCHAN 등) 만 WHERE 절에 사용 → 이미 BIC_* 로 정정된 행은
--     매칭되지 않아 재실행 안전.
--   - UNIQUE KEY uk_col_table(domain_code, column_name, table_name) 충돌 방지를
--     위해 사전 검증: 동일 도메인에 BIC_* 가 이미 존재하면 옛 이름 행만 DELETE
--     (드물지만 수동으로 BIC_* 를 미리 추가한 환경 대비).
--
-- 사용 가능한 절: MariaDB 네이티브 (UPDATE/WHERE/AND NOT EXISTS)
-- 금지 절: SET @var / PREPARE / EXECUTE (동적 SQL 금지)
-- ============================================================================

-- ── 0) 사전 정리: 충돌 가능 행 제거 (드물게 BIC_* 가 이미 등록된 경우) ─────────
--     같은 (domain_code, table_name) 에 옛 이름과 BIC_새이름이 둘 다 있으면
--     UPDATE 시 UNIQUE 충돌 → 옛 이름 행을 먼저 DELETE 하여 충돌 회피.
--     ※ 현재(2026-06) 운영 DB에는 BIC_* 가 없으므로 이 DELETE 는 0건 영향.

DELETE old_row FROM ontology_column AS old_row
 INNER JOIN ontology_column AS new_row
    ON new_row.domain_code = old_row.domain_code
   AND COALESCE(new_row.table_name, '') = COALESCE(old_row.table_name, '')
   AND new_row.column_name = CONCAT('BIC_', old_row.column_name)
 WHERE old_row.column_name IN (
   'ZDISTCHAN','ZORG_TEAM',
   'ZJPCODE','ZJPCODE_NM','ZBRAND','ZBRAND_NM','ZSBRAND','ZSBRAND_NM',
   'ZKUNN2','ZKUNN2_NM',
   'ZBOXUNIT','ZBAGUNIT','ZUNIT',
   'ZQTY_BOX','ZQTY_BAG','ZQTY_KE'
 );

-- ── 1) 16개 컬럼명을 BIC_ 프리픽스로 정정 ────────────────────────────────────
--     멱등: 이미 BIC_* 인 행은 WHERE 매칭 안 됨.

UPDATE ontology_column SET column_name = 'BIC_ZDISTCHAN'   WHERE column_name = 'ZDISTCHAN';
UPDATE ontology_column SET column_name = 'BIC_ZORG_TEAM'   WHERE column_name = 'ZORG_TEAM';

UPDATE ontology_column SET column_name = 'BIC_ZJPCODE'     WHERE column_name = 'ZJPCODE';
UPDATE ontology_column SET column_name = 'BIC_ZJPCODE_NM'  WHERE column_name = 'ZJPCODE_NM';

UPDATE ontology_column SET column_name = 'BIC_ZBRAND'      WHERE column_name = 'ZBRAND';
UPDATE ontology_column SET column_name = 'BIC_ZBRAND_NM'   WHERE column_name = 'ZBRAND_NM';

UPDATE ontology_column SET column_name = 'BIC_ZSBRAND'     WHERE column_name = 'ZSBRAND';
UPDATE ontology_column SET column_name = 'BIC_ZSBRAND_NM'  WHERE column_name = 'ZSBRAND_NM';

UPDATE ontology_column SET column_name = 'BIC_ZKUNN2'      WHERE column_name = 'ZKUNN2';
UPDATE ontology_column SET column_name = 'BIC_ZKUNN2_NM'   WHERE column_name = 'ZKUNN2_NM';

UPDATE ontology_column SET column_name = 'BIC_ZBOXUNIT'    WHERE column_name = 'ZBOXUNIT';
UPDATE ontology_column SET column_name = 'BIC_ZBAGUNIT'    WHERE column_name = 'ZBAGUNIT';
UPDATE ontology_column SET column_name = 'BIC_ZUNIT'       WHERE column_name = 'ZUNIT';

UPDATE ontology_column SET column_name = 'BIC_ZQTY_BOX'    WHERE column_name = 'ZQTY_BOX';
UPDATE ontology_column SET column_name = 'BIC_ZQTY_BAG'    WHERE column_name = 'ZQTY_BAG';
UPDATE ontology_column SET column_name = 'BIC_ZQTY_KE'     WHERE column_name = 'ZQTY_KE';

-- ── 2) 검증 SELECT (적용 후 BIC_ 16종이 모두 보이면 성공) ────────────────────
--     운영 적용 시 실행 결과로 BIC_* 16종 × N도메인 행이 표시되어야 함.

SELECT column_name, COUNT(*) AS cnt
  FROM ontology_column
 WHERE column_name IN (
   'BIC_ZDISTCHAN','BIC_ZORG_TEAM',
   'BIC_ZJPCODE','BIC_ZJPCODE_NM','BIC_ZBRAND','BIC_ZBRAND_NM',
   'BIC_ZSBRAND','BIC_ZSBRAND_NM',
   'BIC_ZKUNN2','BIC_ZKUNN2_NM',
   'BIC_ZBOXUNIT','BIC_ZBAGUNIT','BIC_ZUNIT',
   'BIC_ZQTY_BOX','BIC_ZQTY_BAG','BIC_ZQTY_KE'
 )
 GROUP BY column_name
 ORDER BY column_name;
