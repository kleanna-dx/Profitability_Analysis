-- ============================================================
-- RAG 벡터 인덱스 테이블
-- 메타데이터를 임베딩하여 코사인 유사도 검색에 사용
-- ※ 서버 시작 시 자동 생성되지만, 수동 생성도 가능
-- ============================================================

CREATE TABLE IF NOT EXISTS `rag_embeddings` (
  `id`         int(11)    NOT NULL AUTO_INCREMENT,
  `chunk_type` enum('schema','ontology','metric','code_mapping','feedback','join_condition','rule')
               NOT NULL   COMMENT '메타데이터 유형',
  `source_id`  int(11)    DEFAULT NULL COMMENT '원본 테이블 ID (ontology_column.id, metric.id 등)',
  `chunk_text` text       NOT NULL   COMMENT '임베딩 원본 텍스트 (검색 대상)',
  `embedding`  longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
               COMMENT '1536차원 벡터 (text-embedding-3-small)' CHECK (json_valid(`embedding`)),
  `metadata`   longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
               COMMENT '추가 메타 (컬럼명, 수식 등)' CHECK (json_valid(`metadata`)),
  `is_active`  tinyint(1) DEFAULT 1,
  `created_at` datetime   DEFAULT current_timestamp(),
  `updated_at` datetime   DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rag_type`   (`chunk_type`),
  KEY `idx_rag_source` (`chunk_type`, `source_id`),
  KEY `idx_rag_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='RAG 메타데이터 벡터 인덱스';
