-- ============================================================
-- 이력 테이블 (NLQ 질의 이력 / 빌더 쿼리 이력)
-- ============================================================

-- 1) 자연어 질의 이력
CREATE TABLE IF NOT EXISTS `nl_query_history` (
  `id`                int(11)       NOT NULL AUTO_INCREMENT,
  `query_text`        varchar(2000) NOT NULL   COMMENT '사용자 질문 (자연어)',
  `generated_sql`     text          DEFAULT NULL COMMENT 'AI가 생성한 SQL',
  `explanation`       varchar(1000) DEFAULT NULL COMMENT 'AI 설명',
  `chart_type`        varchar(20)   DEFAULT 'table' COMMENT '차트 유형 (bar/line/pie/table)',
  `chart_config`      longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
                      COMMENT '차트 설정 JSON' CHECK (json_valid(`chart_config`)),
  `result_data`       longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
                      COMMENT '쿼리 결과 데이터' CHECK (json_valid(`result_data`)),
  `row_count`         int(11)       DEFAULT 0  COMMENT '결과 행 수',
  `execution_time_ms` int(11)       DEFAULT 0  COMMENT 'SQL 실행 시간(ms)',
  `status`            varchar(20)   DEFAULT 'SUCCESS' COMMENT 'SUCCESS / FAILED',
  `error_message`     text          DEFAULT NULL COMMENT '에러 메시지 (실패시)',
  `created_at`        datetime      DEFAULT current_timestamp() COMMENT '질의 시각',
  PRIMARY KEY (`id`),
  KEY `idx_history_created` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='자연어 질의 이력';


-- 2) 비주얼 쿼리 빌더 실행 이력
CREATE TABLE IF NOT EXISTS `builder_query_history` (
  `id`                int(11)      NOT NULL AUTO_INCREMENT,
  `title`             varchar(200) NOT NULL   COMMENT '쿼리 제목 (자동 생성)',
  `fields_json`       text         NOT NULL   COMMENT '선택한 필드 목록 JSON',
  `conditions_json`   text         DEFAULT NULL COMMENT '필터 조건 JSON',
  `group_by_json`     text         DEFAULT NULL COMMENT 'GROUP BY JSON',
  `order_by`          varchar(100) DEFAULT NULL COMMENT 'ORDER BY 컬럼',
  `order_dir`         varchar(10)  DEFAULT 'DESC' COMMENT 'ASC/DESC',
  `limit_val`         int(11)      DEFAULT 1000  COMMENT 'LIMIT 값',
  `prompt`            text         DEFAULT NULL COMMENT '추가 프롬프트',
  `generated_sql`     text         DEFAULT NULL COMMENT '생성된 SQL',
  `row_count`         int(11)      DEFAULT 0    COMMENT '결과 행수',
  `execution_time_ms` int(11)      DEFAULT 0    COMMENT '실행 시간(ms)',
  `status`            enum('SUCCESS','FAILED') DEFAULT 'SUCCESS',
  `error_message`     text         DEFAULT NULL COMMENT '에러 메시지',
  `created_at`        timestamp    NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_created_at` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='비주얼 쿼리 빌더 실행 이력';
