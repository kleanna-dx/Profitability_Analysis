package com.company.module.profit.sap;

import com.company.module.profit.entity.BatchStatus;
import com.company.module.profit.repository.BatchStatusRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * SAP RFC -> MariaDB bw_profitability_data 동기화 서비스
 *
 * <p>batch_jobs 테이블에 배치 이력을 기록 (Node.js와 공유)</p>
 *
 * <p>기능:</p>
 * <ul>
 *   <li>SAP BW 시스템에서 RFC 함수(Z_BI_WEB_EX_BL)를 호출하여 T_DATA를 수신</li>
 *   <li>수신 데이터를 integration DB의 bw_profitability_data 테이블에 INSERT</li>
 *   <li>REPLACE 모드: 해당 월 기존 데이터 DELETE 후 INSERT</li>
 *   <li>배치 작업 이력을 batch_jobs 테이블에 기록</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SapRfcSyncService {

    private final BatchStatusRepository batchStatusRepository;
    private final JdbcTemplate jdbcTemplate;
    private final SapRfcProperties sapProperties;

    /** bw_profitability_data 컬럼 목록 (SEQ 제외) */
    private static final List<String> DB_COLUMNS = List.of(
            "CALYEAR", "CALMONTH", "CALDAY",
            "CO_AREA", "CO_AREA_NM",
            "PROFIT_CTR", "PROFIT_CTR_NM",
            "DIVISION", "DIVISION_NM",
            "PLANT", "PLANT_NM",
            "DISTR_CHAN", "DISTR_CHAN_NM",
            "ZDISTCHAN", "ZORG_TEAM",
            "SALES_OFF", "SALES_OFF_NM",
            "MATL_TYPE", "MATL_TYPE_NM",
            "MATL_GROUP", "MATL_GROUP_NM",
            "PRODH1", "PRODH1_NM",
            "PRODH2", "PRODH2_NM",
            "PRODH3", "PRODH3_NM",
            "PRODH4", "PRODH4_NM",
            "ZJPCODE", "ZJPCODE_NM",
            "ZBRAND", "ZBRAND_NM",
            "ZSBRAND", "ZSBRAND_NM",
            "BILL_TYPE", "BILL_TYPE_NM",
            "INCOTERMS", "INCOTERMS_NM",
            "CUST_GROUP", "CUST_GROUP_NM",
            "CUST_GRP1", "CUST_GRP1_NM",
            "COUNTRY", "COUNTRY_NM",
            "ZKUNN2", "ZKUNN2_NM",
            "CUSTOMER", "CUSTOMER_NM",
            "MATERIAL", "MATERIAL_NM",
            "ZBOXUNIT", "ZBAGUNIT", "ZUNIT", "CURRENCY",
            "ZQTY_BOX", "ZQTY_BAG", "ZQTY_KE",
            "ZAMT001", "ZAMT002", "ZAMT003", "ZAMT004", "ZAMT005",
            "ZAMT006", "ZAMT007", "ZAMT008", "ZAMT009", "ZAMT010",
            "ZAMT011", "ZAMT012", "ZAMT013", "ZAMT014", "ZAMT015",
            "ZAMT016", "ZAMT017", "ZAMT018", "ZAMT019", "ZAMT020",
            "ZAMT021", "ZAMT022", "ZAMT023", "ZAMT024", "ZAMT025",
            "ZAMT026", "ZAMT027", "ZAMT028", "ZAMT029", "ZAMT030",
            "ZAMT031", "ZAMT032", "ZAMT033", "ZAMT034", "ZAMT035",
            "ZAMT036", "ZAMT037", "ZAMT038", "ZAMT039", "ZAMT040",
            "ZAMT041", "ZAMT042", "ZAMT043", "ZAMT044", "ZAMT045",
            "ZAMT046", "ZAMT047", "ZAMT048", "ZAMT049", "ZAMT050",
            "ZAMT051", "ZAMT052", "ZAMT053", "ZAMT054", "ZAMT055",
            "ZAMT056", "ZAMT057", "ZAMT058", "ZAMT059", "ZAMT060",
            "ZAMT061", "ZAMT062", "ZAMT063", "ZAMT064"
    );

    /** 숫자형 컬럼 Set */
    private static final Set<String> NUMERIC_COLUMNS;
    static {
        Set<String> nums = new HashSet<>(Arrays.asList("ZQTY_BOX", "ZQTY_BAG", "ZQTY_KE"));
        for (int i = 1; i <= 64; i++) {
            nums.add(String.format("ZAMT%03d", i));
        }
        NUMERIC_COLUMNS = Collections.unmodifiableSet(nums);
    }

    /** INSERT SQL (미리 생성) */
    private static final String INSERT_SQL;
    static {
        String cols = String.join(", ", DB_COLUMNS);
        String placeholders = String.join(", ", Collections.nCopies(DB_COLUMNS.size(), "?"));
        INSERT_SQL = "INSERT INTO bw_profitability_data (" + cols + ") VALUES (" + placeholders + ")";
    }

    /**
     * SAP RFC 동기화 실행 (비동기)
     */
    @Async("batchTaskExecutor")
    public void executeAsync(Long batchId, String cmonth, String mode, String userId) {
        log.info("[SAP RFC] 비동기 실행 시작 - batchId={}, cmonth={}, mode={}", batchId, cmonth, mode);

        try {
            execute(batchId, cmonth, mode);
        } catch (Exception e) {
            log.error("[SAP RFC] 비동기 실행 실패 - batchId={}: {}", batchId, e.getMessage(), e);
            failBatch(batchId, e.getMessage());
        }
    }

    /**
     * 배치 작업 생성 (동기 - 즉시 ID 반환)
     * batch_jobs 테이블에 INSERT (Node.js에서도 볼 수 있음)
     */
    @Transactional
    public BatchStatus createBatchJob(String cmonth, String mode, String userId) {
        BatchStatus batch = BatchStatus.builder()
                .jobType("SAP_RFC_SYNC")
                .cmonth(cmonth)
                .mode(mode != null ? mode : "replace")
                .createdBy(userId)
                .build();

        return batchStatusRepository.save(batch);
    }

    /**
     * Node.js가 이미 생성한 batch_jobs 레코드를 찾아 반환
     * - 존재하면 기존 레코드 반환 (Node.js가 INSERT한 것)
     * - 존재하지 않으면 새로 생성
     */
    @Transactional
    public BatchStatus getOrCreateBatchJob(Long jobId, String cmonth, String mode, String userId) {
        return batchStatusRepository.findById(jobId)
                .orElseGet(() -> {
                    log.warn("[Batch] jobId={} 를 찾을 수 없어 새로 생성합니다", jobId);
                    return createBatchJob(cmonth, mode, userId);
                });
    }

    /**
     * 동기화 실행 (동기 - 내부 호출)
     * 각 단계별 상세 로그를 batch_jobs.log_text에 기록
     */
    public void execute(Long batchId, String cmonth, String mode) {
        Instant jobStart = Instant.now();

        // 1. 상태 -> running
        startBatch(batchId);
        appendBatchLog(batchId, String.format("[1/6] 배치 시작 — cmonth=%s, mode=%s", cmonth, mode));

        // 2. SAP RFC 호출
        appendBatchLog(batchId, "[2/6] SAP RFC 호출 시작...");
        appendBatchLog(batchId, String.format("  - SAP 서버: %s (시스넘: %s, SID: %s, Client: %s)",
                sapProperties.getAshost(), sapProperties.getSysnr(),
                sapProperties.getSysid(), sapProperties.getClient()));
        appendBatchLog(batchId, String.format("  - SAP 사용자: %s (언어: %s)",
                sapProperties.getUser(), sapProperties.getLang()));
        appendBatchLog(batchId, String.format("  - 커넥션 풀: capacity=%d, peakLimit=%d",
                sapProperties.getPoolCapacity(), sapProperties.getPeakLimit()));
        appendBatchLog(batchId, String.format("  - RFC 함수: %s", sapProperties.getRfcFunction()));
        appendBatchLog(batchId, String.format("  - 입력 파라미터: I_CMONTH=%s", cmonth));

        Instant rfcStart = Instant.now();
        log.info("[SAP RFC] RFC 호출 시작 - cmonth={}", cmonth);
        List<Map<String, Object>> tData = callRfc(batchId, cmonth);
        long rfcElapsed = Duration.between(rfcStart, Instant.now()).toSeconds();

        appendBatchLog(batchId, String.format("  - RFC 전체 소요: %d초", rfcElapsed));

        if (tData.isEmpty()) {
            log.warn("[SAP RFC] T_DATA 비어있음 - cmonth={}", cmonth);
            appendBatchLog(batchId, "  - T_DATA 비어있음 (0행 수신)");
            appendBatchLog(batchId, "[완료] 수신 데이터 없음");
            completeBatch(batchId, 0, 0, 0);
            return;
        }

        appendBatchLog(batchId, String.format("  - T_DATA 수신: %,d행", tData.size()));
        log.info("[SAP RFC] T_DATA 수신: {} rows", tData.size());

        // 3. 샘플 데이터 로그 (첫 1행)
        if (!tData.isEmpty()) {
            Map<String, Object> sample = tData.get(0);
            appendBatchLog(batchId, "[3/6] 수신 데이터 샘플 (첫 1행):");
            int fieldCount = 0;
            StringBuilder sb = new StringBuilder();
            for (Map.Entry<String, Object> entry : sample.entrySet()) {
                if (fieldCount < 10) {
                    sb.append(String.format("  - %s = %s\n", entry.getKey(), entry.getValue()));
                }
                fieldCount++;
            }
            sb.append(String.format("  ... 총 %d개 필드", fieldCount));
            appendBatchLog(batchId, sb.toString());
        }

        // 4. dry-run이면 여기서 끝
        if ("dry-run".equals(mode)) {
            log.info("[SAP RFC] DRY-RUN 모드 - DB INSERT 건너뜀. {}건이 INSERT될 예정", tData.size());
            appendBatchLog(batchId, String.format("[DRY-RUN] DB INSERT 건너뜀 — %,d건이 INSERT될 예정", tData.size()));
            completeBatch(batchId, tData.size(), 0, 0);
            return;
        }

        // 5. replace 모드: 기존 데이터 삭제
        int deletedRows = 0;
        if ("replace".equals(mode)) {
            appendBatchLog(batchId, "[4/6] REPLACE 모드 — 기존 데이터 삭제 중...");
            long existingCount = countExistingData(cmonth);
            appendBatchLog(batchId, String.format("  - CALMONTH=%s 기존 데이터: %,d건", cmonth, existingCount));

            Instant delStart = Instant.now();
            deletedRows = (int) deleteExistingData(cmonth);
            long delElapsed = Duration.between(delStart, Instant.now()).toSeconds();

            appendBatchLog(batchId, String.format("  - 삭제 완료: %,d건 (%d초 소요)", deletedRows, delElapsed));
            log.info("[SAP RFC] REPLACE 모드 - 기존 {}건 삭제 완료 (CALMONTH={})", deletedRows, cmonth);
        } else {
            appendBatchLog(batchId, String.format("[4/6] APPEND 모드 — 기존 데이터 유지 (현재 %,d건)", countExistingData(cmonth)));
        }

        // 6. 데이터 변환 + INSERT
        appendBatchLog(batchId, String.format("[5/6] DB INSERT 시작 — %,d행 (1,000건 단위 배치)", tData.size()));
        Instant insertStart = Instant.now();
        int insertedRows = (int) insertData(batchId, tData);
        long insertElapsed = Duration.between(insertStart, Instant.now()).toSeconds();

        appendBatchLog(batchId, String.format("  - INSERT 완료: %,d건 (%d초 소요)", insertedRows, insertElapsed));
        log.info("[SAP RFC] INSERT 완료: {}건", insertedRows);

        // 7. 최종 완료
        long totalElapsed = Duration.between(jobStart, Instant.now()).toSeconds();
        appendBatchLog(batchId, String.format(
                "[6/6] 배치 완료 — T_DATA=%,d행, INSERT=%,d행, DELETE=%,d행, 총 %d초 소요",
                tData.size(), insertedRows, deletedRows, totalElapsed));

        // INSERT 후 실제 DB 건수 검증
        long afterCount = countExistingData(cmonth);
        appendBatchLog(batchId, String.format("  - DB 검증: CALMONTH=%s 현재 %,d건", cmonth, afterCount));

        completeBatch(batchId, tData.size(), insertedRows, deletedRows);
    }

    // ================================================================
    // SAP RFC 호출
    // ================================================================

    /**
     * SAP RFC Z_BI_WEB_EX_BL 호출
     * 각 단계별 상세 로그를 batch_jobs.log_text에 기록
     */
    private List<Map<String, Object>> callRfc(Long batchId, String cmonth) {
        try {
            // ── Step 1: JCo 클래스 로드 ──
            appendBatchLog(batchId, "  [RFC-1] SAP JCo 클래스 로드 중...");
            Instant step1 = Instant.now();
            Class<?> destManagerClass = Class.forName("com.sap.conn.jco.JCoDestinationManager");
            appendBatchLog(batchId, String.format("  [RFC-1] JCo 클래스 로드 완료 (%dms)",
                    Duration.between(step1, Instant.now()).toMillis()));

            // ── Step 2: Destination 연결 ──
            appendBatchLog(batchId, String.format("  [RFC-2] SAP Destination 연결 중... (대상: %s)",
                    SapRfcDestinationProvider.DESTINATION_NAME));
            Instant step2 = Instant.now();
            Object destination = destManagerClass.getMethod("getDestination", String.class)
                    .invoke(null, SapRfcDestinationProvider.DESTINATION_NAME);
            long step2ms = Duration.between(step2, Instant.now()).toMillis();
            appendBatchLog(batchId, String.format("  [RFC-2] Destination 연결 완료 (%dms)", step2ms));

            // ── Step 3: Repository + Function 조회 ──
            appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 조회 중... (%s)",
                    sapProperties.getRfcFunction()));
            Instant step3 = Instant.now();
            Object repository = destination.getClass().getMethod("getRepository").invoke(destination);
            Object function = repository.getClass().getMethod("getFunction", String.class)
                    .invoke(repository, sapProperties.getRfcFunction());
            long step3ms = Duration.between(step3, Instant.now()).toMillis();

            if (function == null) {
                appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 NOT FOUND: %s",
                        sapProperties.getRfcFunction()));
                throw new RuntimeException("RFC 함수를 찾을 수 없습니다: " + sapProperties.getRfcFunction());
            }
            appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 조회 완료 (%dms)", step3ms));

            // ── Step 4: Import 파라미터 설정 + RFC 실행 ──
            Object importParams = function.getClass().getMethod("getImportParameterList").invoke(function);
            importParams.getClass().getMethod("setValue", String.class, String.class)
                    .invoke(importParams, "I_CMONTH", cmonth);

            appendBatchLog(batchId, String.format("  [RFC-4] RFC 실행 중... (%s, I_CMONTH=%s)",
                    sapProperties.getRfcFunction(), cmonth));
            log.info("[SAP RFC] {} 호출 (I_CMONTH={})", sapProperties.getRfcFunction(), cmonth);

            Instant step4 = Instant.now();
            function.getClass().getMethod("execute", destination.getClass().getInterfaces()[0])
                    .invoke(function, destination);
            long step4sec = Duration.between(step4, Instant.now()).toSeconds();
            long step4ms = Duration.between(step4, Instant.now()).toMillis();
            appendBatchLog(batchId, String.format("  [RFC-4] RFC 실행 완료 (%d초, %dms)", step4sec, step4ms));

            // ── Step 5: T_DATA 테이블 파싱 ──
            appendBatchLog(batchId, "  [RFC-5] T_DATA 테이블 파싱 중...");
            Instant step5 = Instant.now();

            Object exportTable = function.getClass().getMethod("getTableParameterList").invoke(function);
            Object tDataTable = exportTable.getClass().getMethod("getTable", String.class)
                    .invoke(exportTable, "T_DATA");

            int rowCount = (int) tDataTable.getClass().getMethod("getNumRows").invoke(tDataTable);
            appendBatchLog(batchId, String.format("  [RFC-5] T_DATA 행 수: %,d", rowCount));
            log.info("[SAP RFC] T_DATA: {} rows 수신", rowCount);

            if (rowCount > 0) {
                // 첫 행의 필드 수 확인
                tDataTable.getClass().getMethod("setRow", int.class).invoke(tDataTable, 0);
                int fieldCount = (int) tDataTable.getClass().getMethod("getFieldCount").invoke(tDataTable);
                appendBatchLog(batchId, String.format("  [RFC-5] 필드 수: %d개/행", fieldCount));
            }

            List<Map<String, Object>> result = new ArrayList<>(rowCount);
            for (int i = 0; i < rowCount; i++) {
                tDataTable.getClass().getMethod("setRow", int.class).invoke(tDataTable, i);

                Map<String, Object> row = new LinkedHashMap<>();
                int fieldCount = (int) tDataTable.getClass().getMethod("getFieldCount").invoke(tDataTable);
                for (int j = 0; j < fieldCount; j++) {
                    String fieldName = (String) tDataTable.getClass()
                            .getMethod("getName", int.class).invoke(tDataTable, j);
                    Object value = tDataTable.getClass()
                            .getMethod("getString", int.class).invoke(tDataTable, j);
                    row.put(fieldName, value);
                }
                result.add(row);

                // 10,000행 단위로 파싱 진행률 로그
                if (rowCount > 10000 && i > 0 && i % 10000 == 0) {
                    appendBatchLog(batchId, String.format("  [RFC-5] 파싱 진행: %,d/%,d행 (%.0f%%)",
                            i, rowCount, (double) i / rowCount * 100));
                }
            }

            long step5ms = Duration.between(step5, Instant.now()).toMillis();
            appendBatchLog(batchId, String.format("  [RFC-5] T_DATA 파싱 완료: %,d행 (%dms)",
                    result.size(), step5ms));

            return result;

        } catch (ClassNotFoundException e) {
            String msg = "[SAP JCo 미설치] sapjco3.jar가 classpath에 없습니다.\n" +
                    "  1. SAP Service Marketplace에서 SAP JCo 3.1 다운로드\n" +
                    "  2. sapjco3.jar -> libs/ 디렉토리에 복사\n" +
                    "  3. libsapjco3.so (Linux) -> /usr/lib/ 또는 LD_LIBRARY_PATH에 추가\n" +
                    "  4. build.gradle에 implementation files('libs/sapjco3.jar') 추가";
            appendBatchLog(batchId, "  [RFC-ERR] " + msg);
            throw new RuntimeException(msg, e);
        } catch (Exception e) {
            String msg = "[SAP RFC 호출 실패] " + e.getMessage();
            // InvocationTargetException인 경우 원인 에러 메시지 추출
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            String detail = cause.getClass().getSimpleName() + ": " + cause.getMessage();
            appendBatchLog(batchId, "  [RFC-ERR] " + detail);
            throw new RuntimeException(msg, e);
        }
    }

    // ================================================================
    // DB 작업
    // ================================================================

    private long deleteExistingData(String cmonth) {
        String countSql = "SELECT COUNT(*) FROM bw_profitability_data WHERE CALMONTH = ?";
        Long existing = jdbcTemplate.queryForObject(countSql, Long.class, cmonth);
        long count = existing != null ? existing : 0;

        if (count > 0) {
            jdbcTemplate.update("DELETE FROM bw_profitability_data WHERE CALMONTH = ?", cmonth);
            log.info("[DB] CALMONTH={} 기존 데이터 {}건 삭제", cmonth, count);
        }
        return count;
    }

    private long insertData(Long batchId, List<Map<String, Object>> tData) {
        int batchSize = 1000;
        long totalInserted = 0;
        int totalBatches = (int) Math.ceil((double) tData.size() / batchSize);

        List<Object[]> batch = new ArrayList<>(batchSize);

        for (int i = 0; i < tData.size(); i++) {
            Map<String, Object> sapRow = tData.get(i);
            Object[] row = convertRow(sapRow);
            batch.add(row);

            if (batch.size() >= batchSize || i == tData.size() - 1) {
                int currentBatch = (int) (totalInserted / batchSize) + 1;
                try {
                    jdbcTemplate.batchUpdate(INSERT_SQL, batch);
                    totalInserted += batch.size();

                    double pct = (double) totalInserted / tData.size() * 100;
                    String progressMsg = String.format(
                            "  - INSERT 진행: %,d/%,d (%.0f%%) [배치 %d/%d]",
                            totalInserted, tData.size(), pct, currentBatch, totalBatches);
                    log.info("[DB] {}", progressMsg);

                    // 10% 단위로 log_text에 진행률 기록
                    if (currentBatch == 1 || currentBatch == totalBatches || (currentBatch % Math.max(1, totalBatches / 10)) == 0) {
                        appendBatchLog(batchId, progressMsg);
                    }
                } catch (Exception e) {
                    String errMsg = String.format(
                            "  - INSERT 실패 (배치 %d/%d, 행 %,d~%,d): %s",
                            currentBatch, totalBatches,
                            totalInserted + 1, totalInserted + batch.size(),
                            e.getMessage());
                    log.error("[DB] {}", errMsg);
                    appendBatchLog(batchId, errMsg);
                    throw e;  // 상위에서 failBatch 처리
                }

                batch.clear();
            }
        }

        return totalInserted;
    }

    private Object[] convertRow(Map<String, Object> sapRow) {
        Object[] values = new Object[DB_COLUMNS.size()];

        for (int i = 0; i < DB_COLUMNS.size(); i++) {
            String col = DB_COLUMNS.get(i);
            Object val = sapRow.get(col);

            if (val == null || (val instanceof String && ((String) val).trim().isEmpty())) {
                if (NUMERIC_COLUMNS.contains(col)) {
                    values[i] = 0;
                } else {
                    values[i] = null;
                }
            } else if (NUMERIC_COLUMNS.contains(col)) {
                try {
                    String strVal = val.toString().replace(",", "").trim();
                    double d = Double.parseDouble(strVal);
                    if (col.startsWith("ZQTY_")) {
                        values[i] = d;
                    } else {
                        values[i] = (long) d;
                    }
                } catch (NumberFormatException e) {
                    values[i] = 0;
                }
            } else {
                values[i] = val.toString().trim();
            }
        }

        return values;
    }

    // ================================================================
    // 배치 상태 관리 (batch_jobs 테이블)
    // ================================================================

    @Transactional
    protected void startBatch(Long batchId) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.start();
            batch.appendLog("작업 시작...");
            log.info("[Batch] 작업 {} 시작", batchId);
        });
    }

    /**
     * batch_jobs.log_text에 로그 한 줄 추가 (타임스탬프 포함)
     */
    @Transactional
    protected void appendBatchLog(Long batchId, String message) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            String ts = java.time.LocalDateTime.now()
                    .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
            batch.appendLog("[" + ts + "] " + message);
        });
    }

    @Transactional
    protected void completeBatch(Long batchId, int totalRows, int insertedRows, int deletedRows) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.complete(totalRows, insertedRows, deletedRows);
            batch.appendLog(String.format("작업 완료: T_DATA=%d행, INSERT=%d행, DELETE=%d행",
                    totalRows, insertedRows, deletedRows));
            log.info("[Batch] 작업 {} 완료: T_DATA={}행, INSERT={}행, DELETE={}행",
                    batchId, totalRows, insertedRows, deletedRows);
        });
    }

    @Transactional
    protected void failBatch(Long batchId, String errorMessage) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.fail(errorMessage);
            batch.appendLog("작업 실패: " + errorMessage);
            log.error("[Batch] 작업 {} 실패: {}", batchId, errorMessage);
        });
    }

    // ================================================================
    // 유틸리티
    // ================================================================

    public long countExistingData(String cmonth) {
        String sql = "SELECT COUNT(*) FROM bw_profitability_data WHERE CALMONTH = ?";
        Long count = jdbcTemplate.queryForObject(sql, Long.class, cmonth);
        return count != null ? count : 0;
    }

    public List<Map<String, Object>> getMonthlyDataSummary() {
        String sql = "SELECT CALMONTH, COUNT(*) AS CNT " +
                     "FROM bw_profitability_data " +
                     "GROUP BY CALMONTH " +
                     "ORDER BY CALMONTH DESC";
        return jdbcTemplate.queryForList(sql);
    }

    public boolean hasRunningBatch() {
        return !batchStatusRepository.findRunningBatches().isEmpty();
    }

    /**
     * 실행 중인 배치가 있는지 확인 (특정 ID 제외)
     * - Node.js가 이미 running으로 만든 자기 자신을 제외
     */
    public boolean hasRunningBatchExcluding(Long excludeId) {
        return !batchStatusRepository.findRunningBatchesExcluding(excludeId).isEmpty();
    }
}
