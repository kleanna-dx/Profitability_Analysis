package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 경영시뮬레이션 SAP RFC 동기화 서비스.
 *
 * <p>기존 module-profit의 SapRfcSyncService와 동일한 SAP JCo 인프라를 재사용하되,
 * RPSIM 전용 RFC/테이블 매핑을 관리합니다.</p>
 *
 * <h3>지원 RFC:</h3>
 * <ul>
 *   <li>Z_BI_WEB_EX_BL_2 → 2개 테이블: /BIC/OHZOHPP100 (원재료) + /BIC/OHZOHPP101 (부재료)
 *       → rpsim_raw_material (DATA_TYPE '100'/'101'로 구분)</li>
 *   <li>Z_BI_WEB_EX_BL_3 → /BIC/OHZOHCO008 (원부자재 수불부)
 *       → rpsim_raw_inventory</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RpsimSapRfcService {

    @Getter
    private final JdbcTemplate jdbcTemplate;
    private final RpsimItfHistoryRepository histRepo;

    // ================================================================
    // 테이블 매핑 정의
    // ================================================================

    /** 원부재료 (ZOHPP100/101 공통 구조) DB 컬럼 — DATA_TYPE 포함 */
    private static final List<String> DB_COLS_RAW_MATERIAL = List.of(
            "DATA_TYPE", "CALMONTH",
            "ZPROCESS", "ZPROCESS_NM", "ZMACHINE", "ZMACHINE_NM",
            "PRODH1", "PRODH1_NM", "PRODH2", "PRODH2_NM",
            "PRODH3", "PRODH3_NM", "PRODH4", "PRODH4_NM",
            "MATERIAL", "MATERIAL_NM",
            "UNIT", "ZUNIT", "ZPRD_UNIT", "ZSCR_UNIT", "CURRENCY",
            "MATL_GROUP", "MATL_GROUP_NM",
            "ZJPCODE", "ZJPCODE_NM", "ZMATGROUP", "ZMATGROUP_NM",
            "ZPUNIT", "ZREQ_QTY", "ZBASEQTY", "ZTUNIT", "ZRDCD_M01",
            "ZPDTBQTY", "ZTPQTY", "ZPRD_QTY", "ZSCR_QTY",
            "ZLUNIT", "ZDTB_QTY", "ZTPRICE", "ZTRAWMATR",
            "ZZLBKUM60", "ZRAMT_060", "ZTUSEDIF", "ZTPRIDIF"
    );

    /** SAP 필드명 → DB 컬럼명 매핑 (/BIC/ 접두어 제거 후) */
    private static final Map<String, String> SAP_TO_DB_RAW_MATERIAL;
    static {
        Map<String, String> m = new HashMap<>();
        // /BIC/ 접두어 제거 후 매핑
        m.put("ZPROCESS",    "ZPROCESS");
        m.put("ZPROCESS_NM", "ZPROCESS_NM");
        m.put("ZMACHINE",    "ZMACHINE");
        m.put("ZMACHINE_NM", "ZMACHINE_NM");
        m.put("ZUNIT",       "ZUNIT");
        m.put("ZPRD_UNIT",   "ZPRD_UNIT");
        m.put("ZSCR_UNIT",   "ZSCR_UNIT");
        m.put("ZJPCODE",     "ZJPCODE");
        m.put("ZJPCODE_NM",  "ZJPCODE_NM");
        m.put("ZMATGROUP",   "ZMATGROUP");
        m.put("ZMATGROUP_NM","ZMATGROUP_NM");
        m.put("ZPUNIT",      "ZPUNIT");
        m.put("ZREQ_QTY",    "ZREQ_QTY");
        m.put("ZBASEQTY",    "ZBASEQTY");
        m.put("ZTUNIT",      "ZTUNIT");
        m.put("ZRDCD_M01",   "ZRDCD_M01");
        m.put("ZPDTBQTY",    "ZPDTBQTY");
        m.put("ZTPQTY",      "ZTPQTY");
        m.put("ZPRD_QTY",    "ZPRD_QTY");
        m.put("ZSCR_QTY",    "ZSCR_QTY");
        m.put("ZLUNIT",      "ZLUNIT");
        m.put("ZDTB_QTY",    "ZDTB_QTY");
        m.put("ZTPRICE",     "ZTPRICE");
        m.put("ZTRAWMATR",   "ZTRAWMATR");
        m.put("ZZLBKUM60",   "ZZLBKUM60");
        m.put("ZRAMT_060",   "ZRAMT_060");
        m.put("ZTUSEDIF",    "ZTUSEDIF");
        m.put("ZTPRIDIF",    "ZTPRIDIF");
        SAP_TO_DB_RAW_MATERIAL = Collections.unmodifiableMap(m);
    }

    /** 숫자형 컬럼 (QUAN/CURR → DECIMAL 또는 BIGINT) */
    private static final Set<String> DECIMAL_COLS_RAW_MATERIAL = Set.of(
            "ZPUNIT", "ZREQ_QTY", "ZBASEQTY", "ZTUNIT", "ZPDTBQTY",
            "ZTPQTY", "ZPRD_QTY", "ZSCR_QTY", "ZLUNIT", "ZDTB_QTY", "ZZLBKUM60"
    );
    private static final Set<String> BIGINT_COLS_RAW_MATERIAL = Set.of(
            "ZRDCD_M01", "ZTPRICE", "ZTRAWMATR", "ZRAMT_060", "ZTUSEDIF", "ZTPRIDIF"
    );

    /** 원부자재 수불부 DB 컬럼 */
    private static final List<String> DB_COLS_RAW_INVENTORY = List.of(
            "CALMONTH", "PLANT", "PLANT_NM",
            "MATL_GROUP", "MATL_GROUP_NM", "ZMATGROUP", "ZMATGROUP_NM",
            "MATL_TYPE", "MATL_TYPE_NM", "MATERIAL", "MATERIAL_NM",
            "CURRENCY", "BASE_UOM",
            "ZLBKUM", "ZRNETPR", "ZLBKUM020", "ZRNETPR20",
            "ZLBKUM60", "ZRNETPR60", "ZLBKUM101", "ZRNETP110"
    );

    private static final Set<String> DECIMAL_COLS_RAW_INVENTORY = Set.of(
            "ZLBKUM", "ZLBKUM020", "ZLBKUM60", "ZLBKUM101"
    );
    private static final Set<String> BIGINT_COLS_RAW_INVENTORY = Set.of(
            "ZRNETPR", "ZRNETPR20", "ZRNETPR60", "ZRNETP110"
    );

    // ================================================================
    // 실행 API
    // ================================================================

    /**
     * Z_BI_WEB_EX_BL_2 실행: T_DATA 테이블에서 원재료+부재료 수신
     * → rpsim_raw_material 에 DATA_TYPE 구분하여 INSERT
     *
     * <p>SAP RFC는 1번 호출, T_DATA에 원재료+부재료가 함께 들어옴.
     * DATA_TYPE은 SAP 개발자가 T_DATA에 구분 컬럼을 넣어줬으면 그걸 사용하고,
     * 없으면 모두 '100'(원재료)으로 저장.</p>
     */
    public Map<String, Object> executeRawMaterial(String cmonth, String mode, String executedBy) {
        log.info("[RPSIM RFC] Z_BI_WEB_EX_BL_2 실행 — cmonth={}, mode={}", cmonth, mode);

        RpsimItfHistory hist = createHistory("RPSIM_ITF_011", "원부재료 사용현황 (RFC)", executedBy);

        try {
            // replace 모드: 기존 데이터 삭제
            int deleted = 0;
            if ("replace".equals(mode)) {
                deleted = jdbcTemplate.update("DELETE FROM rpsim_raw_material WHERE CALMONTH = ?", cmonth);
                log.info("[RPSIM RFC] rpsim_raw_material CALMONTH={} 기존 {}건 삭제", cmonth, deleted);
            }

            // SAP RFC 1번 호출 → T_DATA 테이블에서 데이터 수신
            int totalInserted = callRfcAndInsertMaterial("Z_BI_WEB_EX_BL_2", "T_DATA", cmonth, "100");
            log.info("[RPSIM RFC] T_DATA: 총 {}건 INSERT", totalInserted);

            completeHistory(hist, "success", totalInserted, null);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("rfcName", "Z_BI_WEB_EX_BL_2");
            result.put("cmonth", cmonth);
            result.put("totalInserted", totalInserted);
            result.put("deleted", deleted);
            result.put("historyId", hist.getHistoryId());
            return result;

        } catch (Exception e) {
            String detail = e.getMessage();
            if (e.getCause() != null) detail += " | Cause: " + e.getCause().getMessage();
            completeHistory(hist, "failed", 0, detail);
            throw new RuntimeException("RFC 실행 실패: " + detail, e);
        }
    }

    /**
     * Z_BI_WEB_EX_BL_3 실행: T_DATA 테이블에서 원부자재 수불부 수신
     * → rpsim_raw_inventory 에 INSERT
     */
    public Map<String, Object> executeRawInventory(String cmonth, String mode, String executedBy) {
        log.info("[RPSIM RFC] Z_BI_WEB_EX_BL_3 실행 — cmonth={}, mode={}", cmonth, mode);

        RpsimItfHistory hist = createHistory("RPSIM_ITF_012", "원부자재 수불부 (RFC)", executedBy);

        try {
            int deleted = 0;
            if ("replace".equals(mode)) {
                deleted = jdbcTemplate.update("DELETE FROM rpsim_raw_inventory WHERE CALMONTH = ?", cmonth);
                log.info("[RPSIM RFC] rpsim_raw_inventory CALMONTH={} 기존 {}건 삭제", cmonth, deleted);
            }

            int totalInserted = callRfcAndInsertInventory("Z_BI_WEB_EX_BL_3", "T_DATA", cmonth);
            log.info("[RPSIM RFC] T_DATA (수불부): {}건 INSERT", totalInserted);

            completeHistory(hist, "success", totalInserted, null);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("rfcName", "Z_BI_WEB_EX_BL_3");
            result.put("cmonth", cmonth);
            result.put("totalInserted", totalInserted);
            result.put("deleted", deleted);
            result.put("historyId", hist.getHistoryId());
            return result;

        } catch (Exception e) {
            String detail = e.getMessage();
            if (e.getCause() != null) detail += " | Cause: " + e.getCause().getMessage();
            completeHistory(hist, "failed", 0, detail);
            throw new RuntimeException("RFC 실행 실패: " + detail, e);
        }
    }

    // ================================================================
    // SAP JCo 리플렉션 호출 (module-profit과 동일 패턴)
    // ================================================================

    private int callRfcAndInsertMaterial(String rfcName, String tableName, String cmonth, String dataType) {
        try {
            Object tDataTable = callSapRfc(rfcName, tableName, cmonth);
            if (tDataTable == null) return 0;

            int rowCount = (int) tDataTable.getClass().getMethod("getNumRows").invoke(tDataTable);
            if (rowCount == 0) return 0;

            // 필드 매핑
            Map<String, Integer> fieldMap = buildFieldIndexMap(tDataTable, DB_COLS_RAW_MATERIAL, SAP_TO_DB_RAW_MATERIAL);

            // INSERT SQL
            String cols = String.join(", ", DB_COLS_RAW_MATERIAL);
            String ph = String.join(", ", Collections.nCopies(DB_COLS_RAW_MATERIAL.size(), "?"));
            String insertSql = "INSERT INTO rpsim_raw_material (" + cols + ") VALUES (" + ph + ")";

            java.lang.reflect.Method getStr = tDataTable.getClass().getMethod("getString", int.class);
            java.lang.reflect.Method setRow = tDataTable.getClass().getMethod("setRow", int.class);

            List<Object[]> batch = new ArrayList<>(1000);
            int inserted = 0;
            Set<String> numericAll = new HashSet<>(DECIMAL_COLS_RAW_MATERIAL);
            numericAll.addAll(BIGINT_COLS_RAW_MATERIAL);

            for (int i = 0; i < rowCount; i++) {
                setRow.invoke(tDataTable, i);
                Object[] values = new Object[DB_COLS_RAW_MATERIAL.size()];

                for (int c = 0; c < DB_COLS_RAW_MATERIAL.size(); c++) {
                    String col = DB_COLS_RAW_MATERIAL.get(c);
                    if ("DATA_TYPE".equals(col)) {
                        values[c] = dataType;
                        continue;
                    }
                    Integer idx = fieldMap.get(col);
                    if (idx == null) {
                        values[c] = numericAll.contains(col) ? 0 : null;
                        continue;
                    }
                    String raw = (String) getStr.invoke(tDataTable, idx);
                    values[c] = parseValue(raw, col, DECIMAL_COLS_RAW_MATERIAL, BIGINT_COLS_RAW_MATERIAL);
                }
                batch.add(values);

                if (batch.size() >= 1000 || i == rowCount - 1) {
                    jdbcTemplate.batchUpdate(insertSql, batch);
                    inserted += batch.size();
                    batch.clear();
                }
            }
            return inserted;

        } catch (Exception e) {
            log.error("[RPSIM RFC] {} {} 처리 실패: {}", rfcName, tableName, e.getMessage());
            throw new RuntimeException(e);
        }
    }

    private int callRfcAndInsertInventory(String rfcName, String tableName, String cmonth) {
        try {
            Object tDataTable = callSapRfc(rfcName, tableName, cmonth);
            if (tDataTable == null) return 0;

            int rowCount = (int) tDataTable.getClass().getMethod("getNumRows").invoke(tDataTable);
            if (rowCount == 0) return 0;

            Map<String, Integer> fieldMap = buildFieldIndexMap(tDataTable, DB_COLS_RAW_INVENTORY, Map.of());

            String cols = String.join(", ", DB_COLS_RAW_INVENTORY);
            String ph = String.join(", ", Collections.nCopies(DB_COLS_RAW_INVENTORY.size(), "?"));
            String insertSql = "INSERT INTO rpsim_raw_inventory (" + cols + ") VALUES (" + ph + ")";

            java.lang.reflect.Method getStr = tDataTable.getClass().getMethod("getString", int.class);
            java.lang.reflect.Method setRow = tDataTable.getClass().getMethod("setRow", int.class);

            Set<String> numericAll = new HashSet<>(DECIMAL_COLS_RAW_INVENTORY);
            numericAll.addAll(BIGINT_COLS_RAW_INVENTORY);

            List<Object[]> batch = new ArrayList<>(1000);
            int inserted = 0;

            for (int i = 0; i < rowCount; i++) {
                setRow.invoke(tDataTable, i);
                Object[] values = new Object[DB_COLS_RAW_INVENTORY.size()];

                for (int c = 0; c < DB_COLS_RAW_INVENTORY.size(); c++) {
                    String col = DB_COLS_RAW_INVENTORY.get(c);
                    Integer idx = fieldMap.get(col);
                    if (idx == null) {
                        values[c] = numericAll.contains(col) ? 0 : null;
                        continue;
                    }
                    String raw = (String) getStr.invoke(tDataTable, idx);
                    values[c] = parseValue(raw, col, DECIMAL_COLS_RAW_INVENTORY, BIGINT_COLS_RAW_INVENTORY);
                }
                batch.add(values);

                if (batch.size() >= 1000 || i == rowCount - 1) {
                    jdbcTemplate.batchUpdate(insertSql, batch);
                    inserted += batch.size();
                    batch.clear();
                }
            }
            return inserted;

        } catch (Exception e) {
            log.error("[RPSIM RFC] {} {} 처리 실패: {}", rfcName, tableName, e.getMessage());
            throw new RuntimeException(e);
        }
    }

    // ================================================================
    // SAP JCo 공통 헬퍼
    // ================================================================

    /**
     * SAP RFC 호출 → 지정 테이블 반환 (JCo 리플렉션)
     */
    private Object callSapRfc(String rfcName, String tableName, String cmonth) throws Exception {
        Class<?> destMgrClass = Class.forName("com.sap.conn.jco.JCoDestinationManager");
        Object destination = destMgrClass.getMethod("getDestination", String.class)
                .invoke(null, "SAP_BWP");  // SapRfcDestinationProvider.DESTINATION_NAME

        Object repository = destination.getClass().getMethod("getRepository").invoke(destination);
        Object function = repository.getClass().getMethod("getFunction", String.class)
                .invoke(repository, rfcName);

        if (function == null) throw new RuntimeException("RFC 함수를 찾을 수 없습니다: " + rfcName);

        // Import 파라미터 설정
        Object importParams = function.getClass().getMethod("getImportParameterList").invoke(function);
        importParams.getClass().getMethod("setValue", String.class, String.class)
                .invoke(importParams, "I_CMONTH", cmonth);

        // RFC 실행
        Instant start = Instant.now();
        function.getClass().getMethod("execute", destination.getClass().getInterfaces()[0])
                .invoke(function, destination);
        log.info("[RPSIM RFC] {} 실행 완료 ({}ms)", rfcName,
                Duration.between(start, Instant.now()).toMillis());

        // 테이블 파라미터에서 지정 테이블 추출
        Object tableParams = function.getClass().getMethod("getTableParameterList").invoke(function);
        return tableParams.getClass().getMethod("getTable", String.class).invoke(tableParams, tableName);
    }

    /**
     * SAP 테이블 필드 → DB 컬럼 인덱스 매핑 구축
     */
    private Map<String, Integer> buildFieldIndexMap(Object table, List<String> dbCols,
                                                     Map<String, String> sapToDb) throws Exception {
        Object metaData = table.getClass().getMethod("getRecordMetaData").invoke(table);
        int fieldCount = (int) metaData.getClass().getMethod("getFieldCount").invoke(metaData);
        java.lang.reflect.Method getName = metaData.getClass().getMethod("getName", int.class);

        Set<String> dbColSet = new HashSet<>(dbCols);
        Map<String, Integer> map = new LinkedHashMap<>();

        for (int j = 0; j < fieldCount; j++) {
            String sapName = (String) getName.invoke(metaData, j);
            String normalized = normalizeSapField(sapName, sapToDb);
            if (dbColSet.contains(normalized)) {
                map.put(normalized, j);
            }
        }
        return map;
    }

    /** SAP 필드명 정규화: /BIC/ 또는 BIC_ 접두어 제거 + 매핑 테이블 적용 */
    private String normalizeSapField(String sapName, Map<String, String> sapToDb) {
        if (sapName == null) return null;
        String upper = sapName.toUpperCase(Locale.ROOT);
        if (upper.startsWith("/BIC/")) upper = upper.substring(5);       // /BIC/ZPROCESS → ZPROCESS
        else if (upper.startsWith("BIC_")) upper = upper.substring(4);   // BIC_ZPROCESS → ZPROCESS
        String mapped = sapToDb.get(upper);
        return mapped != null ? mapped : upper;
    }

    /** 문자열 → Java 값 변환 */
    private Object parseValue(String raw, String col, Set<String> decimalCols, Set<String> bigintCols) {
        if (raw == null || raw.trim().isEmpty()) {
            if (decimalCols.contains(col) || bigintCols.contains(col)) return 0;
            return null;
        }
        raw = raw.trim();
        if (decimalCols.contains(col)) {
            try { return Double.parseDouble(raw.replace(",", "")); }
            catch (NumberFormatException e) { return 0.0; }
        }
        if (bigintCols.contains(col)) {
            try { return (long) Double.parseDouble(raw.replace(",", "")); }
            catch (NumberFormatException e) { return 0L; }
        }
        return raw;
    }

    // ================================================================
    // 이력 헬퍼
    // ================================================================

    private RpsimItfHistory createHistory(String interfaceId, String interfaceName, String executedBy) {
        RpsimItfHistory h = RpsimItfHistory.builder()
                .interfaceId(interfaceId).interfaceName(interfaceName)
                .jobType("SAP_RFC_SYNC").execMode("replace").status("running")
                .startedAt(LocalDateTime.now()).executedBy(executedBy)
                .build();
        return histRepo.save(h);
    }

    private void completeHistory(RpsimItfHistory h, String status, int processCount, String errorMessage) {
        LocalDateTime now = LocalDateTime.now();
        int durationMs = h.getStartedAt() != null
                ? (int) Duration.between(h.getStartedAt(), now).toMillis() : 0;
        h.complete(status, now, durationMs, processCount, errorMessage);
        histRepo.save(h);
    }
}
