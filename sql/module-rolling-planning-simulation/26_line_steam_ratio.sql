-- ============================================================
-- 26. 라인별 스팀수요 비중 마스터 (rpsim_line_steam_ratio)
-- 
-- 목적: 라인(PM2/PM3 등) 가동 여부에 따라 
--        전체 스팀 수요를 축소 배분하기 위한 기준 비율
-- 
-- 규칙: 
--   한 라인만 가동하는 날 → 전체 스팀량 × 해당 라인 비중
--   비율 합계가 100%일 필요 없음 (화장지 등 미포함분 존재 가능)
--   화면에서 수정 가능한 파라미터 (하드코딩 금지)
-- ============================================================

CREATE TABLE IF NOT EXISTS rpsim_line_steam_ratio (
    RATIO_ID        BIGINT AUTO_INCREMENT PRIMARY KEY,
    YEAR            INT NOT NULL COMMENT '적용연도',
    DIVISION        VARCHAR(20) NOT NULL DEFAULT 'PS' COMMENT '사업부',
    MACHINE_CODE    VARCHAR(20) NOT NULL COMMENT '호기코드 (PM2, PM3 등)',
    STEAM_RATIO     DECIMAL(6,3) NOT NULL DEFAULT 0 COMMENT '스팀수요 비중 (%)',
    MEMO            VARCHAR(200) DEFAULT NULL COMMENT '비고',
    CREATED_BY      VARCHAR(50) DEFAULT NULL,
    CREATED_AT      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_line_steam_ratio (YEAR, DIVISION, MACHINE_CODE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='라인별 스팀수요 비중 마스터';

-- ============================================================
-- 시드 데이터 (2025년 PS사업부 기준)
-- 담당자 확인 비율: PM2 ≈ 20%, PM3 ≈ 70%, HL(화장지) ≈ 10%
-- 현재 PS만 관리 → PM2, PM3만 등록
-- ============================================================
INSERT INTO rpsim_line_steam_ratio (YEAR, DIVISION, MACHINE_CODE, STEAM_RATIO, MEMO) VALUES
(2025, 'PS', 'PM2', 20.000, '2호기 스팀수요 비중 약 20%'),
(2025, 'PS', 'PM3', 70.000, '3호기 스팀수요 비중 약 70%')
ON DUPLICATE KEY UPDATE
    STEAM_RATIO = VALUES(STEAM_RATIO),
    MEMO = VALUES(MEMO);

-- 2026년도 미리 등록 (연도별 재설정 가능)
INSERT INTO rpsim_line_steam_ratio (YEAR, DIVISION, MACHINE_CODE, STEAM_RATIO, MEMO) VALUES
(2026, 'PS', 'PM2', 20.000, '2호기 스팀수요 비중 약 20%'),
(2026, 'PS', 'PM3', 70.000, '3호기 스팀수요 비중 약 70%')
ON DUPLICATE KEY UPDATE
    STEAM_RATIO = VALUES(STEAM_RATIO),
    MEMO = VALUES(MEMO);
