package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;

import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import com.company.module.rollingplanningsimulation.entity.SteamPriceInterval;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import com.company.module.rollingplanningsimulation.repository.BoilerCostRateRepository;
import com.company.module.rollingplanningsimulation.repository.SteamPriceIntervalRepository;
import com.company.module.rollingplanningsimulation.repository.SteamUnitRateRepository;
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
    private final BoilerCostRateRepository boilerCostRateRepo;
    private final SteamPriceIntervalRepository steamPriceIntervalRepo;
    private final SteamUnitRateRepository steamUnitRateRepo;
    private final AuditSupport auditSupport;

    // ================================================================
    // row_key → RPSIM 매핑 정의
    // ================================================================

    private static final String[] INTERVAL_UK = {"contractYear", "month", "boilerCode", "intervalSeq", "division"};

    /** 단가 row_key → {boilerCode, rateType, rateName, rateUnit} */
    private static final Map<String, String[]> PRICE_MAPPING = new LinkedHashMap<>();
    static {
        // row_key → [boilerCode, rateType, rateName, rateUnit]
        PRICE_MAPPING.put("lng_unit",          new String[]{"BLR-LNG",    "FUEL_RATE",  "LNG 단가",           "원/㎥"});
        PRICE_MAPPING.put("waste2_steam",      new String[]{"BLR-INCIN",  "STEAM_RATE", "폐합성2호 스팀단가",   "원/톤"});
        PRICE_MAPPING.put("waste2_fixed_hr",   new String[]{"BLR-INCIN",  "FIXED_HR",   "폐합성2호 고정단가",   "원/HR"});
        PRICE_MAPPING.put("fluid_steam",       new String[]{"BLR-FLUID",  "STEAM_RATE", "유동상 스팀단가",      "원/톤"});
        PRICE_MAPPING.put("fluid_fixed_hr",    new String[]{"BLR-FLUID",  "FIXED_HR",   "유동상 고정단가",      "원/HR"});
    }

    /** FACTOR row_key → {boilerCode, rateType} - 이 값은 해당 rateType의 FACTOR로 업데이트 */
    private static final Map<String, String[]> FACTOR_MAPPING = new LinkedHashMap<>();
    static {
        FACTOR_MAPPING.put("comb_bsc_factor",  new String[]{"BLR-COGEN", "BSC"});
        FACTOR_MAPPING.put("comb_asc_factor",  new String[]{"BLR-COGEN", "ASC"});
    }

    /** 원단위 row_key → machineCode */
    private static final Map<String, String> UNIT_RATE_MAPPING = new LinkedHashMap<>();
    static {
        UNIT_RATE_MAPPING.put("t17|r01", "PM2");
        UNIT_RATE_MAPPING.put("t17|r02", "PM3");
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
        String yearStr = String.valueOf(year);
        log.info("[EnergySync] 단가 수신 시작 — year={}, division={}", year, division);

        // 1) aiplatform.steam_cell_value에서 unit_price_detail 조회
        String sql = "SELECT row_key, col_index AS mon, CAST(cell_value AS DECIMAL(18,4)) AS val " +
                     "FROM aiplatform.steam_cell_value " +
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
        for (Map.Entry<String, String[]> entry : PRICE_MAPPING.entrySet()) {
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
                saveOrUpdateCostRate(year, mon, boilerCode, rateType, rateName, val, rateUnit, null, division);
                count++;
            }
        }

        // 4) 복합보일러 구간단가 (BSC/ASC) → steam_price_interval에 저장
        count += syncIntervalPrices(dataMap, year, division);

        // 5) FACTOR 매핑 → boiler_cost_rate의 factor 컬럼 업데이트
        count += syncFactors(dataMap, year, division);

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
                saveOrUpdateCostRate(year, mon, "BLR-COGEN", "INTERVAL", "복합보일러 BSC 단가",
                        bscPrice, "원/톤", bscFactor, division);
                count++;
            }
            // ASC 단가도 별도 rateType으로 저장 (INTERVAL_ASC)
            if (ascPrice.compareTo(BigDecimal.ZERO) > 0) {
                saveOrUpdateCostRate(year, mon, "BLR-COGEN", "INTERVAL_ASC", "복합보일러 ASC 단가",
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

        // steam_price_interval 월별 저장 (BSC/ASC 단가·보증량이 매월 다를 수 있음)
        // 보증량이 해당 월에 없으면, 연중 처음 발견되는 보증량으로 대체
        BigDecimal fallbackGuarantee = BigDecimal.ZERO;
        if (guaranteeData != null) {
            fallbackGuarantee = guaranteeData.entrySet().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .map(Map.Entry::getValue)
                    .filter(v -> v != null && v.compareTo(BigDecimal.ZERO) > 0)
                    .findFirst().orElse(BigDecimal.ZERO);
        }

        for (int mon : new TreeSet<>(allMonths)) {
            BigDecimal bsc = bscData != null ? bscData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal asc = ascData != null ? ascData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            BigDecimal g = guaranteeData != null ? guaranteeData.getOrDefault(mon, BigDecimal.ZERO) : BigDecimal.ZERO;
            if (g == null || g.compareTo(BigDecimal.ZERO) <= 0) g = fallbackGuarantee;
            boolean hasG = g.compareTo(BigDecimal.ZERO) > 0;

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
            if (asc.compareTo(BigDecimal.ZERO) > 0) {
                SteamPriceInterval ascInterval = SteamPriceInterval.builder()
                        .contractYear(yearStr).month(mon).boilerCode("BLR-COGEN").intervalSeq(2)
                        .intervalName("초과구간 (ASC)")
                        .minUsageTon(hasG ? g : BigDecimal.ZERO).maxUsageTon(null)
                        .pricePerTon(asc).division(division).memo("에너지팀 자동수신")
                        .build();
                ascInterval.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamPriceIntervalRepo, ascInterval, INTERVAL_UK);
                count++;
            }
        }

        return count;
    }

    /**
     * FACTOR 동기화 — boiler_cost_rate의 INTERVAL 레코드에 factor 반영.
     */
    private int syncFactors(Map<String, Map<Integer, BigDecimal>> dataMap, int year, String division) {
        // FACTOR는 이미 syncIntervalPrices에서 처리됨 (saveOrUpdateCostRate에 factor 전달)
        // 여기서는 추가 독립 FACTOR row_key 처리 (필요 시)
        return 0;
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
        log.info("[EnergySync] 원단위 수신 시작 — year={}, division={}", year, division);

        // aiplatform.steam_cell_value에서 energy_fuel_ratio t17 조회
        // col_index: 2=1월 ~ 13=12월
        String sql = "SELECT row_key, col_index - 1 AS mon, CAST(cell_value AS DECIMAL(8,4)) AS val " +
                     "FROM aiplatform.steam_cell_value " +
                     "WHERE table_name = 'energy_fuel_ratio' AND month = ? " +
                     "AND row_key LIKE 't17|%' AND col_index BETWEEN 2 AND 13";

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, yearStr);
        log.info("[EnergySync] energy_fuel_ratio t17 조회 결과: {}건", rows.size());

        if (rows.isEmpty()) return 0;

        int count = 0;
        for (Map<String, Object> row : rows) {
            String rowKey = (String) row.get("row_key");
            int mon = ((Number) row.get("mon")).intValue();
            BigDecimal val = row.get("val") != null ? new BigDecimal(row.get("val").toString()) : BigDecimal.ZERO;

            String machineCode = UNIT_RATE_MAPPING.get(rowKey);
            if (machineCode == null) continue;
            if (val.compareTo(BigDecimal.ZERO) == 0) continue;

            // 기존 데이터 확인 → 없으면 INSERT, 있으면 UPDATE
            List<SteamUnitRate> existing = steamUnitRateRepo.findByYearAndMonthAndDivision(year, mon, division);
            SteamUnitRate found = existing.stream()
                    .filter(e -> machineCode.equals(e.getMachineCode()))
                    .findFirst().orElse(null);

            if (found != null) {
                found.update(val, found.getEtcUsageTon(), found.getLimitNote(), "에너지팀 자동수신");
                steamUnitRateRepo.save(found);
            } else {
                SteamUnitRate newRate = SteamUnitRate.builder()
                        .year(year).month(mon).machineCode(machineCode)
                        .division(division).steamPerTon(val)
                        .memo("에너지팀 자동수신")
                        .build();
                newRate.setCreatedBy("ENERGY_SYNC");
                auditSupport.upsert(steamUnitRateRepo, newRate, "year", "month", "machineCode", "division");
            }
            count++;
        }

        log.info("[EnergySync] 원단위 수신 완료 — {}건 처리", count);
        return count;
    }

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
