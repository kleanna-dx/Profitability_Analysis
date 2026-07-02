-- ============================================================
-- Migration 035: nl_user_memory (사용자 계정별 개인 규칙 저장)
-- ============================================================
-- 목적: GPT-5.5 는 stateless 이므로 사용자가 "앞으로 rt는 두루마리로 불러줘"
--       같은 개인 규칙을 말해도 채팅방을 벗어나면 잊어버린다.
--       계정별 장기 기억을 위해 개인 규칙을 이 테이블에 저장하고,
--       매 요청마다 SYSTEM 프롬프트에 로드해서 GPT 에게 알려준다.
--
-- 우선순위:
--   Layer 1: 학습관리 (Ontology / Metric) — 서비스 전체 공통, 절대 오버라이드 불가
--   Layer 3: 사용자 개인 규칙 (이 테이블) — 표현/해석만 개인화
--
-- 정합성 원칙:
--   - Metric 산식 오버라이드는 저장 자체를 거부 (memory_type 에 metric_formula 없음)
--   - 사용자당 활성(is_active='Y') 규칙 상한 50개
-- ============================================================

CREATE TABLE IF NOT EXISTS nl_user_memory (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL COMMENT '사용자 로그인 ID',
  memory_type VARCHAR(50) NOT NULL COMMENT 'term_alias | query_preference | metric_preference',
  trigger_text VARCHAR(500) NULL COMMENT 'query_preference 에서 매칭할 사용자 질문 패턴',
  user_expression VARCHAR(500) NULL COMMENT 'term_alias 에서 사용자가 쓰는 표현 (예: rt)',
  normalized_meaning VARCHAR(500) NULL COMMENT 'term_alias 에서 실제 의미 (예: 두루마리)',
  rule_json TEXT NULL COMMENT '확장 규칙 JSON (예: {"add_columns":["영업이익율(%)"]})',
  is_active CHAR(1) NOT NULL DEFAULT 'Y' COMMENT '활성 여부 (Y/N)',
  source_query TEXT NULL COMMENT '규칙이 자동 추출된 원본 사용자 발화 (감사용)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_active (user_id, is_active),
  INDEX idx_user_type (user_id, memory_type),
  INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='사용자 계정별 GPT 개인화 규칙';

-- ============================================================
-- "내 개인 규칙" 사이드바 메뉴 등록 (모든 로그인 사용자에게 노출)
-- ============================================================
INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order, is_active)
VALUES ('my_memory', '내 개인 규칙', '/my-memory.html', 'fas fa-user-cog', 8, 1)
ON DUPLICATE KEY UPDATE
  menu_name = VALUES(menu_name),
  menu_url = VALUES(menu_url),
  icon_class = VALUES(icon_class),
  is_active = VALUES(is_active);

-- 모든 역할(admin/user) 에 매핑
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
  FROM roles r CROSS JOIN menus m
 WHERE m.menu_code = 'my_memory'
   AND NOT EXISTS (
     SELECT 1 FROM role_menus rm
      WHERE rm.role_id = r.id AND rm.menu_id = m.id
   );
