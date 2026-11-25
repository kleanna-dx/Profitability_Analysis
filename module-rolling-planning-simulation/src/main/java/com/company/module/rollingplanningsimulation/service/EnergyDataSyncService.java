package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;

import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import com.company.module.rollingplanningsimulation.entity.SteamPriceInterval;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import com.company.module.rollingplanningsimulation.repository.BoilerCostRateRepository;
import com.company.module.rollingplanningsimulation.repository.SteamPriceIntervalRepository;
import com.company.module.rollingplanningsimulation.repository.SteamUnitRateRepository;
import com.company.module.rollingplanningsimulation.repository.UnitRepository;
import com.company.module.rollingplanningsimulation.repository.PwSimBasisVersionRepository;
import com.company.module.rollingplanningsimulation.repository.PwSimBasisLineRepository;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;

/**
 * 에너지팀 시스템(aiplatform.steam_cell_value)에서 단가/원단위 데이터를 수신하여
 * RPSIM 기준정보 테이블에 동기화하는 서비스.
 *
 * <p>물리 테이블: aiplatform.steam_cell_value (공용 셀 저장소)</p>
 * <p>유니크 키: (month, table_name, row_key, col_index)</p>
 * <p>cell_value는 문자열 → 숫자 캐스팅 필요</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EnergyDataSyncService {

    @Getter private final JdbcTemplate jdbcTemplate;

    /** 에너지팀 셀 테이블 위치 직접 지정 (예: aiplatform.steam_cell_value). 비우면 자동으로 찾음 */
    @org.springframework.beans.factory.annotation.Value("${rpsim.energy.cell-table:}")
    private String cellTableOverride;
    private volatile String cellTableResolved;
    private final BoilerCostRateRepository boilerCostRateRepo;
    private final SteamPriceIntervalRepository steamPriceIntervalRepo;
    private final SteamUnitRateRepository steamUnitRateRepo;
    private final AuditSupport auditSupport;
    private final UnitRepository unitRepo;
    private final PwSimBasisVersionRepository pwVersionRepo;
    private final PwSimBasisLineRepository pwLineRepo;

    /** 마지막 원단위 수신의 호기 연결 결과·경고 (화면 표시용) */
    @Getter private final List<String> lastUnitRateNotes = Collections.synchronizedList(new ArrayList<>());

    // ================================================================
    // row_key → RPSIM 매핑 정의
    // ================================================================

    private static final String[] INTERVAL_UK = {"contractYear", "month", "boilerCode", "intervalSeq", "division"};

    /**
     * 사업부별 수신 매핑 — 에너지팀 대시보드(steam_cell_value)에는 사업부 구분이 없고 row_key 로만 구분되므로
     * 어떤 row_key 를 어느 사업부의 어떤 보일러/호기로 받을지 사업부마다 따로 정의한다.
     * 매핑이 없는 사업부는 수신하지 않는다 (다른 사업부 값이 섞여 저장되는 것 방지).
     */
    private static final class DivisionMapping {
        /** 단가 row_key → [boilerCode, rateType, rateName, rateUnit] */
        final Map<String, String[]> price = new LinkedHashMap<>();
        /** 복합보일러 구간단가(comb_asc/comb_bsc/보증량/FACTOR) 수신 여부 */
        boolean cogenInterval;
        /** 원단위 row_key → machineCode */
        final Map<String, String> unitRate = new LinkedHashMap<>();
        /** 원단위 조회 row_key 접두어 (예: t17|) */
        String unitRatePrefix;
    }

    /**
     * 보일러 단가 = 공장 공통(PLANT). 사업부를 골라 수신해도 PLANT 로 저장 (보일러는 PS·HL 이 함께 씀)
     * 원단위(t17) = 행마다 엑셀 호기명 → 호기 마스터/전력 기준정보 호기명으로 호기코드·사업부를 찾아 저장 (PS·HL 한 번에)
     */
    private static final DivisionMapping PLANT_MAPPING = new DivisionMapping();
    /** t17 row_key → 대시보드 호기명. 소계 행(r03 제지 소계, r07 화장지 소계)은 받지 않음 */
    static final Map<String, String> T17_ROWS = new LinkedHashMap<>();
    static {
        PLANT_MAPPING.price.put("lng_unit",        new String[]{"BLR-LNG",   "FUEL_RATE",  "LNG 단가",         "원/㎥"});
        PLANT_MAPPING.price.put("waste2_steam",    new String[]{"BLR-INCIN", "STEAM_RATE", "폐합성2호 스팀단가", "원/톤"});
        PLANT_MAPPING.price.put("waste2_fixed_hr", new String[]{"BLR-INCIN", "FIXED_HR",   "폐합성2호 고정단가", "원/HR"});
        PLANT_MAPPING.price.put("fluid_steam",     new String[]{"BLR-FLUID", "STEAM_RATE", "유동상 스팀단가",    "원/톤"});
        PLANT_MAPPING.price.put("fluid_fixed_hr",  new String[]{"BLR-FLUID", "FIXED_HR",   "유동상 고정단가",    "원/HR"});
        PLANT_MAPPING.cogenInterval = true;
        PLANT_MAPPING.unitRatePrefix = "t17|";
        T17_ROWS.put("t17|r01", "제지2");
        T17_ROWS.put("t17|r02", "제지3");
        T17_ROWS.put("t17|r04", "화장지3");
        T17_ROWS.put("t17|r05", "화장지4");
        T17_ROWS.put("t17|r06", "화장지5");
    }
    public static final String PLANT = "PLANT";

    private static DivisionMapping mappingOf(String division) { return PLANT_MAPPING; }

    /** 수신 가능한 사업부인지 */
    public static boolean isSupported(String division) {
        return division != null && List.of("PS", "HL", PLANT).contains(division.trim().toUpperCase());
    }


    // ================================================================
    // 에너지팀 셀 테이블(steam_cell_value) 위치 — 스키마를 고정하지 않고 찾음
    // ================================================================
    static final java.util.regex.Pattern TABLE_NAME = java.util.regex.Pattern.compile("^[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)?$");

    static String validTable(String t) {
        if (t == null || !TABLE_NAME.matcher(t.trim()).matches())
            throw new IllegalArgumentException("rpsim.energy.cell-table 값이 올바르지 않습니다 (예: aiplatform.steam_cell_value): " + t);
        return t.trim();
    }

    /**
     * 1) 설정값 rpsim.energy.cell-table  2) 이 DB 계정에서 보이는 steam_cell_value — 현재 DB → aiplatform → 그 외 순서.
     * 찾은 위치는 기억해 두고, 못 찾으면 원인과 확인 방법을 담아 오류
     */
    public String cellTable() {
        if (cellTableOverride != null && !cellTableOverride.isBlank()) return validTable(cellTableOverride);
        String c = cellTableResolved;
        if (c != null) return c;
        List<String> schemas = jdbcTemplate.queryForList(
                "SELECT TABLE_SCHEMA FROM information_schema.TABLES WHERE TABLE_NAME = 'steam_cell_value' " +
                "ORDER BY (TABLE_SCHEMA = DATABASE()) DESC, (TABLE_SCHEMA = 'aiplatform') DESC, TABLE_SCHEMA", String.class);
        if (schemas.isEmpty())
            throw new IllegalStateException("에너지팀 테이블 steam_cell_value 를 찾지 못했습니다 — 이 서버 DB 계정에서 보이는 스키마에 없습니다. "
                    + "에너지팀 테이블이 같은 DB 서버에 있는지, 이 계정에 SELECT 권한이 있는지 확인하세요. "
                    + "위치를 알면 application.yml 에 rpsim.energy.cell-table: 스키마.steam_cell_value 로 지정할 수 있습니다");
        if (schemas.size() > 1) log.warn("[EnergySync] steam_cell_value 가 여러 스키마에 있습니다 {} — {} 사용", schemas, schemas.get(0));
        c = validTable(schemas.get(0) + ".steam_cell_value");
        log.info("[EnergySync] 에너지팀 셀 테이블 = {}", c);
        cellTableResolved = c;
        return c;
    }

    // ================================================================
    // 1. 단가 수신 (unit_price_detail → boiler_cost_rate + steam_price_interval)
    // ================================================================

    /**
     * 에너지팀 단가 데이터 수신.
     * @param year 연도 (예: 2026)
     * @param division 사업부 (예: PS)
     * @return 처리 건수
     */
    @Transactional
    public int syncPriceData(int year, String division) {
        DivisionMapping mp = mappingOf(division);
        String yearStr = String.valueOf(year);
        log.info("[EnergySync] 단가 수신 시작 — year={}, division={}", year, division);

        // 1) aiplatform.steam_cell_value에서 unit_price_detail 조회
        String sql = "SELECT row_key, col_index AS mon, CAST(cell_value AS DECIMAL(18,4)) AS val " +
                     "FROM " + cellTable() + " " +
                     "WHERE table_name = 'unit_price_detail' AND month = ? " +
                     "AND col_index BETWEEN 1 AND 12";

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, yearStr);
        log.info("[EnergySync] unit_price_detail 조회 결과: {}건", rows.size());

        if (rows.isEmpty()) return 0;

        // 2) row_key별로 그룹핑: {row_key: {month: value}}
        Map<String, Map<Integer, BigDecimal>> dataMap = new HashMap<>();
        for (Map<String, Object> row : rows) {
            String rowKey = (String) row.get("row_key");
            int mon = ((Number) row.get("mon")).intValue();
            BigDecimal val = row.get("val") != null ? new BigDecimal(row.get("val").toString()) : BigDecimal.ZERO;
            dataMap.computeIfAbsent(rowKey, k -> new HashMap<>()).put(mon, val);
        }

        int count = 0;

        // 3) 일반 단가 매핑 → boiler_cost_rate에 월별 INSERT
        for (Map.Entry<String, String[]> entry : mp.price.entrySet()) {
            String rowKey = entry.getKey();
            String[] mapping = entry.getValue();
            String boilerCode = mapping[0], rateType = mapping[1], rateName = mapping[2], rateUnit = mapping[3];

            Map<Integer, BigDecimal> monthData = dataMap.get(rowKey);
            if (monthData == null) continue;

            for (Map.Entry<Integer, BigDecimal> me : monthData.entrySet()) {
                int mon = me.getKey();
                BigDecimal val = me.getValue();
                if (val == null || val.compareTo(BigDecimal.ZERO) == 0) continue;

                // 기존 데이터 삭제 후 INSERT (같은 year/month/boilerCode/rateType)
                saveOrUpdateCostRate(year, mon, boilerCode, rateType, rateName, val, rateUnit, null, PLANT);
                count++;
            }
        }

        // 4) 복합보일러 구간단가 (BSC/ASC·보증량·FACTOR) — 해당 사업부 매핑에 있을 때만
        if (mp.cogenInterval) count += syncIntervalPrices(dataMap, year, PLANT);

        log.info("[EnergySync] 단가 수신 완료 — {}건 처리", count);
        return count;
    }

    /**
     * 복합보일러 BSC/ASC 구간단가 → steam_price_interval 동기화.
     */
    private int syncIntervalPrices(Map<String, Map<Integer, BigDecimal>> dataMap, int year, String division) {
        Map<Integer, BigDecimal> bscData = dataMap.get("comb_bsc");
        Map<Integer, BigDecimal> ascData = dataMap.get("comb_asc");
        Map<Integer, BigDecimal> guaranteeData = dataMap.get("comb_bsc_guarantee");
        Map<Integer, BigDecimal> bscFactorData = dataMap.get("comb_bsc_factor");
        Map<Integer, BigDecimal> ascFactorData = dataMap.get("comb_asc_factor");

        if (bscData == null && ascData == null) return 0;

        // 기존 행은 지우지 않고 UK(계약연도+월+보일러+순번+사업부) 기준으로 덮어씀 (삭제된 행이면 되살림)
        String yearStr = String.valueOf(year);

        int count = 0;
        // 각 월의 BSC/ASC 단가·FACTOR·보증량을 boiler_cost_rate(월별)와 steam_price_interval(월별)에 저장

        Set<Integer> allMonths = new HashSet<>();
        if (bscData != null) allMonths.addAll(bscData.keySet());
        if (ascData != null) allMonths.addAll(ascData.keySet());

        for (int mon : allMonths) {
            BigDecimal bscPrice = bscData != null ? bscData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal ascPrice = ascData != null ? ascData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal guarantee = guaranteeData != null ? guaranteeData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal bscFactor = bscFactorData != null ? bscFactorData.getOrDefault(mon, BigDecimal.ONE) : BigDecimal.ONE;
            BigDecimal ascFactor = ascFactorData != null ? ascFactorData.getOrDefault(mon, BigDecimal.ONE) : BigDecimal.ONE;

            // boiler_cost_rate에 INTERVAL 타입으로 BSC/ASC 월별 저장
            if (bscPrice.compareTo(BigDecimal.ZERO) > 0) {
                saveOrUpdateCostRate(year, mon, "BLR-COGEN", "INTERVAL", "복합보일러 BSC 기본단가(보증량까지)",
                        bscPrice, "원/톤", bscFactor, division);
                count++;
            }
            // ASC 초과단가는 별도 rateType 으로 저장 (INTERVAL_ASC)
            if (ascPrice.compareTo(BigDecimal.ZERO) > 0) {
                saveOrUpdateCostRate(year, mon, "BLR-COGEN", "INTERVAL_ASC", "복합보일러 ASC 초과단가(보증량 초과)",
                        ascPrice, "원/톤", ascFactor, division);
                count++;
            }
            // BSC 보증량도 저장
            if (guarantee.compareTo(BigDecimal.ZERO) > 0) {
                saveOrUpdateCostRate(year, mon, "BLR-COGEN", "BSC_GUARANTEE", "BSC 보증량",
                        guarantee, "톤", null, division);
                count++;
            }
        }

        // steam_price_interval 월별 저장 — 보증량은 해당 월 값만 사용 (다른 월 값으로 대체하지 않음)

        for (int mon : new TreeSet<>(allMonths)) {
            BigDecimal bsc = bscData != null ? bscData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal asc = ascData != null ? ascData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal g = guaranteeData != null ? guaranteeData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            boolean hasG = g != null && g.compareTo(BigDecimal.ZERO) > 0;

            // 기본구간(0~보증량) = BSC 기본단가 / 초과구간(보증량 초과) = ASC 초과단가
            if (bsc.compareTo(BigDecimal.ZERO) > 0) {
                SteamPriceInterval bscInterval = SteamPriceInterval.builder()
                        .contractYear(yearStr).month(mon).boilerCode("BLR-COGEN").intervalSeq(1)
                        .intervalName("기본구간 (BSC)")
                        .minUsageTon(BigDecimal.ZERO).maxUsageTon(hasG ? g : null)
                        .pricePerTon(bsc).division(division).memo("에너지팀 자동수신")
                        .build();
                bscInterval.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamPriceIntervalRepo, bscInterval, INTERVAL_UK);
                count++;
            }
            if (asc.compareTo(BigDecimal.ZERO) > 0 && hasG) {
                SteamPriceInterval ascInterval = SteamPriceInterval.builder()
                        .contractYear(yearStr).month(mon).boilerCode("BLR-COGEN").intervalSeq(2)
                        .intervalName("초과구간 (ASC)")
                        .minUsageTon(g).maxUsageTon(null)
                        .pricePerTon(asc).division(division).memo("에너지팀 자동수신")
                        .build();
                ascInterval.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamPriceIntervalRepo, ascInterval, INTERVAL_UK);
                count++;
            }
        }

        return count;
    }

    // ================================================================
    // 2. 원단위 수신 (energy_fuel_ratio → steam_unit_rate)
    // ================================================================

    /**
     * 에너지팀 스팀사용 원단위 데이터 수신.
     * @param year 연도 (예: 2026)
     * @param division 사업부 (예: PS)
     * @return 처리 건수
     */
    @Transactional
    public int syncUnitRateData(int year, String division) {
        String yearStr = String.valueOf(year);
        log.info("[EnergySync] 원단위 수신 시작 — year={} (PS·HL 호기 자동 연결)", year);
        lastUnitRateNotes.clear();

        // aiplatform.steam_cell_value energy_fuel_ratio t17 (기타 스팀량 포함). col_index: 2=1월 ~ 13=12월
        String sql = "SELECT row_key, col_index - 1 AS mon, CAST(cell_value AS DECIMAL(8,4)) AS val " +
                     "FROM " + cellTable() + " " +
                     "WHERE table_name = 'energy_fuel_ratio' AND month = ? " +
                     "AND row_key LIKE 't17|%' AND col_index BETWEEN 2 AND 13";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, yearStr);
        log.info("[EnergySync] energy_fuel_ratio t17 조회 결과: {}건", rows.size());
        if (rows.isEmpty()) { lastUnitRateNotes.add(year + "년 에너지팀 t17 원단위가 없습니다 (연료비 배분비율 페이지가 저장된 적이 없을 수 있음)"); return 0; }

        // 대시보드 호기명 → 호기 마스터 (호기명/코드 이름 비교 + 전력 기준정보 엑셀 호기명)
        Map<String, String[]> match = new LinkedHashMap<>();   // row_key → {machineCode, division}
        List<String> unmatched = new ArrayList<>();
        for (Map.Entry<String, String> e : T17_ROWS.entrySet()) {
            String[] m = matchUnit(e.getValue());
            if (m == null) unmatched.add(e.getValue());
            else { match.put(e.getKey(), m); lastUnitRateNotes.add(e.getValue() + " → " + m[1] + " " + m[0]); }
        }
        if (!unmatched.isEmpty())
            lastUnitRateNotes.add("호기 마스터와 연결되지 않아 받지 않은 행: " + String.join(", ", unmatched)
                    + " — [기준정보 › 호기 마스터]의 호기명을 대시보드 이름(예: 화장지3)과 같게 하거나, 전력비 엑셀 가져오기로 연결하세요");

        int count = 0;
        for (Map<String, Object> row : rows) {
            String rowKey = (String) row.get("row_key");
            String[] m = match.get(rowKey);
            if (m == null) continue;   // 소계 행·미연결 행
            int mon = ((Number) row.get("mon")).intValue();
            BigDecimal val = row.get("val") != null ? new BigDecimal(row.get("val").toString()) : BigDecimal.ZERO;
            if (val.compareTo(BigDecimal.ZERO) == 0) continue;   // 빈 달은 저장하지 않음 (0으로 덮어쓰지 않음)
            String machineCode = m[0], div = m[1];
            SteamUnitRate found = steamUnitRateRepo.findByYearAndMonthAndDivision(year, mon, div).stream()
                    .filter(x -> machineCode.equalsIgnoreCase(x.getMachineCode())).findFirst().orElse(null);
            if (found != null) {
                found.update(val, found.getEtcUsageTon(), found.getLimitNote(), "에너지팀 자동수신 (t17 " + T17_ROWS.get(rowKey) + ")");
                steamUnitRateRepo.save(found);
            } else {
                SteamUnitRate newRate = SteamUnitRate.builder()
                        .year(year).month(mon).machineCode(machineCode).division(div).steamPerTon(val)
                        .memo("에너지팀 자동수신 (t17 " + T17_ROWS.get(rowKey) + ")")
                        .build();
                newRate.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamUnitRateRepo, newRate, "year", "month", "machineCode", "division");
            }
            count++;
        }
        log.info("[EnergySync] 원단위 수신 완료 — {}건 처리 / 연결 {}", count, lastUnitRateNotes);
        return count;
    }

    static String norm(String v) { return v == null ? "" : v.replaceAll("\\s+", "").replace("호기", "").toLowerCase(Locale.ROOT); }

    /**
     * 대시보드 호기명(제지2, 화장지3 …) → {호기코드, 사업부}.
     * 1) 호기 마스터 호기명/코드가 같은 호기  2) 전력 기준정보(엑셀 가져오기)의 엑셀 호기명이 같은 호기의 호기코드
     */
    String[] matchUnit(String name) {
        String k = norm(name);
        List<com.company.module.rollingplanningsimulation.entity.Unit> units = unitRepo.findByDeletedYnOrderByDivisionAscUnitCodeAsc("N");
        for (var u : units) if (!Boolean.FALSE.equals(u.getIsActive()) && (k.equals(norm(u.getUnitName())) || k.equals(norm(u.getUnitCode()))))
            return new String[]{u.getUnitCode(), u.getDivision()};
        for (String dv : List.of("PS", "HL")) {
            for (var v : pwVersionRepo.findByDivisionOrderByVersionIdDesc(dv)) {
                for (var l : pwLineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(v.getVersionId()))
                    if (k.equals(norm(l.getLineName())))
                        for (var u : units) if (u.getUnitCode().equalsIgnoreCase(l.getLineCode())) return new String[]{u.getUnitCode(), u.getDivision()};
            }
        }
        // 3) 기존 고정 연결 (제지2 → PM2, 제지3 → PM3) — 호기 마스터에 그 코드가 있을 때만
        String legacy = LEGACY_CODE.get(name);
        if (legacy != null) for (var u : units) if (u.getUnitCode().equalsIgnoreCase(legacy)) return new String[]{u.getUnitCode(), u.getDivision()};
        return null;
    }
    static final Map<String, String> LEGACY_CODE = Map.of("제지2", "PM2", "제지3", "PM3");

    // ================================================================
    // 헬퍼: boiler_cost_rate UPSERT (JdbcTemplate 직접 SQL)
    // ================================================================

    private void saveOrUpdateCostRate(int year, int month, String boilerCode, String rateType,
                                      String rateName, BigDecimal rateValue, String rateUnit,
                                      BigDecimal factor, String division) {
        // JPA로는 UK 기반 upsert가 번거로우므로 JdbcTemplate으로 REPLACE
        String sql = "INSERT INTO rpsim_boiler_cost_rate " +
                     "(YEAR, MONTH, BOILER_CODE, RATE_TYPE, RATE_NAME, RATE_VALUE, RATE_UNIT, FACTOR, DIVISION, MEMO, CREATED_BY, CREATED_AT, DELETED_YN) " +
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '에너지팀 자동수신', 'ENERGY_SYNC', NOW(), 'N') " +
                     "ON DUPLICATE KEY UPDATE RATE_NAME=VALUES(RATE_NAME), RATE_VALUE=VALUES(RATE_VALUE), " +
                     "RATE_UNIT=VALUES(RATE_UNIT), FACTOR=COALESCE(VALUES(FACTOR), FACTOR), " +
                     "MEMO='에너지팀 자동수신', UPDATED_BY='ENERGY_SYNC', UPDATED_AT=NOW(), " +
                     "DELETED_YN='N', DELETED_BY=NULL, DELETED_AT=NULL";
        jdbcTemplate.update(sql, year, month, boilerCode, rateType, rateName, rateValue, rateUnit,
                factor != null ? factor : BigDecimal.ONE, division);
    }

    // ================================================================
    // 통합 실행 (단가 + 원단위)
    // ================================================================

    /**
     * 단가 + 원단위 모두 수신.
     * @return {priceCount, unitRateCount, totalCount}
     */
    @Transactional
    public Map<String, Integer> syncAll(int year, String division) {
        int priceCount = syncPriceData(year, division);
        int unitRateCount = syncUnitRateData(year, division);
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("priceCount", priceCount);
        result.put("unitRateCount", unitRateCount);
        result.put("totalCount", priceCount + unitRateCount);
        return result;
    }
}
