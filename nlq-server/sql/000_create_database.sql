-- ============================================================
-- 데이터베이스 및 사용자 생성
-- ※ root 권한으로 실행
-- ============================================================

CREATE DATABASE IF NOT EXISTS `company_board`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 전용 사용자 생성 (환경에 맞게 host/비밀번호 변경)
-- CREATE USER IF NOT EXISTS 'appuser'@'%' IDENTIFIED BY '비밀번호입력';
-- GRANT ALL PRIVILEGES ON company_board.* TO 'appuser'@'%';
-- FLUSH PRIVILEGES;
