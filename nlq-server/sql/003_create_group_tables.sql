-- ============================================================
-- 그룹(조직) 정보 + 유저-그룹 매핑 테이블
-- 그룹웨어 연동 데이터
-- ============================================================

-- 1) 그룹 정보 (151건)
CREATE TABLE IF NOT EXISTS `group_info` (
  `group_id`         varchar(20)  NOT NULL            COMMENT '그룹 ID',
  `group_name`       varchar(100) NOT NULL            COMMENT '그룹 이름',
  `parent_group_id`  varchar(20)  DEFAULT NULL        COMMENT '상위 그룹 ID',
  `tenant_id`        varchar(20)  DEFAULT NULL        COMMENT '테넌트 ID',
  `leader_id`        varchar(50)  DEFAULT NULL        COMMENT '리더 ID',
  `sort_order`       int(11)      DEFAULT NULL        COMMENT '정렬 순서',
  `child_group_count` int(11)     DEFAULT NULL        COMMENT '하위 그룹 수',
  `register_id`      varchar(50)  DEFAULT NULL        COMMENT '등록자 ID',
  `register_name`    varchar(100) DEFAULT NULL        COMMENT '등록자 이름',
  `regist_date`      datetime     DEFAULT NULL        COMMENT '등록일시',
  `updater_id`       varchar(50)  DEFAULT NULL        COMMENT '수정자 ID',
  `updater_name`     varchar(100) DEFAULT NULL        COMMENT '수정자 이름',
  `update_date`      datetime     DEFAULT NULL        COMMENT '수정일시',
  `if_sync_seq`      int(11)      DEFAULT NULL        COMMENT '인터페이스 동기화 시퀀스',
  `if_regist_date`   datetime     DEFAULT NULL        COMMENT '인터페이스 등록일시',
  `use_yn`           varchar(1)   DEFAULT NULL        COMMENT '사용 여부 (Y/N)',
  PRIMARY KEY (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='그룹정보';


-- 2) 유저-그룹 매핑 (606건)
CREATE TABLE IF NOT EXISTS `user_group_info` (
  `group_id`         varchar(20)  NOT NULL            COMMENT '그룹 ID',
  `user_id`          varchar(50)  NOT NULL            COMMENT '사용자 ID',
  `tenant_id`        varchar(20)  DEFAULT NULL        COMMENT '테넌트 ID',
  `represent_group`  int(11)      DEFAULT NULL        COMMENT '대표 그룹 여부 (1=대표)',
  `if_sync_seq`      int(11)      DEFAULT NULL        COMMENT '인터페이스 동기화 시퀀스',
  `if_regist_date`   datetime     DEFAULT NULL        COMMENT '인터페이스 등록일시',
  PRIMARY KEY (`group_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='유저그룹정보';
