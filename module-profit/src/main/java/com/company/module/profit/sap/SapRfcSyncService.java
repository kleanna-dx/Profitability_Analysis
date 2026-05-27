package com.company.module.profit.sap;

import com.company.module.profit.entity.BatchStatus;
import com.company.module.profit.repository.BatchStatusRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * SAP RFC → MariaDB bw_profitability_data 동기화 서비스
 *
 * <p>기능:</p>
 * <ul>
 *   <li>SAP BW 시스템에서 RFC 함수(Z_BI_WEB_EX_BL)를 호출하여 T_DATA를 수신</li>
 *   <li>수신 데이터를 integration DB의 bw_profitability_data 테이블에 INSERT</li>
 *   <li>REPLACE 모드: 해당 월 기존 데이터 DELETE 후 INSERT</li>
 *   <li>배치 작업 이력을 profit_batch_status 테이블에 기록</li>
 * </ul>
 *
 * <p>RFC 함수: Z_BI_WEB_EX_BL</p>
 * <ul>
 *   <li>입력: I_CMONTH (YYYYMM)</li>
 *   <li>출력: T_DATA (테이블)</li>
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
     *
     * @param cmonth 입력년월 (YYYYMM)
     * @param mode   실행모드: "replace" | "append" | "dry-run"
     * @param userId 실행자 ID
     * @return 배치 작업 ID
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
     * 배치 작업 생성 (동기 — 즉시 ID 반환)
     */
    @Transactional
    public BatchStatus createBatchJob(String cmonth, String mode, String userId) {
        int year = Integer.parseInt(cmonth.substring(0, 4));
        int month = Integer.parseInt(cmonth.substring(4, 6));

        BatchStatus batch = BatchStatus.builder()
                .batchName("SAP RFC 동기화 (" + cmonth + ")")
                .batchType("SAP_RFC_SYNC")
                .sourceSystem("SAP BWP (" + sapProperties.getAshost() + ")")
                .targetTable("bw_profitability_data")
                .periodYear(year)
                .periodMonth(month)
                .createdBy(userId)
                .build();

        return batchStatusRepository.save(batch);
    }

    /**
     * 동기화 실행 (동기 — 내부 호출)
     */
    public void execute(Long batchId, String cmonth, String mode) {
        // 1. 상태 → RUNNING
        startBatch(batchId);

        // 2. SAP RFC 호출
        log.info("[SAP RFC] RFC 호출 시작 - cmonth={}", cmonth);
        List<Map<String, Object>> tData = callRfc(cmonth);

        if (tData.isEmpty()) {
            log.warn("[SAP RFC] T_DATA 비어있음 - cmonth={}", cmonth);
            completeBatch(batchId, 0L, 0L, 0L);
            return;
        }

        log.info("[SAP RFC] T_DATA 수신: {} rows", tData.size());

        // 3. dry-run이면 여기서 끝
        if ("dry-run".equals(mode)) {
            log.info("[SAP RFC] DRY-RUN 모드 - DB INSERT 건너뜀. {}건이 INSERT될 예정", tData.size());
            completeBatch(batchId, (long) tData.size(), 0L, 0L);
            return;
        }

        // 4. replace 모드: 기존 데이터 삭제
        long deletedRows = 0;
        if ("replace".equals(mode)) {
            deletedRows = deleteExistingData(cmonth);
            log.info("[SAP RFC] REPLACE 모드 - 기존 {}건 삭제 완료 (CALMONTH={})", deletedRows, cmonth);
        }

        // 5. 데이터 변환 + INSERT
        long insertedRows = insertData(tData);
        log.info("[SAP RFC] INSERT 완료: {}건", insertedRows);

        // 6. 완료
        completeBatch(batchId, (long) tData.size(), insertedRows, deletedRows);
    }

    // ================================================================
    // SAP RFC 호출
    // ================================================================

    /**
     * SAP RFC Z_BI_WEB_EX_BL 호출
     * SAP JCo 라이브러리를 사용하여 RFC 함수 호출
     */
    private List<Map<String, Object>> callRfc(String cmonth) {
        try {
            // JCo 클래스를 리플렉션으로 호출 (컴파일 타임 의존 방지)
            Class<?> destManagerClass = Class.forName("com.sap.conn.jco.JCoDestinationManager");
            Object destination = destManagerClass.getMethod("getDestination", String.class)
                    .invoke(null, SapRfcDestinationProvider.DESTINATION_NAME);

            // JCoFunction 가져오기
            Object repository = destination.getClass().getMethod("getRepository").invoke(destination);
            Object function = repository.getClass().getMethod("getFunction", String.class)
                    .invoke(repository, sapProperties.getRfcFunction());

            if (function == null) {
                throw new RuntimeException("RFC 함수를 찾을 수 없습니다: " + sapProperties.getRfcFunction());
            }

            // 입력 파라미터 설정
            Object importParams = function.getClass().getMethod("getImportParameterList").invoke(function);
            importParams.getClass().getMethod("setValue", String.class, String.class)
                    .invoke(importParams, "I_CMONTH", cmonth);

            log.info("[SAP RFC] {} 호출 (I_CMONTH={})", sapProperties.getRfcFunction(), cmonth);

            // RFC 실행
            function.getClass().getMethod("execute", destination.getClass().getInterfaces()[0])
                    .invoke(function, destination);

            // T_DATA 테이블 읽기
            Object exportTable = function.getClass().getMethod("getTableParameterList").invoke(function);
            Object tDataTable = exportTable.getClass().getMethod("getTable", String.class)
                    .invoke(exportTable, "T_DATA");

            int rowCount = (int) tDataTable.getClass().getMethod("getNumRows").invoke(tDataTable);
            log.info("[SAP RFC] T_DATA: {} rows 수신", rowCount);

            // JCoTable → List<Map> 변환
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
            }

            return result;

        } catch (ClassNotFoundException e) {
            throw new RuntimeException(
                    "[SAP JCo 미설치] sapjco3.jar가 classpath에 없습니다.\n" +
                    "  1. SAP Service Marketplace에서 SAP JCo 3.1 다운로드\n" +
                    "  2. sapjco3.jar → libs/ 디렉토리에 복사\n" +
                    "  3. libsapjco3.so (Linux) → /usr/lib/ 또는 LD_LIBRARY_PATH에 추가\n" +
                    "  4. build.gradle에 implementation files('libs/sapjco3.jar') 추가", e);
        } catch (Exception e) {
            throw new RuntimeException("[SAP RFC 호출 실패] " + e.getMessage(), e);
        }
    }

    // ================================================================
    // DB 작업
    // ================================================================

    /**
     * 해당 월 기존 데이터 삭제 (REPLACE 모드)
     */
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

    /**
     * T_DATA를 bw_profitability_data에 배치 INSERT
     */
    private long insertData(List<Map<String, Object>> tData) {
        int batchSize = 1000;
        long totalInserted = 0;

        List<Object[]> batch = new ArrayList<>(batchSize);

        for (int i = 0; i < tData.size(); i++) {
            Map<String, Object> sapRow = tData.get(i);
            Object[] row = convertRow(sapRow);
            batch.add(row);

            if (batch.size() >= batchSize || i == tData.size() - 1) {
                jdbcTemplate.batchUpdate(INSERT_SQL, batch);
                totalInserted += batch.size();

                double pct = (double) totalInserted / tData.size() * 100;
                log.info("[DB] INSERT 진행: {}/{} ({:.0f}%)", totalInserted, tData.size(), pct);

                batch.clear();
            }
        }

        return totalInserted;
    }

    /**
     * SAP T_DATA 행 → DB INSERT 파라미터 배열 변환
     */
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
                    // ZQTY_BOX, ZQTY_BAG, ZQTY_KE는 소수점 유지
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
    // 배치 상태 관리
    // ================================================================

    @Transactional
    protected void startBatch(Long batchId) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.start();
            log.info("[Batch] 작업 {} 시작", batchId);
        });
    }

    @Transactional
    protected void completeBatch(Long batchId, Long totalRows, Long insertedRows, Long deletedRows) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.complete(insertedRows, 0L);
            // totalRows는 T_DATA 수신 행 수로 별도 기록
            log.info("[Batch] 작업 {} 완료: T_DATA={}행, INSERT={}행, DELETE={}행",
                    batchId, totalRows, insertedRows, deletedRows);
        });
    }

    @Transactional
    protected void failBatch(Long batchId, String errorMessage) {
        batchStatusRepository.findById(batchId).ifPresent(batch -> {
            batch.fail(errorMessage);
            log.error("[Batch] 작업 {} 실패: {}", batchId, errorMessage);
        });
    }

    // ================================================================
    // 유틸리티
    // ================================================================

    /**
     * 해당 월 기존 데이터 건수 조회 (확인용)
     */
    public long countExistingData(String cmonth) {
        String sql = "SELECT COUNT(*) FROM bw_profitability_data WHERE CALMONTH = ?";
        Long count = jdbcTemplate.queryForObject(sql, Long.class, cmonth);
        return count != null ? count : 0;
    }

    /**
     * 전체 월별 데이터 현황 조회
     */
    public List<Map<String, Object>> getMonthlyDataSummary() {
        String sql = "SELECT CALMONTH, COUNT(*) AS CNT " +
                     "FROM bw_profitability_data " +
                     "GROUP BY CALMONTH " +
                     "ORDER BY CALMONTH DESC";
        return jdbcTemplate.queryForList(sql);
    }

    /**
     * 현재 실행 중인 배치가 있는지 확인
     */
    public boolean hasRunningBatch() {
        return !batchStatusRepository.findRunningBatches().isEmpty();
    }
}
