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

    /** bw_profitability_data 컬럼 목록 (SEQ 제외)
     *  주의: 2026-06 기준 16개 컬럼이 BIC_ 프리픽스로 재네이밍됨.
     *  SAP RFC T_DATA 가 보내는 필드명은 여전히 옛 이름이므로,
     *  SAP→DB 매핑은 {@link #SAP_FIELD_TO_DB_COLUMN} 으로 수행. */
    private static final List<String> DB_COLUMNS = List.of(
            "CALYEAR", "CALMONTH", "CALDAY",
            "CO_AREA", "CO_AREA_NM",
            "PROFIT_CTR", "PROFIT_CTR_NM",
            "DIVISION", "DIVISION_NM",
            "PLANT", "PLANT_NM",
            "DISTR_CHAN", "DISTR_CHAN_NM",
            "BIC_ZDISTCHAN", "BIC_ZORG_TEAM",
            "SALES_OFF", "SALES_OFF_NM",
            "MATL_TYPE", "MATL_TYPE_NM",
            "MATL_GROUP", "MATL_GROUP_NM",
            "PRODH1", "PRODH1_NM",
            "PRODH2", "PRODH2_NM",
            "PRODH3", "PRODH3_NM",
            "PRODH4", "PRODH4_NM",
            "BIC_ZJPCODE", "BIC_ZJPCODE_NM",
            "BIC_ZBRAND", "BIC_ZBRAND_NM",
            "BIC_ZSBRAND", "BIC_ZSBRAND_NM",
            "BILL_TYPE", "BILL_TYPE_NM",
            "INCOTERMS", "INCOTERMS_NM",
            "CUST_GROUP", "CUST_GROUP_NM",
            "CUST_GRP1", "CUST_GRP1_NM",
            "ZZKVGR7", "ZZKVGR7_NM",
            "COUNTRY", "COUNTRY_NM",
            "BIC_ZKUNN2", "BIC_ZKUNN2_NM",
            "CUSTOMER", "CUSTOMER_NM",
            "MATERIAL", "MATERIAL_NM",
            "BIC_ZBOXUNIT", "BIC_ZBAGUNIT", "BIC_ZUNIT", "CURRENCY",
            "BIC_ZQTY_BOX", "BIC_ZQTY_BAG", "BIC_ZQTY_KE",
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

    /** 숫자형 컬럼 Set (DB 컬럼명 기준) */
    private static final Set<String> NUMERIC_COLUMNS;
    static {
        Set<String> nums = new HashSet<>(Arrays.asList("BIC_ZQTY_BOX", "BIC_ZQTY_BAG", "BIC_ZQTY_KE"));
        for (int i = 1; i <= 64; i++) {
            nums.add(String.format("ZAMT%03d", i));
        }
        NUMERIC_COLUMNS = Collections.unmodifiableSet(nums);
    }

    /**
     * SAP RFC T_DATA 필드명 → DB 컬럼명 매핑.
     *
     * <p>2026-06 기준 bw_profitability_data 의 16개 컬럼이 BIC_ 프리픽스로 재네이밍되었지만,
     * SAP BW 측 RFC(Z_BI_WEB_EX_BL) 가 내려주는 T_DATA 의 필드명은 여전히 옛 이름이다.
     * 따라서 RFC 필드명 → DB 컬럼명 변환 테이블을 두고, fieldIndexMap 빌드 시
     * 이 매핑을 거쳐 매칭한다.</p>
     *
     * <p>매핑이 없는 컬럼(예: CALMONTH, ZAMT001~064 등)은 SAP 필드명 == DB 컬럼명 이므로
     * 본 맵에 등록하지 않는다.</p>
     */
    private static final Map<String, String> SAP_FIELD_TO_DB_COLUMN;
    static {
        Map<String, String> m = new HashMap<>();
        m.put("ZDISTCHAN",   "BIC_ZDISTCHAN");
        m.put("ZORG_TEAM",   "BIC_ZORG_TEAM");
        m.put("ZJPCODE",     "BIC_ZJPCODE");
        m.put("ZJPCODE_NM",  "BIC_ZJPCODE_NM");
        m.put("ZBRAND",      "BIC_ZBRAND");
        m.put("ZBRAND_NM",   "BIC_ZBRAND_NM");
        m.put("ZSBRAND",     "BIC_ZSBRAND");
        m.put("ZSBRAND_NM",  "BIC_ZSBRAND_NM");
        m.put("ZKUNN2",      "BIC_ZKUNN2");
        m.put("ZKUNN2_NM",   "BIC_ZKUNN2_NM");
        m.put("ZBOXUNIT",    "BIC_ZBOXUNIT");
        m.put("ZBAGUNIT",    "BIC_ZBAGUNIT");
        m.put("ZUNIT",       "BIC_ZUNIT");
        m.put("ZQTY_BOX",    "BIC_ZQTY_BOX");
        m.put("ZQTY_BAG",    "BIC_ZQTY_BAG");
        m.put("ZQTY_KE",     "BIC_ZQTY_KE");
        SAP_FIELD_TO_DB_COLUMN = Collections.unmodifiableMap(m);
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
     *
     * <p>메모리 최적화: SAP T_DATA를 전부 메모리에 올리지 않고,
     * 청크(CHUNK_SIZE) 단위로 파싱→변환→INSERT를 반복하여
     * 22만건 이상도 -Xmx2g 이내에서 처리 가능</p>
     */
    public void execute(Long batchId, String cmonth, String mode) {
        Instant jobStart = Instant.now();

        // 1. 상태 -> running
        startBatch(batchId);
        appendBatchLog(batchId, String.format("[1/6] 배치 시작 — cmonth=%s, mode=%s", cmonth, mode));

        // 2. SAP RFC 호출 + 스트리밍 INSERT
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

        // callRfcAndInsert: SAP 호출 → 스트리밍 파싱 → DB INSERT 를 한 메서드에서 수행
        // 반환: [totalRows, insertedRows] — 메모리에 전체 데이터를 보유하지 않음
        long[] result = callRfcAndInsert(batchId, cmonth, mode);
        int totalRows = (int) result[0];
        int insertedRows = (int) result[1];
        int deletedRows = (int) result[2];

        long rfcElapsed = Duration.between(rfcStart, Instant.now()).toSeconds();
        appendBatchLog(batchId, String.format("  - RFC+INSERT 전체 소요: %d초", rfcElapsed));

        // 최종 완료
        long totalElapsed = Duration.between(jobStart, Instant.now()).toSeconds();
        appendBatchLog(batchId, String.format(
                "[6/6] 배치 완료 — T_DATA=%,d행, INSERT=%,d행, DELETE=%,d행, 총 %d초 소요",
                totalRows, insertedRows, deletedRows, totalElapsed));

        // INSERT 후 실제 DB 건수 검증
        long afterCount = countExistingData(cmonth);
        appendBatchLog(batchId, String.format("  - DB 검증: CALMONTH=%s 현재 %,d건", cmonth, afterCount));

        completeBatch(batchId, totalRows, insertedRows, deletedRows);
    }

    // ================================================================
    // SAP RFC 호출
    // ================================================================

    /** 스트리밍 INSERT 청크 크기: 5,000행씩 파싱→INSERT 후 GC 해제 */
    private static final int CHUNK_SIZE = 5000;

    /**
     * SAP RFC 호출 + 스트리밍 DB INSERT (메모리 최적화 핵심)
     *
     * <p>기존 callRfc()는 22만 건 전체를 List에 올린 뒤 insertData()로 넘겼기 때문에
     * 피크 메모리가 ~1.8GB에 달해 -Xmx2g에서도 OOM 위험이 있었음.</p>
     *
     * <p>개선: T_DATA를 CHUNK_SIZE(5,000행)씩 파싱 → 즉시 변환 → batchUpdate INSERT
     * → 청크 해제를 반복하여, 동시에 메모리에 올라가는 데이터는 항상 ~5,000행 분량.</p>
     *
     * @return long[3] = {totalRows, insertedRows, deletedRows}
     */
    private long[] callRfcAndInsert(Long batchId, String cmonth, String mode) {
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

            // ── Step 5: T_DATA 메타정보 + 필드 매핑 ──
            appendBatchLog(batchId, "  [RFC-5] T_DATA 테이블 파싱 준비...");
            Instant step5 = Instant.now();

            Object exportTable = function.getClass().getMethod("getTableParameterList").invoke(function);
            Object tDataTable = exportTable.getClass().getMethod("getTable", String.class)
                    .invoke(exportTable, "T_DATA");

            int rowCount = (int) tDataTable.getClass().getMethod("getNumRows").invoke(tDataTable);
            appendBatchLog(batchId, String.format("  [RFC-5] T_DATA 행 수: %,d", rowCount));
            log.info("[SAP RFC] T_DATA: {} rows 수신", rowCount);

            if (rowCount == 0) {
                appendBatchLog(batchId, "  - T_DATA 비어있음 (0행 수신)");
                return new long[]{0, 0, 0};
            }

            // 필드 수 확인
            tDataTable.getClass().getMethod("setRow", int.class).invoke(tDataTable, 0);
            int totalFieldCount = (int) tDataTable.getClass().getMethod("getFieldCount").invoke(tDataTable);
            appendBatchLog(batchId, String.format("  [RFC-5] 필드 수: %d개/행", totalFieldCount));

            // 필드명 → 인덱스 매핑 (DB 컬럼만)
            // JCo Table에서 필드명은 getRecordMetaData().getName(int)로 가져와야 함
            Object metaData = tDataTable.getClass()
                    .getMethod("getRecordMetaData").invoke(tDataTable);
            java.lang.reflect.Method getNameMethod = metaData.getClass()
                    .getMethod("getName", int.class);

            // SAP 필드명을 DB 컬럼명으로 변환하여 fieldIndexMap 구성
            // (BIC_ 재네이밍 이후 SAP T_DATA 는 여전히 옛 이름을 사용하므로 매핑 필요)
            Set<String> dbColumnSet = new HashSet<>(DB_COLUMNS);
            Map<String, Integer> fieldIndexMap = new LinkedHashMap<>();
            for (int j = 0; j < totalFieldCount; j++) {
                String sapName = (String) getNameMethod.invoke(metaData, j);
                // SAP 필드명 → DB 컬럼명 변환 (매핑 없으면 동일 이름 사용)
                String dbName = SAP_FIELD_TO_DB_COLUMN.getOrDefault(sapName, sapName);
                if (dbColumnSet.contains(dbName)) {
                    fieldIndexMap.put(dbName, j);
                }
            }
            appendBatchLog(batchId, String.format("  [RFC-5] 매핑 필드: %d/%d개 (DB 컬럼 기준)",
                    fieldIndexMap.size(), totalFieldCount));

            // 리플렉션 메서드 캐시
            java.lang.reflect.Method getStringMethod = tDataTable.getClass().getMethod("getString", int.class);
            java.lang.reflect.Method setRowMethod = tDataTable.getClass().getMethod("setRow", int.class);

            // ── 샘플 로그 (첫 1행) ──
            setRowMethod.invoke(tDataTable, 0);
            appendBatchLog(batchId, "[3/6] 수신 데이터 샘플 (첫 1행):");
            StringBuilder sb = new StringBuilder();
            int sampleCount = 0;
            for (Map.Entry<String, Integer> entry : fieldIndexMap.entrySet()) {
                if (sampleCount < 10) {
                    Object val = getStringMethod.invoke(tDataTable, entry.getValue());
                    sb.append(String.format("  - %s = %s\n", entry.getKey(), val));
                }
                sampleCount++;
            }
            sb.append(String.format("  ... 총 %d개 필드", fieldIndexMap.size()));
            appendBatchLog(batchId, sb.toString());

            // ── dry-run 모드 ──
            if ("dry-run".equals(mode)) {
                log.info("[SAP RFC] DRY-RUN 모드 - DB INSERT 건너뜀. {}건이 INSERT될 예정", rowCount);
                appendBatchLog(batchId, String.format("[DRY-RUN] DB INSERT 건너뜀 — %,d건이 INSERT될 예정", rowCount));
                return new long[]{rowCount, 0, 0};
            }

            // ── replace 모드: 기존 데이터 삭제 ──
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

            // ── Step 6: 스트리밍 파싱 + INSERT (CHUNK_SIZE 단위) ──
            appendBatchLog(batchId, String.format("[5/6] 스트리밍 INSERT 시작 — %,d행 (청크 %,d행, 배치 1,000건)",
                    rowCount, CHUNK_SIZE));
            Instant insertStart = Instant.now();

            long totalInserted = 0;
            int batchSize = 1000;
            int totalBatches = (int) Math.ceil((double) rowCount / batchSize);
            List<Object[]> batch = new ArrayList<>(batchSize);

            for (int i = 0; i < rowCount; i++) {
                setRowMethod.invoke(tDataTable, i);

                // SAP 행 → Object[] 직접 변환 (중간 HashMap 생략으로 메모리 절약)
                Object[] values = new Object[DB_COLUMNS.size()];
                for (int c = 0; c < DB_COLUMNS.size(); c++) {
                    String col = DB_COLUMNS.get(c);
                    Integer fieldIdx = fieldIndexMap.get(col);
                    if (fieldIdx == null) {
                        // SAP에 없는 DB 컬럼
                        values[c] = NUMERIC_COLUMNS.contains(col) ? 0 : null;
                        continue;
                    }
                    String rawValue = (String) getStringMethod.invoke(tDataTable, fieldIdx);
                    if (rawValue == null || rawValue.trim().isEmpty()) {
                        values[c] = NUMERIC_COLUMNS.contains(col) ? 0 : null;
                    } else if (NUMERIC_COLUMNS.contains(col)) {
                        try {
                            double d = Double.parseDouble(rawValue.replace(",", "").trim());
                            // BIC_ZQTY_* (수량) 는 DECIMAL → double, ZAMT* (금액) 는 BIGINT → long
                            values[c] = col.startsWith("BIC_ZQTY_") ? d : (long) d;
                        } catch (NumberFormatException e) {
                            values[c] = 0;
                        }
                    } else {
                        values[c] = rawValue.trim();
                    }
                }
                batch.add(values);

                // 배치 INSERT
                if (batch.size() >= batchSize || i == rowCount - 1) {
                    int currentBatch = (int) (totalInserted / batchSize) + 1;
                    try {
                        jdbcTemplate.batchUpdate(INSERT_SQL, batch);
                        totalInserted += batch.size();

                        // 10% 단위 또는 첫/마지막 배치에 진행률 로그
                        if (currentBatch == 1 || i == rowCount - 1 ||
                                (currentBatch % Math.max(1, totalBatches / 10)) == 0) {
                            double pct = (double) totalInserted / rowCount * 100;
                            String progressMsg = String.format(
                                    "  - INSERT 진행: %,d/%,d (%.0f%%) [배치 %d/%d]",
                                    totalInserted, rowCount, pct, currentBatch, totalBatches);
                            log.info("[DB] {}", progressMsg);
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
                        throw e;
                    }
                    batch.clear();
                }

                // 진행률 로그 (10,000행 단위)
                if (rowCount > 10000 && i > 0 && i % 10000 == 0) {
                    log.info("[SAP RFC] 스트리밍 진행: {}/{} ({}%)",
                            i, rowCount, (int)((double) i / rowCount * 100));
                }
            }

            long step5ms = Duration.between(step5, Instant.now()).toMillis();
            long insertElapsed = Duration.between(insertStart, Instant.now()).toSeconds();
            appendBatchLog(batchId, String.format("  - 파싱+INSERT 완료: %,d행 (%dms, INSERT %d초)",
                    totalInserted, step5ms, insertElapsed));
            log.info("[SAP RFC] 스트리밍 INSERT 완료: {}건", totalInserted);

            return new long[]{rowCount, totalInserted, deletedRows};

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

    // insertData(), convertRow() 메서드 제거됨
    // → callRfcAndInsert() 내부에서 SAP 파싱과 동시에 직접 변환+INSERT 수행
    // → 중간 List<Map> 없이 SAP row → Object[] → batchUpdate 스트리밍

    // ================================================================
    // 배치 상태 관리 (batch_jobs 테이블)
    // ── JPA self-invocation 트랜잭션 문제 방지를 위해 JdbcTemplate 직접 SQL 사용 ──
    // ================================================================

    protected void startBatch(Long batchId) {
        String ts = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
        jdbcTemplate.update(
                "UPDATE batch_jobs SET status='running', started_at=NOW(), " +
                "log_text=CONCAT(IFNULL(log_text,''), ?), updated_at=NOW() WHERE id=?",
                "[" + ts + "] 작업 시작...\n", batchId);
        log.info("[Batch] 작업 {} 시작", batchId);
    }

    /**
     * batch_jobs.log_text에 로그 한 줄 추가 (타임스탬프 포함)
     * + 서버 로그파일(slf4j)에도 동시 출력
     */
    protected void appendBatchLog(Long batchId, String message) {
        // 서버 로그파일에 출력 (journalctl / logback으로 확인 가능)
        log.info("[Batch:{}] {}", batchId, message);

        String ts = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
        jdbcTemplate.update(
                "UPDATE batch_jobs SET log_text=CONCAT(IFNULL(log_text,''), ?), updated_at=NOW() WHERE id=?",
                "[" + ts + "] " + message + "\n", batchId);
    }

    protected void completeBatch(Long batchId, int totalRows, int insertedRows, int deletedRows) {
        String ts = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
        String logMsg = String.format("[%s] 작업 완료: T_DATA=%d행, INSERT=%d행, DELETE=%d행\n",
                ts, totalRows, insertedRows, deletedRows);
        jdbcTemplate.update(
                "UPDATE batch_jobs SET status='success', finished_at=NOW(), " +
                "total_rows=?, inserted_rows=?, deleted_rows=?, " +
                "log_text=CONCAT(IFNULL(log_text,''), ?), updated_at=NOW() WHERE id=?",
                totalRows, insertedRows, deletedRows, logMsg, batchId);
        log.info("[Batch] 작업 {} 완료: T_DATA={}행, INSERT={}행, DELETE={}행",
                batchId, totalRows, insertedRows, deletedRows);
    }

    protected void failBatch(Long batchId, String errorMessage) {
        String ts = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
        String logMsg = String.format("[%s] 작업 실패: %s\n", ts, errorMessage);
        jdbcTemplate.update(
                "UPDATE batch_jobs SET status='failed', finished_at=NOW(), " +
                "error_message=?, log_text=CONCAT(IFNULL(log_text,''), ?), updated_at=NOW() WHERE id=?",
                errorMessage, logMsg, batchId);
        log.error("[Batch] 작업 {} 실패: {}", batchId, errorMessage);
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
