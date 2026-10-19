-- ============================================================
-- 모든 rpsim_ 테이블에 CREATED_BY 컬럼 추가 (없는 테이블만)
-- 등록자 userId를 기록하기 위한 컬럼
-- 날짜: 2026-10-19
-- ============================================================

USE integration;

-- CREATED_BY가 없는 테이블에 추가하는 프로시저
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS add_created_by()
BEGIN
    DECLARE tbl VARCHAR(100);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'rpsim_%'
        AND TABLE_NAME NOT IN (
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'CREATED_BY'
        );
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO tbl;
        IF done THEN LEAVE read_loop; END IF;
        SET @sql = CONCAT('ALTER TABLE ', tbl, ' ADD COLUMN CREATED_BY VARCHAR(50) NULL COMMENT ''등록자 userId'' AFTER MEMO');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added CREATED_BY to ', tbl) AS info;
    END LOOP;
    CLOSE cur;
END //
DELIMITER ;

CALL add_created_by();
DROP PROCEDURE IF EXISTS add_created_by;
