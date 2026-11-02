package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.MaterialForecast;
import com.company.module.rollingplanningsimulation.repository.MaterialForecastRepository;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.RawMaterialSql;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;

import static com.company.module.rollingplanningsimulation.support.RawMaterialSql.*;

/**
 * 원부재료비 — 전월 실적(SAP rpsim_raw_material) + 차월 예상(수기입력)
 *
 * <p>기준월(ym) = 예상월, 실적 = 전월(prevYm)</p>
 * <p>사업부 필터: 호기 마스터(rpsim_unit)에 해당 사업부 호기가 등록돼 있으면 그 호기만, 없으면 전체</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MaterialForecastService {

    private final JdbcTemplate jdbc;
    private final MaterialForecastRepository repo;
    private final AuditSupport auditSupport;

    private static final String[] UK = {"ym", "division", "machineCode", "rowType", "itemCode"};

    /** 사업부 + 호기 조건 (파라미터 4개: div, div, machine, machine) */
    private static final String SCOPE =
            " AND (NOT EXISTS (SELECT 1 FROM rpsim_unit u WHERE u.DIVISION = ? AND u.DELETED_YN = 'N')" +
            "      OR BIC_ZMACHINE IN (SELECT u.UNIT_CODE FROM rpsim_unit u WHERE u.DIVISION = ? AND u.DELETED_YN = 'N'))" +
            " AND (? = 'ALL' OR BIC_ZMACHINE = ?)";

    public Map<String, Object> load(String ym, String division, String machine) {
        validateYm(ym);
        String div = division == null || division.isBlank() ? "PS" : division;
        String mc = machine == null || machine.isBlank() ? "ALL" : machine;
        String prev = prevYm(ym);
        Object[] scope = {div, div, mc, mc};

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ym", ym);
        out.put("prevYm", prev);
        out.put("division", div);
        out.put("machine", mc);
        out.put("rules", Map.of(
                "production", PROD_QTY_COL + " — (호기, 제품레벨4)별 MAX 후 합계, kg÷1000",
                "cost", "실적배부수량(BIC_ZDTB_QTY) × 실적단가(BIC_ZTPRICE)",
                "category", "DATA_TYPE 100=원재료(자재그룹 1*) / 101=부재료(자재그룹 2*)"));

        // 호기 마스터에 등록된 해당 사업부 호기 (없으면 전체 호기 대상)
        out.put("divisionMachines", jdbc.queryForList(
                "SELECT UNIT_CODE FROM rpsim_unit WHERE DIVISION = ? AND DELETED_YN = 'N' ORDER BY UNIT_CODE", String.class, div));

        // 실적월 호기 목록 (사업부 범위)
        out.put("machines", jdbc.queryForList(
                "SELECT BIC_ZMACHINE AS code, MAX(BIC_ZMACHINE_NM) AS name FROM rpsim_raw_material WHERE CALMONTH = ?" +
                SCOPE.replace(" AND (? = 'ALL' OR BIC_ZMACHINE = ?)", "") +
                " AND BIC_ZMACHINE IS NOT NULL GROUP BY BIC_ZMACHINE ORDER BY BIC_ZMACHINE",
                prev, div, div));

        // ① 지종별 생산량 (톤) — 제품(호기+레벨4)별 MAX 후 지종 합계
        out.put("products", jdbc.queryForList(
                "SELECT product, ROUND(SUM(q)/1000, 3) AS prodTon FROM (" +
                "  SELECT " + PRODUCT_EXPR + " AS product, MAX(" + PROD_QTY_COL + ") AS q" +
                "  FROM rpsim_raw_material WHERE CALMONTH = ?" + SCOPE +
                "  GROUP BY BIC_ZMACHINE, PRODH4, PRODH2_NM) t GROUP BY product HAVING SUM(q) > 0 ORDER BY SUM(q) DESC",
                prepend(prev, scope)));

        // 호기 전체 생산량 P0 (원단위 분모)
        BigDecimal p0 = jdbc.queryForObject(
                "SELECT COALESCE(ROUND(SUM(q)/1000, 3), 0) FROM (" +
                "  SELECT MAX(" + PROD_QTY_COL + ") AS q FROM rpsim_raw_material WHERE CALMONTH = ?" + SCOPE +
                "  GROUP BY BIC_ZMACHINE, PRODH4) t", BigDecimal.class, prepend(prev, scope));
        out.put("prodTon", p0);

        // ② 자재별 실적 — 사용량 U0(kg), 비용 C0(원)
        out.put("materials", jdbc.queryForList(
                "SELECT MATERIAL AS materialCode, MAX(MATERIAL_NM) AS materialName," +
                "  MAX(DATA_TYPE) AS dataType, MAX(MATL_GROUP) AS matlGroup, MAX(MATL_GROUP_NM) AS groupName," +
                "  MAX(BIC_ZMATGROUP) AS largeGroup, MAX(BIC_ZMATGROUP_NM) AS largeName, MAX(UNIT) AS unit," +
                "  ROUND(SUM(COALESCE(BIC_ZDTB_QTY,0)), 3) AS usageQty, ROUND(SUM(" + COST_EXPR + "), 0) AS cost" +
                " FROM rpsim_raw_material WHERE CALMONTH = ?" + SCOPE + " AND MATERIAL IS NOT NULL" +
                " GROUP BY MATERIAL ORDER BY MAX(DATA_TYPE), MAX(BIC_ZMATGROUP), MAX(MATL_GROUP), MATERIAL",
                prepend(prev, scope)));

        // ③ 자재 × 지종 사용량 (지종별 원단위 = 사용량 ÷ 지종 생산량)
        out.put("unitByProduct", jdbc.queryForList(
                "SELECT MATERIAL AS materialCode, " + PRODUCT_EXPR + " AS product, ROUND(SUM(COALESCE(BIC_ZDTB_QTY,0)), 3) AS usageQty" +
                " FROM rpsim_raw_material WHERE CALMONTH = ?" + SCOPE + " AND MATERIAL IS NOT NULL" +
                " GROUP BY MATERIAL, " + PRODUCT_EXPR + " HAVING SUM(COALESCE(BIC_ZDTB_QTY,0)) <> 0",
                prepend(prev, scope)));

        // ④ 수기입력 저장값 (예상월)
        List<MaterialForecast> saved = repo.findByYmAndDivisionAndMachineCode(ym, div, mc);
        List<Map<String, Object>> savedProd = new ArrayList<>(), savedMat = new ArrayList<>();
        for (MaterialForecast f : saved) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("itemCode", f.getItemCode());
            m.put("itemName", f.getItemName());
            if ("PROD".equals(f.getRowType())) { m.put("prodTon", f.getProdTon()); savedProd.add(m); }
            else {
                m.put("usageQty", f.getUsageQty()); m.put("unitRate", f.getUnitRate());
                m.put("receiptPrice", f.getReceiptPrice()); m.put("openingPrice", f.getOpeningPrice());
                m.put("usePrice", f.getUsePrice()); m.put("issueNote", f.getIssueNote());
                m.put("updatedBy", f.getUpdatedBy() != null ? f.getUpdatedBy() : f.getCreatedBy());
                m.put("updatedAt", f.getUpdatedAt() != null ? f.getUpdatedAt() : f.getCreatedAt());
                savedMat.add(m);
            }
        }
        out.put("savedProducts", savedProd);
        out.put("savedMaterials", savedMat);
        return out;
    }

    /** 수기입력 저장 — UK 같으면 덮어씀 */
    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Integer> save(Map<String, Object> body) {
        String ym = str(body.get("ym"));
        validateYm(ym);
        String div = Optional.ofNullable(str(body.get("division"))).filter(s -> !s.isBlank()).orElse("PS");
        String mc = Optional.ofNullable(str(body.get("machineCode"))).filter(s -> !s.isBlank()).orElse("ALL");
        int prodCnt = 0, matCnt = 0;

        for (Map<String, Object> p : (List<Map<String, Object>>) body.getOrDefault("products", List.of())) {
            String code = str(p.get("itemCode"));
            if (code == null || code.isBlank()) continue;
            BigDecimal ton = bd(p.get("prodTon"));
            if (ton != null && ton.signum() < 0) throw new IllegalArgumentException("생산량은 0 이상이어야 합니다: " + code);
            auditSupport.upsert(repo, MaterialForecast.builder().ym(ym).division(div).machineCode(mc)
                    .rowType("PROD").itemCode(code).itemName(code).prodTon(ton).build(), UK);
            prodCnt++;
        }
        for (Map<String, Object> m : (List<Map<String, Object>>) body.getOrDefault("materials", List.of())) {
            String code = str(m.get("itemCode"));
            if (code == null || code.isBlank()) continue;
            BigDecimal usage = bd(m.get("usageQty")), price = bd(m.get("usePrice"));
            if (usage != null && usage.signum() < 0) throw new IllegalArgumentException("사용량은 0 이상이어야 합니다: " + code);
            if (price != null && price.signum() < 0) throw new IllegalArgumentException("사용단가는 0 이상이어야 합니다: " + code);
            String note = str(m.get("issueNote"));
            if (note != null && note.length() > 1000) note = note.substring(0, 1000);
            auditSupport.upsert(repo, MaterialForecast.builder().ym(ym).division(div).machineCode(mc)
                    .rowType("MAT").itemCode(code).itemName(str(m.get("itemName")))
                    .usageQty(usage).unitRate(bd(m.get("unitRate")))
                    .receiptPrice(bd(m.get("receiptPrice"))).openingPrice(bd(m.get("openingPrice")))
                    .usePrice(price).issueNote(note).build(), UK);
            matCnt++;
        }
        return Map.of("products", prodCnt, "materials", matCnt);
    }

    private static Object[] prepend(Object first, Object[] rest) {
        Object[] a = new Object[rest.length + 1];
        a[0] = first;
        System.arraycopy(rest, 0, a, 1, rest.length);
        return a;
    }
    private static String str(Object v) { return v == null ? null : v.toString().trim(); }
    private static BigDecimal bd(Object v) {
        if (v == null) return null;
        String s = v.toString().trim().replace(",", "");
        if (s.isEmpty()) return null;
        try { return new BigDecimal(s); } catch (Exception e) { throw new IllegalArgumentException("숫자 형식이 아닙니다: " + v); }
    }
}
