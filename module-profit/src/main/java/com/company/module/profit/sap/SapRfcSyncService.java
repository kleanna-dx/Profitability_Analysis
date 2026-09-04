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
 * SAP RFC -> MariaDB 동기화 서비스
 *
 * <p>batch_jobs 테이블에 배치 이력을 기록 (Node.js와 공유)</p>
 *
 * <p>[PR #332] 두 인터페이스 통합 실행:</p>
 * <ul>
 *   <li>수익성분석    (NLP_RFC_001) - Z_BI_WEB_EX_BL   → bw_profitability_data</li>
 *   <li>제조원가      (NLP_RFC_002) - Z_BI_WEB_EX_BL_4 → sys_aimd_cot015</li>
 *   <li>제조원가 RFC 2 (NLP_RFC_003) - Z_BI_WEB_EX_BL_5 → sys_aimd_cot043 (신규)</li>
 * </ul>
 *
 * <p>동일한 JCo(module-profit.jar) 를 사용하여 두 RFC 를 호출하고, 요청 body 로
 * 전달된 <code>rfcName</code> / <code>targetTable</code> 값을 기반으로 매핑 전략
 * ({@link TableMapping}) 을 선택하여 파싱/INSERT 대상을 결정한다.</p>
 *
 * <p>후위호환: rfcName/targetTable 이 null/blank 이면 수익성분석 기본 매핑을 사용.
 * 스케줄러 · 기존 클라이언트를 그대로 두고도 동작이 100% 동일.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SapRfcSyncService {

    private final BatchStatusRepository batchStatusRepository;
    private final JdbcTemplate jdbcTemplate;
    private final SapRfcProperties sapProperties;

    // ================================================================
    // [PR #332] 인터페이스별 테이블 매핑 (전략 패턴)
    // ================================================================

    /**
     * 대상 테이블별 컬럼/매핑/SQL 을 한 곳에 캡슐화한 불변 값 객체.
     *
     * <p>동일한 JCo 호출 코드가 두 인터페이스에서 재사용되도록 하기 위해,
     * 인터페이스별로 달라지는 요소(대상 테이블 / DB 컬럼 목록 / SAP→DB 컬럼명
     * 매핑 / 숫자·소수 컬럼 집합 / INSERT · DELETE · COUNT SQL) 를 이 객체가
     * 통째로 들고 있는다.</p>
     */
    static final class TableMapping {
        final String targetTable;
        final List<String> dbColumns;
        final Map<String, String> sapFieldToDbColumn;
        final Set<String> numericColumns;
        final Set<String> decimalColumns;
        final String insertSql;
        final String deleteSql;
        final String countSql;

        TableMapping(String targetTable,
                     List<String> dbColumns,
                     Map<String, String> sapFieldToDbColumn,
                     Set<String> numericColumns,
                     Set<String> decimalColumns) {
            this.targetTable = targetTable;
            this.dbColumns = List.copyOf(dbColumns);
            this.sapFieldToDbColumn = Map.copyOf(sapFieldToDbColumn);
            this.numericColumns = Set.copyOf(numericColumns);
            this.decimalColumns = Set.copyOf(decimalColumns);
            String cols = String.join(", ", this.dbColumns);
            String placeholders = String.join(", ", Collections.nCopies(this.dbColumns.size(), "?"));
            this.insertSql = "INSERT INTO " + targetTable + " (" + cols + ") VALUES (" + placeholders + ")";
            this.deleteSql = "DELETE FROM " + targetTable + " WHERE CALMONTH = ?";
            this.countSql  = "SELECT COUNT(*) FROM " + targetTable + " WHERE CALMONTH = ?";
        }
    }

    // ================================================================
    // 매핑 (1) 수익성분석 — bw_profitability_data
    //   ※ 기존 상수 정의를 그대로 옮겨온 것이므로 동작은 완전 동일.
    // ================================================================

    /** bw_profitability_data 컬럼 목록 (SEQ 제외). BIC_ 재네이밍은 SAP_FIELD_TO_DB_COLUMN 에서 처리. */
    private static final List<String> DB_COLUMNS_PROFITABILITY = List.of(
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

    /** SAP RFC T_DATA 필드명 → DB 컬럼명 매핑 (수익성). */
    private static final Map<String, String> SAP_FIELD_TO_DB_COLUMN_PROFITABILITY;
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
        SAP_FIELD_TO_DB_COLUMN_PROFITABILITY = Collections.unmodifiableMap(m);
    }

    /** 수익성 숫자형 컬럼 (수량 3개 + ZAMT001~064). */
    private static final Set<String> NUMERIC_COLUMNS_PROFITABILITY;
    /** 수익성 소수 유지 컬럼 (BIC_ZQTY_*). */
    private static final Set<String> DECIMAL_COLUMNS_PROFITABILITY =
            Set.of("BIC_ZQTY_BOX", "BIC_ZQTY_BAG", "BIC_ZQTY_KE");
    static {
        Set<String> nums = new HashSet<>(DECIMAL_COLUMNS_PROFITABILITY);
        for (int i = 1; i <= 64; i++) {
            nums.add(String.format("ZAMT%03d", i));
        }
        NUMERIC_COLUMNS_PROFITABILITY = Collections.unmodifiableSet(nums);
    }

    /** 수익성분석 매핑 인스턴스. */
    static final TableMapping PROFITABILITY_MAPPING = new TableMapping(
            "bw_profitability_data",
            DB_COLUMNS_PROFITABILITY,
            SAP_FIELD_TO_DB_COLUMN_PROFITABILITY,
            NUMERIC_COLUMNS_PROFITABILITY,
            DECIMAL_COLUMNS_PROFITABILITY
    );

    // ================================================================
    // 매핑 (2) 제조원가 — sys_aimd_cot015 (PR #332 신규)
    //   ※ 043_create_sys_aimd_cot015.sql 스키마 및 Python 참고 스크립트
    //     scripts/sap_rfc_sync_mfg_cost.py 의 DB_COLUMNS/NUMERIC 정의와
    //     정확히 일치.
    // ================================================================

    /**
     * sys_aimd_cot015 컬럼 목록 (seq 제외, INSERT 순서). 총 37 컬럼.
     *
     * [2026-09-04 PR #415~] MATERIAL_NM 뒤에 DIVISION / DIVISION_NM (제품군 코드/명) 추가.
     *   - SAP RFC Z_BI_WEB_EX_BL_4 에 두 필드가 추가되어 응답으로 수신됨.
     *   - 필드명이 SAP 원본과 동일 (DIVISION, DIVISION_NM) 이라
     *     normalizeSapFieldName 의 기본 대문자화 규칙으로 자동 매핑됨.
     *   - DIVISION: SAP CHAR 2 → VARCHAR(2), DIVISION_NM: SAP CHAR 40 → VARCHAR(40).
     *   - 문자열 컬럼이므로 NUMERIC_COLUMNS / DECIMAL_COLUMNS 에는 추가하지 않음.
     */
    private static final List<String> DB_COLUMNS_COT015 = List.of(
            "CALMONTH", "PLANT", "PLANT_NM", "MATERIAL", "MATERIAL_NM",
            "DIVISION", "DIVISION_NM",
            "ZCGUBUN_D", "ZCGUBUN", "BASE_UOM", "LBKUM", "CURRENCY",
            "TOTAL", "KST_V", "KST_F",
            "KST001", "KST002", "KST004", "KST006", "KST008", "KST010",
            "KST012", "KST014", "KST015", "KST017", "KST019", "KST021",
            "KST025", "KST027", "KST029", "KST031", "KST033", "KST035",
            "KST037", "KST039",
            "TOTAL1", "TOTAL2"
    );

    /**
     * 제조원가는 /BIC/ prefix 처리를 {@link #normalizeSapFieldName} 에서 일반 규칙으로
     * 처리하므로 별도 이름 매핑이 필요없음.
     */
    private static final Map<String, String> SAP_FIELD_TO_DB_COLUMN_COT015 = Map.of();

    /** 제조원가 소수 유지 컬럼 (LBKUM: 생산수량 DECIMAL 17,3). */
    private static final Set<String> DECIMAL_COLUMNS_COT015 = Set.of("LBKUM");

    /** 제조원가 숫자형 컬럼 = LBKUM + BIGINT 원가 컬럼. */
    private static final Set<String> NUMERIC_COLUMNS_COT015 = Set.of(
            "LBKUM",
            "TOTAL", "KST_V", "KST_F", "TOTAL1", "TOTAL2",
            "KST001", "KST002", "KST004", "KST006", "KST008", "KST010",
            "KST012", "KST014", "KST015", "KST017", "KST019", "KST021",
            "KST025", "KST027", "KST029", "KST031", "KST033", "KST035",
            "KST037", "KST039"
    );

    /** 제조원가 매핑 인스턴스. */
    static final TableMapping MFG_COST_COT015_MAPPING = new TableMapping(
            "sys_aimd_cot015",
            DB_COLUMNS_COT015,
            SAP_FIELD_TO_DB_COLUMN_COT015,
            NUMERIC_COLUMNS_COT015,
            DECIMAL_COLUMNS_COT015
    );

    // ================================================================
    // 매핑 (3) 제조원가 RFC 2 — sys_aimd_cot043 (PR #363/#364/#365 신규)
    //   ※ 047_create_sys_aimd_cot043.sql 스키마 (seq 제외 9 컬럼) 와 정확히 일치.
    //   ※ interface_id: NLP_RFC_003, rfc_name: Z_BI_WEB_EX_BL_5
    //
    //   컬럼 타입 요약 (047 마이그레이션 기준):
    //     CALMONTH        VARCHAR(6)   — SAP NUMC 6  → VARCHAR (앞자리 0 보존)
    //     ZCOSTCOMP       VARCHAR(3)   — SAP NUMC 3  → VARCHAR
    //     ZCOSTCOMP_NM    VARCHAR(40)  — SAP CHAR 40 → VARCHAR
    //     COSTELMNT       VARCHAR(10)  — SAP CHAR 10 → VARCHAR
    //     COSTELMNT_NM    VARCHAR(40)  — SAP CHAR 40 → VARCHAR
    //     COSTCENTER      VARCHAR(10)  — SAP CHAR 10 → VARCHAR
    //     COSTCENTER_NM   VARCHAR(20)  — SAP CHAR 20 → VARCHAR
    //     CURRENCY        VARCHAR(5)   — SAP CUKY 5  → VARCHAR
    //     AMOUNT          BIGINT       — SAP CURR 17,2 → BIGINT (원단위 정수)
    // ================================================================

    /** sys_aimd_cot043 컬럼 목록 (seq 제외, INSERT 순서). 총 9 컬럼. */
    private static final List<String> DB_COLUMNS_COT043 = List.of(
            "CALMONTH",
            "ZCOSTCOMP", "ZCOSTCOMP_NM",
            "COSTELMNT", "COSTELMNT_NM",
            "COSTCENTER", "COSTCENTER_NM",
            "CURRENCY",
            "AMOUNT"
    );

    /**
     * 제조원가 RFC 2 는 SAP 필드명이 그대로 DB 컬럼명과 일치하며 /BIC/ prefix 도
     * 없으므로 별도 이름 매핑이 필요없음. ({@link #normalizeSapFieldName} 의 대문자화만으로 충분)
     */
    private static final Map<String, String> SAP_FIELD_TO_DB_COLUMN_COT043 = Map.of();

    /**
     * 제조원가 RFC 2 소수 유지 컬럼: 없음.
     * AMOUNT 는 BIGINT(원단위 정수) 로 저장하므로 소수 유지 대상이 아님.
     */
    private static final Set<String> DECIMAL_COLUMNS_COT043 = Set.of();

    /** 제조원가 RFC 2 숫자형 컬럼 = AMOUNT (BIGINT). */
    private static final Set<String> NUMERIC_COLUMNS_COT043 = Set.of("AMOUNT");

    /** 제조원가 RFC 2 매핑 인스턴스. */
    static final TableMapping MFG_COST_COT043_MAPPING = new TableMapping(
            "sys_aimd_cot043",
            DB_COLUMNS_COT043,
            SAP_FIELD_TO_DB_COLUMN_COT043,
            NUMERIC_COLUMNS_COT043,
            DECIMAL_COLUMNS_COT043
    );

    // ================================================================
    // 매핑 선택 / SAP 필드명 정규화
    // ================================================================

    /**
     * targetTable 값으로부터 {@link TableMapping} 선택.
     * <p>null/blank 이면 수익성 기본 매핑(=기존 동작) 을 반환하여 후위호환 보장.
     * 알 수 없는 값이면 즉시 예외로 실패시켜 오적재를 원천 차단.</p>
     */
    private static TableMapping resolveMapping(String targetTable) {
        if (targetTable == null || targetTable.isBlank()) {
            return PROFITABILITY_MAPPING;
        }
        switch (targetTable) {
            case "bw_profitability_data": return PROFITABILITY_MAPPING;
            case "sys_aimd_cot015":       return MFG_COST_COT015_MAPPING;
            case "sys_aimd_cot043":       return MFG_COST_COT043_MAPPING;
            default:
                throw new IllegalArgumentException(
                        "지원하지 않는 target_table 입니다: '" + targetTable + "'"
                        + " (허용: bw_profitability_data, sys_aimd_cot015, sys_aimd_cot043)");
        }
    }

    /**
     * SAP RFC 응답 필드명 → DB 컬럼명 후보 정규화.
     * <ol>
     *   <li>매핑 테이블(mapping.sapFieldToDbColumn) 에 명시된 항목은 그 값 사용</li>
     *   <li>없으면 대문자화 후 /BIC/ prefix 제거 (예: /BIC/ZCGUBUN → ZCGUBUN)</li>
     * </ol>
     */
    private static String normalizeSapFieldName(String sapName, TableMapping mapping) {
        if (sapName == null) return null;
        String upper = sapName.toUpperCase(Locale.ROOT);
        String mapped = mapping.sapFieldToDbColumn.get(upper);
        if (mapped != null) return mapped;
        // 옛 이름 그대로 매핑 확인 (수익성 매핑은 옛 이름 → BIC_ 프리픽스)
        String mapped2 = mapping.sapFieldToDbColumn.get(sapName);
        if (mapped2 != null) return mapped2;
        if (upper.startsWith("/BIC/")) return upper.substring(5);
        return upper;
    }

    // ================================================================
    // Public API — 후위호환 오버로드
    // ================================================================

    /** [후위호환] 기존 스케줄러가 호출하는 시그니처. 수익성분석 경로로 실행. */
    @Async("batchTaskExecutor")
    public void executeAsync(Long batchId, String cmonth, String mode, String userId) {
        executeAsync(batchId, cmonth, mode, userId, null, null);
    }

    /**
     * [PR #332] 인터페이스 라우팅 정보를 받는 신규 오버로드.
     * rfcName / targetTable 이 null/blank 이면 수익성분석 기본값 사용.
     */
    @Async("batchTaskExecutor")
    public void executeAsync(Long batchId, String cmonth, String mode, String userId,
                             String rfcName, String targetTable) {
        try {
            TableMapping mapping = resolveMapping(targetTable);
            String actualRfc = (rfcName != null && !rfcName.isBlank())
                    ? rfcName
                    : sapProperties.getRfcFunction();
            log.info("[SAP RFC] 비동기 실행 시작 - batchId={}, cmonth={}, mode={}, rfc={}, table={}",
                    batchId, cmonth, mode, actualRfc, mapping.targetTable);
            execute(batchId, cmonth, mode, actualRfc, mapping);
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
     */
    @Transactional
    public BatchStatus getOrCreateBatchJob(Long jobId, String cmonth, String mode, String userId) {
        return batchStatusRepository.findById(jobId)
                .orElseGet(() -> {
                    log.warn("[Batch] jobId={} 를 찾을 수 없어 새로 생성합니다", jobId);
                    return createBatchJob(cmonth, mode, userId);
                });
    }

    /** [후위호환] 기존 시그니처. 수익성분석 경로로 실행. */
    public void execute(Long batchId, String cmonth, String mode) {
        execute(batchId, cmonth, mode, sapProperties.getRfcFunction(), PROFITABILITY_MAPPING);
    }

    /**
     * 동기화 실행 (신규 시그니처 · PR #332)
     * <p>{@code rfcName} / {@code mapping} 파라미터를 통해 어떤 SAP RFC 를 호출하고
     * 어떤 테이블로 적재할지 결정한다.</p>
     */
    public void execute(Long batchId, String cmonth, String mode, String rfcName, TableMapping mapping) {
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
        appendBatchLog(batchId, String.format("  - RFC 함수: %s   (기본값: %s)",
                rfcName, sapProperties.getRfcFunction()));
        appendBatchLog(batchId, String.format("  - 적재 테이블: %s", mapping.targetTable));
        appendBatchLog(batchId, String.format("  - 입력 파라미터: I_CMONTH=%s", cmonth));

        Instant rfcStart = Instant.now();
        log.info("[SAP RFC] RFC 호출 시작 - cmonth={}, rfc={}, table={}",
                cmonth, rfcName, mapping.targetTable);

        long[] result = callRfcAndInsert(batchId, cmonth, mode, rfcName, mapping);
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
        long afterCount = countExistingData(cmonth, mapping);
        appendBatchLog(batchId, String.format("  - DB 검증: %s CALMONTH=%s 현재 %,d건",
                mapping.targetTable, cmonth, afterCount));

        completeBatch(batchId, totalRows, insertedRows, deletedRows);
    }

    // ================================================================
    // SAP RFC 호출 (매핑 인지 · 스트리밍 INSERT)
    // ================================================================

    /** 스트리밍 INSERT 청크 크기: 5,000행씩 파싱→INSERT 후 GC 해제 */
    private static final int CHUNK_SIZE = 5000;

    /**
     * SAP RFC 호출 + 스트리밍 DB INSERT (메모리 최적화)
     *
     * <p>[PR #332] rfcName / mapping 파라미터를 받아 두 인터페이스를 동일한
     * 실행 코드에서 처리한다.</p>
     *
     * @return long[3] = {totalRows, insertedRows, deletedRows}
     */
    private long[] callRfcAndInsert(Long batchId, String cmonth, String mode,
                                    String rfcName, TableMapping mapping) {
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
            appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 조회 중... (%s)", rfcName));
            Instant step3 = Instant.now();
            Object repository = destination.getClass().getMethod("getRepository").invoke(destination);
            Object function = repository.getClass().getMethod("getFunction", String.class)
                    .invoke(repository, rfcName);
            long step3ms = Duration.between(step3, Instant.now()).toMillis();

            if (function == null) {
                appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 NOT FOUND: %s", rfcName));
                throw new RuntimeException("RFC 함수를 찾을 수 없습니다: " + rfcName);
            }
            appendBatchLog(batchId, String.format("  [RFC-3] RFC 함수 조회 완료 (%dms)", step3ms));

            // ── Step 4: Import 파라미터 설정 + RFC 실행 ──
            Object importParams = function.getClass().getMethod("getImportParameterList").invoke(function);
            importParams.getClass().getMethod("setValue", String.class, String.class)
                    .invoke(importParams, "I_CMONTH", cmonth);

            appendBatchLog(batchId, String.format("  [RFC-4] RFC 실행 중... (%s, I_CMONTH=%s)",
                    rfcName, cmonth));
            log.info("[SAP RFC] {} 호출 (I_CMONTH={})", rfcName, cmonth);

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
            Object metaData = tDataTable.getClass()
                    .getMethod("getRecordMetaData").invoke(tDataTable);
            java.lang.reflect.Method getNameMethod = metaData.getClass()
                    .getMethod("getName", int.class);

            Set<String> dbColumnSet = new HashSet<>(mapping.dbColumns);
            Map<String, Integer> fieldIndexMap = new LinkedHashMap<>();
            for (int j = 0; j < totalFieldCount; j++) {
                String sapName = (String) getNameMethod.invoke(metaData, j);
                String dbName = normalizeSapFieldName(sapName, mapping);
                if (dbColumnSet.contains(dbName)) {
                    fieldIndexMap.put(dbName, j);
                }
            }
            appendBatchLog(batchId, String.format("  [RFC-5] 매핑 필드: %d/%d개 (DB 컬럼 기준, 대상=%s)",
                    fieldIndexMap.size(), totalFieldCount, mapping.targetTable));

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
                appendBatchLog(batchId, String.format("[4/6] REPLACE 모드 — %s 기존 데이터 삭제 중...",
                        mapping.targetTable));
                long existingCount = countExistingData(cmonth, mapping);
                appendBatchLog(batchId, String.format("  - %s CALMONTH=%s 기존 데이터: %,d건",
                        mapping.targetTable, cmonth, existingCount));
                Instant delStart = Instant.now();
                deletedRows = (int) deleteExistingData(cmonth, mapping);
                long delElapsed = Duration.between(delStart, Instant.now()).toSeconds();
                appendBatchLog(batchId, String.format("  - 삭제 완료: %,d건 (%d초 소요)",
                        deletedRows, delElapsed));
                log.info("[SAP RFC] REPLACE 모드 - {} 기존 {}건 삭제 완료 (CALMONTH={})",
                        mapping.targetTable, deletedRows, cmonth);
            } else {
                appendBatchLog(batchId, String.format("[4/6] APPEND 모드 — %s 기존 데이터 유지 (현재 %,d건)",
                        mapping.targetTable, countExistingData(cmonth, mapping)));
            }

            // ── Step 6: 스트리밍 파싱 + INSERT ──
            appendBatchLog(batchId, String.format("[5/6] 스트리밍 INSERT 시작 — %,d행 (청크 %,d행, 배치 1,000건, 대상=%s)",
                    rowCount, CHUNK_SIZE, mapping.targetTable));
            Instant insertStart = Instant.now();

            long totalInserted = 0;
            int batchSize = 1000;
            int totalBatches = (int) Math.ceil((double) rowCount / batchSize);
            List<Object[]> batch = new ArrayList<>(batchSize);

            for (int i = 0; i < rowCount; i++) {
                setRowMethod.invoke(tDataTable, i);

                Object[] values = new Object[mapping.dbColumns.size()];
                for (int c = 0; c < mapping.dbColumns.size(); c++) {
                    String col = mapping.dbColumns.get(c);
                    Integer fieldIdx = fieldIndexMap.get(col);
                    if (fieldIdx == null) {
                        values[c] = mapping.numericColumns.contains(col) ? 0 : null;
                        continue;
                    }
                    String rawValue = (String) getStringMethod.invoke(tDataTable, fieldIdx);
                    if (rawValue == null || rawValue.trim().isEmpty()) {
                        values[c] = mapping.numericColumns.contains(col) ? 0 : null;
                    } else if (mapping.numericColumns.contains(col)) {
                        try {
                            double d = Double.parseDouble(rawValue.replace(",", "").trim());
                            // 소수 유지 컬럼(BIC_ZQTY_* / LBKUM) 은 double, 그 외 숫자(ZAMT*/KST*/TOTAL*) 는 long
                            values[c] = mapping.decimalColumns.contains(col) ? d : (long) d;
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
                        jdbcTemplate.batchUpdate(mapping.insertSql, batch);
                        totalInserted += batch.size();

                        if (currentBatch == 1 || i == rowCount - 1 ||
                                (currentBatch % Math.max(1, totalBatches / 10)) == 0) {
                            double pct = (double) totalInserted / rowCount * 100;
                            String progressMsg = String.format(
                                    "  - INSERT 진행: %,d/%,d (%.0f%%) [배치 %d/%d, 대상=%s]",
                                    totalInserted, rowCount, pct, currentBatch, totalBatches, mapping.targetTable);
                            log.info("[DB] {}", progressMsg);
                            appendBatchLog(batchId, progressMsg);
                        }
                    } catch (Exception e) {
                        String errMsg = String.format(
                                "  - INSERT 실패 (배치 %d/%d, 행 %,d~%,d, 대상=%s): %s",
                                currentBatch, totalBatches,
                                totalInserted + 1, totalInserted + batch.size(),
                                mapping.targetTable, e.getMessage());
                        log.error("[DB] {}", errMsg);
                        appendBatchLog(batchId, errMsg);
                        throw e;
                    }
                    batch.clear();
                }

                if (rowCount > 10000 && i > 0 && i % 10000 == 0) {
                    log.info("[SAP RFC] 스트리밍 진행: {}/{} ({}%)",
                            i, rowCount, (int)((double) i / rowCount * 100));
                }
            }

            long step5ms = Duration.between(step5, Instant.now()).toMillis();
            long insertElapsed = Duration.between(insertStart, Instant.now()).toSeconds();
            appendBatchLog(batchId, String.format("  - 파싱+INSERT 완료: %,d행 (%dms, INSERT %d초)",
                    totalInserted, step5ms, insertElapsed));
            log.info("[SAP RFC] 스트리밍 INSERT 완료: {}건 (대상={})", totalInserted, mapping.targetTable);

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

    private long deleteExistingData(String cmonth, TableMapping mapping) {
        Long existing = jdbcTemplate.queryForObject(mapping.countSql, Long.class, cmonth);
        long count = existing != null ? existing : 0;
        if (count > 0) {
            jdbcTemplate.update(mapping.deleteSql, cmonth);
            log.info("[DB] {} CALMONTH={} 기존 데이터 {}건 삭제", mapping.targetTable, cmonth, count);
        }
        return count;
    }

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
     */
    protected void appendBatchLog(Long batchId, String message) {
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

    /** [후위호환] 수익성 테이블(bw_profitability_data) 기준 카운트. */
    public long countExistingData(String cmonth) {
        return countExistingData(cmonth, PROFITABILITY_MAPPING);
    }

    /**
     * [PR #332] targetTable 문자열로 카운트할 매핑 결정.
     * null/blank 이면 수익성 기본.
     */
    public long countExistingData(String cmonth, String targetTable) {
        return countExistingData(cmonth, resolveMapping(targetTable));
    }

    /** targetTable 인지 카운트 (내부용). */
    public long countExistingData(String cmonth, TableMapping mapping) {
        Long count = jdbcTemplate.queryForObject(mapping.countSql, Long.class, cmonth);
        return count != null ? count : 0;
    }

    /** 월별 데이터 현황 (수익성분석 대시보드 전용 유지). */
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
     */
    public boolean hasRunningBatchExcluding(Long excludeId) {
        return !batchStatusRepository.findRunningBatchesExcluding(excludeId).isEmpty();
    }
}
