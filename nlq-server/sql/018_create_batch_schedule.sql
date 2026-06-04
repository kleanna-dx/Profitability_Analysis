-- =====================================================================
-- 018_create_batch_schedule.sql
-- 인터페이스 수행(스케줄) 테이블
-- =====================================================================

CREATE TABLE IF NOT EXISTS batch_schedule (
  id                  INT(11)      NOT NULL AUTO_INCREMENT,
  interface_id        VARCHAR(50)  NOT NULL                  COMMENT '인터페이스 ID (FK → batch_master)',
  schedule_type       ENUM('daily','monthly') NOT NULL DEFAULT 'daily' COMMENT '수행 주기',
  exec_time           TIME         NOT NULL DEFAULT '06:00:00' COMMENT '수행 시간',
  exec_day_of_month   TINYINT(2)   DEFAULT NULL              COMMENT '월간일 경우 실행일(1~31)',
  is_active           TINYINT(1)   NOT NULL DEFAULT 1        COMMENT '활성 여부',
  last_run_at         DATETIME     DEFAULT NULL              COMMENT '마지막 수행 시각',
  last_run_status     ENUM('success','failed','running','pending') DEFAULT NULL COMMENT '마지막 수행 상태',
  next_run_at         DATETIME     DEFAULT NULL              COMMENT '다음 수행 예정',
  remark              VARCHAR(500) DEFAULT NULL              COMMENT '비고',
  created_by          VARCHAR(50)  DEFAULT NULL              COMMENT '등록자',
  updated_by          VARCHAR(50)  DEFAULT NULL              COMMENT '수정자',
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batch_schedule_interface (interface_id),
  KEY idx_batch_schedule_active (is_active),
  CONSTRAINT fk_batch_schedule_interface
    FOREIGN KEY (interface_id) REFERENCES batch_master(interface_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='인터페이스 수행(스케줄) 관리';

-- =====================================================================
-- 시드 데이터 (스크린샷 기반 6건)
-- =====================================================================
INSERT INTO batch_schedule
  (interface_id,  schedule_type, exec_time, is_active, remark, created_by)
VALUES
  ('SNOP_RFC_001', 'daily', '06:00:00', 1, NULL, 'admin'),
  ('SNOP_RFC_002', 'daily', '06:00:00', 1, NULL, 'admin'),
  ('SNOP_RFC_003', 'daily', '06:00:00', 1, NULL, 'admin'),
  ('SNOP_RFC_004', 'daily', '06:00:00', 1, NULL, 'admin'),
  ('SNOP_RFC_005', 'daily', '23:00:00', 1, NULL, 'admin'),
  ('SNOP_RFC_006', 'daily', '07:00:00', 0, '(비활성)', 'admin')
ON DUPLICATE KEY UPDATE
  schedule_type = VALUES(schedule_type),
  exec_time = VALUES(exec_time),
  is_active = VALUES(is_active),
  remark = VALUES(remark),
  updated_by = 'admin';
