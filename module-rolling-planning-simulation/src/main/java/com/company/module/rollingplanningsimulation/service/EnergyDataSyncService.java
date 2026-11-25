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
 * 에너지팀 시스템에서 단가/원단위 데이터를 수신하여 RPSIM 기준정보 테이블에 동기화하는 서비스.
 *
 * <ul>
 *   <li>원단위: {@value #UNIT_TABLE} — 연·월 1행 (YEAR_NO, MONTH_NO), 호기별 컬럼 UNIT_PM2 … UNIT_TM5
 *       (에너지 회계비용 › 연료비 배분비율 › 스팀사용량 원단위(기타 스팀량 포함))</li>
 *   <li>단가: {@value #PRICE_TABLE} — 연·월·항목 1행 (YEAR_NO, MONTH_NO, ITEM_CODE), 값 PRICE_VALUE
 *       (원단위 일지 › 단가 입력)</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EnergyDataSyncService {

    @Getter private final JdbcTemplate jdbcTemplate;
    private final BoilerCostRateRepository boilerCostRateRepo;
    private final SteamPriceIntervalRepository steamPriceIntervalRepo;
    private final SteamUnitRateRepository steamUnitRateRepo;
    private final AuditSupport auditSupport;
    private final UnitRepository unitRepo;
    private final PwSimBasisVersionRepository pwVersionRepo;
    private final PwSimBasisLineRepository pwLineRepo;

    /** 마지막 원단위 수신의 호기 연결 결과·경고 (화면 표시용) */
    @Getter private final List<String> lastUnitRateNotes = Collections.synchronizedList(new ArrayList<>());
    /** 마지막 단가 수신의 미수신 항목·모르는 항목 코드 (화면 표시용) */
    @Getter private final List<String> lastPriceNotes = Collections.synchronizedList(new ArrayList<>());

    /** 에너지팀 DB 스키마 (기본 aiplatform) */
    @org.springframework.beans.factory.annotation.Value("${rpsim.energy-sync.schema:aiplatform}")
    private String energySchema = "aiplatform";

    public static final String UNIT_TABLE = "steam_energy_ratio_steam_unit";
    public static final String PRICE_TABLE = "steam_price";

    /** 스키마 이름은 영문·숫자·밑줄만 허용 (SQL 에 직접 들어가므로) */
    public String table(String name) {
        String sc = energySchema == null ? "" : energySchema.trim();
        if (!sc.matches("[A-Za-z0-9_]*")) throw new IllegalStateException("rpsim.energy-sync.schema 값이 올바르지 않습니다: " + sc);
        return sc.isEmpty() ? name : sc + "." + name;
    }

    // ================================================================
    // 에너지팀 항목 → RPSIM 매핑 정의
    // ================================================================

    private static final String[] INTERVAL_UK = {"contractYear", "month", "boilerCode", "intervalSeq", "division"};

    /**
     * 수신 매핑 — 단가 ITEM_CODE → 보일러/단가 종류.
     */
    private static final class DivisionMapping {
        /** 단가 ITEM_CODE → [boilerCode, rateType, rateName, rateUnit] */
        final Map<String, String[]> price = new LinkedHashMap<>();
        /** 복합보일러 구간단가(comb_asc/comb_bsc/보증량/FACTOR) 수신 여부 */
        boolean cogenInterval;
    }

    /**
     * 보일러 단가 = 공장 공통(PLANT). 사업부를 골라 수신해도 PLANT 로 저장 (보일러는 PS·HL 이 함께 씀)
     * 원단위 = 호기 컬럼마다 대시보드 호기명 → 호기 마스터/전력 기준정보 호기명으로 호기코드·사업부를 찾아 저장 (PS·HL 한 번에)
     */
    private static final DivisionMapping PLANT_MAPPING = new DivisionMapping();
    /** 원단위 컬럼 → 대시보드 호기명. 소계 컬럼(UNIT_PAPER_SUBTOTAL, UNIT_TISSUE_SUBTOTAL)은 받지 않음 */
    static final Map<String, String> UNIT_COLS = new LinkedHashMap<>();
    /** 복합보일러 구간단가 항목 코드 */
    static final List<String> INTERVAL_CODES = List.of("comb_bsc", "comb_asc", "comb_bsc_guarantee", "comb_bsc_factor", "comb_asc_factor");
    static {
        PLANT_MAPPING.price.put("lng_unit",        new String[]{"BLR-LNG",   "FUEL_RATE",  "LNG 단가",         "원/㎥"});
        PLANT_MAPPING.price.put("waste2_steam",    new String[]{"BLR-INCIN", "STEAM_RATE", "폐합성2호 스팀단가", "원/톤"});
        PLANT_MAPPING.price.put("waste2_fixed_hr", new String[]{"BLR-INCIN", "FIXED_HR",   "폐합성2호 고정단가", "원/HR"});
        PLANT_MAPPING.price.put("fluid_steam",     new String[]{"BLR-FLUID", "STEAM_RATE", "유동상 스팀단가",    "원/톤"});
        PLANT_MAPPING.price.put("fluid_fixed_hr",  new String[]{"BLR-FLUID", "FIXED_HR",   "유동상 고정단가",    "원/HR"});
        PLANT_MAPPING.cogenInterval = true;
        UNIT_COLS.put("UNIT_PM2", "제지2");
        UNIT_COLS.put("UNIT_PM3", "제지3");
        UNIT_COLS.put("UNIT_TM3", "화장지3");
        UNIT_COLS.put("UNIT_TM4", "화장지4");
        UNIT_COLS.put("UNIT_TM5", "화장지5");
    }
    public static final String PLANT = "PLANT";

    private static DivisionMapping mappingOf(String division) { return PLANT_MAPPING; }

    /** 수신 가능한 사업부인지 */
    public static boolean isSupported(String division) {
        return division != null && List.of("PS", "HL", PLANT).contains(division.trim().toUpperCase());
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

        lastPriceNotes.clear();

        // 1) 단가 입력 테이블 조회 — 연·월·항목 1행
        String sql = "SELECT MONTH_NO AS mon, ITEM_CODE AS code, CAST(PRICE_VALUE AS DECIMAL(18,4)) AS val " +
                     "FROM " + table(PRICE_TABLE) + " WHERE YEAR_NO = ? AND MONTH_NO BETWEEN 1 AND 12";

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, year);
        log.info("[EnergySync] {} 조회 결과: {}건", PRICE_TABLE, rows.size());

        if (rows.isEmpty()) { lastPriceNotes.add(year + "년 에너지팀 단가(" + PRICE_TABLE + ")가 없습니다"); return 0; }

        // 2) 항목 코드별로 그룹핑: {item_code: {month: value}}
        Map<String, Map<Integer, BigDecimal>> dataMap = groupPrices(rows);
        lastPriceNotes.addAll(priceNotes(dataMap.keySet(), mp));

        int count = 0;

        // 3) 일반 단가 매핑 → boiler_cost_rate에 월별 INSERT
        for (Map.Entry<String, String[]> entry : mp.price.entrySet()) {
            String itemCode = entry.getKey();
            String[] mapping = entry.getValue();
            String boilerCode = mapping[0], rateType = mapping[1], rateName = mapping[2], rateUnit = mapping[3];

            Map<Integer, BigDecimal> monthData = dataMap.get(itemCode);
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

    /** 단가 행 → {항목 코드(소문자): {월: 값}}. 값이 비어 있는 행은 건너뜀 */
    static Map<String, Map<Integer, BigDecimal>> groupPrices(List<Map<String, Object>> rows) {
        Map<String, Map<Integer, BigDecimal>> dataMap = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            Object c = row.get("code"), m = row.get("mon"), v = row.get("val");
            if (c == null || m == null || v == null) continue;
            String code = c.toString().trim().toLowerCase(Locale.ROOT);
            if (code.isEmpty()) continue;
            dataMap.computeIfAbsent(code, k -> new HashMap<>()).put(((Number) m).intValue(), new BigDecimal(v.toString()));
        }
        return dataMap;
    }

    /** 받은 항목 코드와 매핑 비교 → 매핑에 없어 저장하지 않은 코드 / 매핑에 있는데 받지 못한 코드 */
    private static List<String> priceNotes(Set<String> codes, DivisionMapping mp) {
        Set<String> known = new HashSet<>(mp.price.keySet());
        if (mp.cogenInterval) known.addAll(INTERVAL_CODES);
        List<String> notes = new ArrayList<>();
        List<String> unknown = codes.stream().filter(c -> !known.contains(c)).sorted().toList();
        List<String> missing = new ArrayList<>();
        for (String k : mp.price.keySet()) if (!codes.contains(k)) missing.add(k + "(" + mp.price.get(k)[2] + ")");
        if (mp.cogenInterval) for (String k : List.of("comb_bsc", "comb_asc", "comb_bsc_guarantee")) if (!codes.contains(k)) missing.add(k);
        if (!missing.isEmpty()) notes.add("에너지팀 단가에 없어 받지 못한 항목: " + String.join(", ", missing));
        if (!unknown.isEmpty()) notes.add("연결 규칙이 없어 저장하지 않은 항목 코드: " + String.join(", ", unknown));
        return notes;
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

        // 스팀사용량 원단위(기타 스팀량 포함) — 연·월 1행, 호기별 컬럼
        String sql = "SELECT MONTH_NO AS mon, " + String.join(", ", UNIT_COLS.keySet()) +
                     " FROM " + table(UNIT_TABLE) + " WHERE YEAR_NO = ? AND MONTH_NO BETWEEN 1 AND 12";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, year);
        log.info("[EnergySync] {} 조회 결과: {}건", UNIT_TABLE, rows.size());
        if (rows.isEmpty()) { lastUnitRateNotes.add(year + "년 에너지팀 스팀사용량 원단위(" + UNIT_TABLE + ")가 없습니다 (연료비 배분비율 페이지가 저장된 적이 없을 수 있음)"); return 0; }

        // 대시보드 호기명 → 호기 마스터 (호기명/코드 이름 비교 + 전력 기준정보 엑셀 호기명)
        Map<String, String[]> match = new LinkedHashMap<>();   // 컬럼 → {machineCode, division}
        List<String> unmatched = new ArrayList<>();
        for (Map.Entry<String, String> e : UNIT_COLS.entrySet()) {
            String[] m = matchUnit(e.getValue());
            if (m == null) unmatched.add(e.getValue());
            else { match.put(e.getKey(), m); lastUnitRateNotes.add(e.getValue() + " → " + m[1] + " " + m[0]); }
        }
        if (!unmatched.isEmpty())
            lastUnitRateNotes.add("호기 마스터와 연결되지 않아 받지 않은 호기: " + String.join(", ", unmatched)
                    + " — [기준정보 › 호기 마스터]의 호기명을 대시보드 이름(예: 화장지3)과 같게 하거나, 전력비 엑셀 가져오기로 연결하세요");

        int count = 0;
        for (UnitCell cell : unitCells(rows)) {
            String[] m = match.get(cell.col());
            if (m == null) continue;   // 미연결 호기
            int mon = cell.month();
            BigDecimal val = cell.value();
            String machineCode = m[0], div = m[1];
            String memo = "에너지팀 자동수신 (스팀사용량 원단위 " + UNIT_COLS.get(cell.col()) + ")";
            SteamUnitRate found = steamUnitRateRepo.findByYearAndMonthAndDivision(year, mon, div).stream()
                    .filter(x -> machineCode.equalsIgnoreCase(x.getMachineCode())).findFirst().orElse(null);
            if (found != null) {
                found.update(val, found.getEtcUsageTon(), found.getLimitNote(), memo);
                steamUnitRateRepo.save(found);
            } else {
                SteamUnitRate newRate = SteamUnitRate.builder()
                        .year(year).month(mon).machineCode(machineCode).division(div).steamPerTon(val)
                        .memo(memo)
                        .build();
                newRate.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamUnitRateRepo, newRate, "year", "month", "machineCode", "division");
            }
            count++;
        }
        log.info("[EnergySync] 원단위 수신 완료 — {}건 처리 / 연결 {}", count, lastUnitRateNotes);
        return count;
    }

    /** 원단위 한 칸 (월·호기 컬럼·값) */
    record UnitCell(int month, String col, BigDecimal value) {}

    /**
     * 원단위 행(연·월 1행) → 호기 컬럼별 칸. 소계 컬럼은 받지 않음.
     * 빈 칸·0 은 저장하지 않음 (기존 값을 0으로 덮어쓰지 않음). 컬럼 이름 대소문자는 구분하지 않음.
     */
    static List<UnitCell> unitCells(List<Map<String, Object>> rows) {
        List<UnitCell> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> r = new HashMap<>();
            row.forEach((k, v) -> r.put(k.toUpperCase(Locale.ROOT), v));
            Object m = r.get("MON");
            if (m == null) continue;
            int mon = ((Number) m).intValue();
            for (String col : UNIT_COLS.keySet()) {
                Object v = r.get(col);
                if (v == null || v.toString().isBlank()) continue;
                BigDecimal val;
                try { val = new BigDecimal(v.toString().trim()); } catch (NumberFormatException e) { continue; }
                if (val.compareTo(BigDecimal.ZERO) == 0) continue;
                out.add(new UnitCell(mon, col, val));
            }
        }
        return out;
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
