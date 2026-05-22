-- ============================================================
-- group_info 테이블 생성
-- 그룹웨어 조직 정보 (151건)
-- ============================================================

CREATE TABLE IF NOT EXISTS `group_info` (
    `group_id`         VARCHAR(20)  NOT NULL           COMMENT '그룹 ID',
    `group_name`       VARCHAR(200) NULL               COMMENT '그룹명',
    `parent_group_id`  VARCHAR(20)  NULL               COMMENT '상위 그룹 ID',
    `tenant_id`        VARCHAR(20)  NULL               COMMENT '테넌트 ID',
    `if_sync_seq`      INT          NULL               COMMENT '인터페이스 동기화 시퀀스',
    `if_regist_date`   DATETIME     NULL               COMMENT '인터페이스 등록일시',
    PRIMARY KEY (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='그룹(조직) 정보';
