-- ============================================================
-- user_group_info 테이블 생성
-- 사용자-그룹 매핑 정보 (606건)
-- ============================================================

CREATE TABLE IF NOT EXISTS `user_group_info` (
    `group_id`         VARCHAR(20)  NOT NULL           COMMENT '그룹 ID',
    `user_id`          VARCHAR(50)  NOT NULL           COMMENT '사용자 ID',
    `tenant_id`        VARCHAR(20)  NULL               COMMENT '테넌트 ID',
    `represent_group`  INT          NULL               COMMENT '대표 그룹 여부 (1=대표)',
    `if_sync_seq`      INT          NULL               COMMENT '인터페이스 동기화 시퀀스',
    `if_regist_date`   DATETIME     NULL               COMMENT '인터페이스 등록일시',
    PRIMARY KEY (`group_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='유저그룹정보';
