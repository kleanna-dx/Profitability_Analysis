package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 구매 이동계획 — 업로드 검증·저장 + 펄프 이동평균 계산 + 손익영향
 *
 * <ul>
 *   <li>기초재고: SAP 수불부(rpsim_raw_inventory) 시작월 전월 기말. 공장→사업부 P100=PS, P200·P300=HL (P500 제외)</li>
 *   <li>입고수량 = 구매 + 이동, 그중 이동수량 = 반대 사업부에서 옮겨온 수량 (단가 = 보내는 쪽 그 달 이동평균)</li>
 *   <li>구매분 금액 = 입고금액 직접입력(백만원) 우선, 없으면 구매수량 × 단가 × 부대비율 × 이동계획 환율</li>
 *   <li>출고수량은 이동 보낸 수량 포함 → 실제 사용량 = 출고 − 이동 보낸 수량</li>
 *   <li>손익영향 = (전월 출고단가 − 당월 출고단가) × 당월 실제 사용량 (원, + 개선 / − 악화)</li>
 *   <li>미등록 환율·부대비율은 금액 0 + 경고 (추정값 없음)</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PurchasePlanService {

    public static final List<String> DIVISIONS = List.of("PS", "HL");
    public static final String OEM_GROUP = "OEM(상품)";
    private static final String PULP_COND = "(MATL_GROUP_NM LIKE '%펄프%' OR BIC_ZMATGROUP_NM LIKE '%펄프%')";
    private static final DateTimeFormatter YM = DateTimeFormatter.ofPattern("yyyyMM");
    private static final double EPS = 1e-9;

    private final JdbcTemplate jdbc;
    private final PurchasePlanVersionRepository versionRepo;
    private final PurchasePulpPlanRepository pulpRepo;
    private final PurchaseNonPulpImpactRepository nonPulpRepo;
    private final PurchaseCurrencyRepository currencyRepo;
    private final PurchaseExchangeRateRepository rateRepo;
    private final PurchaseIncidentalRateRepository incidentalRepo;

    // ================================================================ 공통 유틸

    public static String plantToDivision(String plant) {
        if (plant == null) return null;
        switch (plant.trim()) {
            case "P100": return "PS";
            case "P200": case "P300": return "HL";
            default: return null; // P500 등 — 구매 이동계획 대상 아님
        }
    }

    public static String stripCode(Object c) {
        if (c == null) return null;
        String s = c.toString().trim();
        if (s.isEmpty()) return null;
        s = s.replaceFirst("^0+(?=\\d)", "");
        return s;
    }

    public static String opposite(String div) { return "PS".equals(div) ? "HL" : "PS"; }

    public static String normYm(Object v) {
        if (v == null) return null;
        String s = v.toString().trim().replace(".", "").replace("-", "").replace("/", "");
        if (!s.matches("\\d{6}")) return null;
        int m = Integer.parseInt(s.substring(4));
        return (m >= 1 && m <= 12) ? s : null;
    }

    public static String addMonths(String ym, int n) { return YearMonth.parse(ym, YM).plusMonths(n).format(YM); }

    private static String str(Object o) {
        if (o == null) return null;
        String s = o.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static BigDecimal num(Object o, String label, Integer row, List<String> errors) {
        if (o == null) return null;
        String s = o.toString().replace(",", "").trim();
        if (s.isEmpty()) return null;
        try { return new BigDecimal(s); }
        catch (NumberFormatException e) { errors.add(rowMsg(row, label + " 숫자가 아닙니다: " + s)); return null; }
    }

    private static String rowMsg(Integer row, String msg) { return (row != null ? row + "행: " : "") + msg; }
    private static double d(BigDecimal b) { return b == null ? 0 : b.doubleValue(); }
    private static Double r(Double v, int scale) {
        if (v == null || v.isNaN() || v.isInfinite()) return null;
        return BigDecimal.valueOf(v).setScale(scale, RoundingMode.HALF_UP).doubleValue();
    }
    private static String ymDot(String ym) { return ym == null ? "-" : ym.substring(0, 4) + "." + ym.substring(4); }

    // ================================================================ 기준 목록 (엑셀 드롭다운·검증용)

    /** SAP 수불부의 펄프 자재 (자재코드 앞자리 0 제거) */
    public List<Map<String, Object>> pulpMaterials() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT MATERIAL, MAX(MATERIAL_NM) AS NM, MAX(MATL_GROUP_NM) AS GRP FROM rpsim_raw_inventory" +
                " WHERE DELETED_YN = 'N' AND " + PULP_COND + " GROUP BY MATERIAL ORDER BY MATERIAL");
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String code = stripCode(r.get("MATERIAL"));
            if (code == null || out.containsKey(code)) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", code); m.put("name", str(r.get("NM"))); m.put("group", str(r.get("GRP")));
            out.put(code, m);
        }
        return new ArrayList<>(out.values());
    }

    /** 펄프외 품목그룹 = SAP 대분류 + OEM(상품), 자재그룹 = "대분류 : 자재그룹명" */
    public Map<String, Object> masters() {
        Set<String> groups = new TreeSet<>();
        Set<String> matlGroups = new TreeSet<>();
        for (String t : List.of("rpsim_raw_material", "rpsim_raw_inventory")) {
            for (Map<String, Object> r : jdbc.queryForList("SELECT DISTINCT BIC_ZMATGROUP_NM AS L, MATL_GROUP_NM AS G FROM " + t +
                    " WHERE DELETED_YN = 'N' AND BIC_ZMATGROUP_NM IS NOT NULL AND BIC_ZMATGROUP_NM <> ''")) {
                String l = str(r.get("L")), g = str(r.get("G"));
                if (l == null) continue;
                groups.add(l);
                if (g != null) matlGroups.add(l + " : " + g);
            }
        }
        List<String> itemGroups = new ArrayList<>(groups);
        itemGroups.add(OEM_GROUP);
        List<Map<String, Object>> currencies = new ArrayList<>();
        for (PurchaseCurrency c : currencyRepo.findAllByOrderBySortOrderAscCurrencyCodeAsc()) {
            if (!"Y".equals(c.getUseYn())) continue;
            currencies.add(Map.of("code", c.getCurrencyCode(), "name", c.getCurrencyName() == null ? "" : c.getCurrencyName(),
                    "base", "Y".equals(c.getBaseYn())));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("divisions", DIVISIONS);
        res.put("pulpMaterials", pulpMaterials());
        res.put("currencies", currencies);
        res.put("itemGroups", itemGroups);
        res.put("matlGroups", new ArrayList<>(matlGroups));
        return res;
    }

    // ================================================================ 버전 조회

    public Map<String, Object> check(String startYm) {
        String ym = normYm(startYm);
        if (ym == null) throw new IllegalArgumentException("시작월 형식이 올바르지 않습니다 (yyyy.mm): " + startYm);
        List<PurchasePlanVersion> list = versionRepo.findByStartYmAndStatus(ym, PurchasePlanVersion.ACTIVE);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("startYm", ym);
        res.put("exists", !list.isEmpty());
        if (!list.isEmpty()) res.put("version", versionInfo(list.get(0)));
        return res;
    }

    public List<Map<String, Object>> versions() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (PurchasePlanVersion v : versionRepo.findAllByOrderByVersionIdDesc()) out.add(versionInfo(v));
        return out;
    }

    private Map<String, Object> versionInfo(PurchasePlanVersion v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("versionId", v.getVersionId());
        m.put("startYm", v.getStartYm());
        m.put("endYm", v.getEndYm());
        m.put("writeDate", v.getWriteDate() == null ? null : v.getWriteDate().toString());
        m.put("fileName", v.getFileName());
        m.put("status", v.getStatus());
        m.put("pulpRows", v.getPulpRows());
        m.put("nonPulpRows", v.getNonPulpRows());
        m.put("warnings", v.getWarnings() == null || v.getWarnings().isBlank() ? List.of() : List.of(v.getWarnings().split("\n")));
        m.put("createdBy", v.getCreatedBy());
        m.put("createdAt", v.getCreatedAt() == null ? null : v.getCreatedAt().toString());
        return m;
    }

    /** 버전 상세: 입력 행 + 계산 결과 */
    public Map<String, Object> detail(Long versionId) {
        PurchasePlanVersion v = versionRepo.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("구매 이동계획 버전을 찾을 수 없습니다: " + versionId));
        List<PurchasePulpPlan> pulp = pulpRepo.findByVersionIdOrderByExcelRowNoAscYmAsc(versionId);
        List<PurchaseNonPulpImpact> np = nonPulpRepo.findByVersionIdOrderByYmAscExcelRowNoAsc(versionId);
        List<String> warnings = new ArrayList<>();
        Calc c = compute(v.getStartYm(), pulp, warnings);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("version", versionInfo(v));
        res.put("months", c.months);
        res.put("ledger", c.ledgerOut());
        res.put("pulpRows", pulpOut(pulp));
        res.put("pulpImpact", c.impactByDivMonth());
        res.put("nonPulp", npOut(np));
        res.put("nonPulpImpact", npSum(np));
        res.put("warnings", warnings);
        res.put("openingBasis", c.openingBasis);
        return res;
    }

    @Transactional
    public void deleteVersion(Long versionId, String user) {
        PurchasePlanVersion v = versionRepo.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("구매 이동계획 버전을 찾을 수 없습니다: " + versionId));
        for (PurchasePulpPlan p : pulpRepo.findByVersionIdOrderByExcelRowNoAscYmAsc(versionId)) p.softDelete(user);
        for (PurchaseNonPulpImpact p : nonPulpRepo.findByVersionIdOrderByYmAscExcelRowNoAsc(versionId)) p.softDelete(user);
        v.softDelete(user);
        versionRepo.save(v);
    }

    /** P/L 용 — 기준월을 포함하는 ACTIVE 버전 중 시작월이 가장 늦은 것 */
    public Map<String, Object> impact(String ymRaw, String division) {
        String ym = normYm(ymRaw);
        if (ym == null) throw new IllegalArgumentException("기준월 형식이 올바르지 않습니다: " + ymRaw);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ym", ym);
        res.put("division", division);
        Optional<PurchasePlanVersion> ov = versionRepo
                .findFirstByStatusAndStartYmLessThanEqualAndEndYmGreaterThanEqualOrderByStartYmDescVersionIdDesc(
                        PurchasePlanVersion.ACTIVE, ym, ym);
        if (ov.isEmpty()) {
            res.put("found", false);
            res.put("pulpImpactWon", 0);
            res.put("nonPulpImpactWon", 0);
            res.put("warnings", List.of(ymDot(ym) + "을 포함하는 구매 이동계획 업로드가 없습니다 — 구매 단가 영향 0으로 계산"));
            return res;
        }
        PurchasePlanVersion v = ov.get();
        List<String> warnings = new ArrayList<>();
        Calc c = compute(v.getStartYm(), pulpRepo.findByVersionIdOrderByExcelRowNoAscYmAsc(v.getVersionId()), warnings);
        double pulp = 0;
        List<Map<String, Object>> items = new ArrayList<>();
        for (Cell cell : c.cells.values()) {
            if (!cell.ym.equals(ym) || !cell.div.equals(division)) continue;
            pulp += cell.impactWon;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("materialCode", cell.code); m.put("materialName", cell.name);
            m.put("useQtyTon", r(cell.useQty, 3)); m.put("prevPrice", r(cell.prevPrice, 0)); m.put("avgPrice", r(cell.avgPrice, 0));
            m.put("impactWon", r(cell.impactWon, 0));
            items.add(m);
        }
        double npTotal = 0;
        List<Map<String, Object>> npItems = new ArrayList<>();
        for (PurchaseNonPulpImpact n : nonPulpRepo.findByVersionIdOrderByYmAscExcelRowNoAsc(v.getVersionId())) {
            if (!n.getYm().equals(ym) || !n.getDivision().equals(division)) continue;
            npTotal += d(n.getImpactMkrw()) * 1_000_000d;
            npItems.add(npRow(n));
        }
        res.put("found", true);
        res.put("version", versionInfo(v));
        res.put("pulpImpactWon", r(pulp, 0));
        res.put("pulpItems", items);
        res.put("nonPulpImpactWon", r(npTotal, 0));
        res.put("nonPulpItems", npItems);
        res.put("warnings", warnings);
        return res;
    }

    /** 업로드한 원래 입력값 (엑셀 재다운로드용) */
    private List<Map<String, Object>> pulpOut(List<PurchasePulpPlan> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (PurchasePulpPlan p : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("excelRowNo", p.getExcelRowNo()); m.put("ym", p.getYm()); m.put("division", p.getDivision());
            m.put("materialCode", p.getMaterialCode()); m.put("materialName", p.getMaterialName());
            m.put("inQty", p.getInQtyTon()); m.put("moveInQty", p.getMoveInQtyTon()); m.put("currency", p.getPayCurrency());
            m.put("unitPrice", p.getUnitPriceFc()); m.put("offerMonth", p.getOfferMonth()); m.put("inAmountMkrw", p.getInAmountMkrw());
            m.put("outQty", p.getOutQtyTon()); m.put("note", p.getNote());
            out.add(m);
        }
        return out;
    }

    private List<Map<String, Object>> npOut(List<PurchaseNonPulpImpact> np) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (PurchaseNonPulpImpact n : np) out.add(npRow(n));
        return out;
    }

    private Map<String, Object> npRow(PurchaseNonPulpImpact n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ym", n.getYm()); m.put("division", n.getDivision()); m.put("itemGroup", n.getItemGroup());
        m.put("matlGroup", n.getMatlGroupNm()); m.put("itemName", n.getItemName()); m.put("content", n.getContent());
        m.put("impactMkrw", n.getImpactMkrw()); m.put("note", n.getNote()); m.put("excelRowNo", n.getExcelRowNo());
        return m;
    }

    private Map<String, Double> npSum(List<PurchaseNonPulpImpact> np) {
        Map<String, Double> m = new TreeMap<>();
        for (PurchaseNonPulpImpact n : np) m.merge(n.getDivision() + "|" + n.getYm(), d(n.getImpactMkrw()) * 1_000_000d, Double::sum);
        m.replaceAll((k, v) -> r(v, 0));
        return m;
    }

    // ================================================================ 업로드

    /**
     * body: {startYm, writeDate, fileName, replace, pulp:[{row, division, materialCode, ym, inQty, moveInQty, currency,
     *        unitPrice, offerMonth, inAmountMkrw, outQty, note}], nonPulp:[{row, ym, division, itemGroup, matlGroup,
     *        itemName, content, impactMkrw, note}]}
     * 반환: ok=false + errors (저장 안 함) / needConfirm=true (같은 시작월 기존 업로드 있음) / ok=true + warnings
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> upload(Map<String, Object> body) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Map<String, Object> res = new LinkedHashMap<>();

        String startYm = normYm(body.get("startYm"));
        if (startYm == null) throw new IllegalArgumentException("시작월 형식이 올바르지 않습니다 (yyyy.mm): " + body.get("startYm"));
        List<String> months = List.of(startYm, addMonths(startYm, 1), addMonths(startYm, 2));
        LocalDate writeDate = null;
        if (str(body.get("writeDate")) != null) {
            try { writeDate = LocalDate.parse(str(body.get("writeDate")).replace(".", "-").replace("/", "-")); }
            catch (Exception e) { errors.add("기본정보: 작성일 형식이 올바르지 않습니다 (yyyy-mm-dd): " + body.get("writeDate")); }
        }

        // ── 기준 목록 ──
        Map<String, Map<String, Object>> materials = new HashMap<>();
        for (Map<String, Object> m : pulpMaterials()) materials.put((String) m.get("code"), m);
        Map<String, Object> ms = masters();
        Set<String> itemGroups = new HashSet<>((List<String>) ms.get("itemGroups"));
        Set<String> matlGroups = new HashSet<>((List<String>) ms.get("matlGroups"));
        Set<String> currencies = new HashSet<>();
        for (Map<String, Object> c : (List<Map<String, Object>>) ms.get("currencies")) currencies.add((String) c.get("code"));

        // ── 펄프 수불 ──
        List<PurchasePulpPlan> pulp = new ArrayList<>();
        Map<String, Integer> seen = new HashMap<>();
        for (Map<String, Object> p : (List<Map<String, Object>>) body.getOrDefault("pulp", List.of())) {
            Integer row = p.get("row") == null ? null : ((Number) p.get("row")).intValue();
            String div = str(p.get("division"));
            String code = stripCode(p.get("materialCode"));
            String ym = normYm(p.get("ym"));
            BigDecimal in = num(p.get("inQty"), "입고수량", row, errors);
            BigDecimal mv = num(p.get("moveInQty"), "이동수량", row, errors);
            String cur = str(p.get("currency"));
            BigDecimal price = num(p.get("unitPrice"), "단가", row, errors);
            BigDecimal amt = num(p.get("inAmountMkrw"), "입고금액", row, errors);
            BigDecimal out = num(p.get("outQty"), "출고수량", row, errors);
            boolean any = in != null || mv != null || cur != null || price != null || amt != null || out != null;
            if (!any) continue; // 그 달 값이 하나도 없으면 건너뜀

            String mlabel = ym == null ? "" : "[" + ymDot(ym) + "] ";
            if (div == null || !DIVISIONS.contains(div)) { errors.add(rowMsg(row, mlabel + "사업부는 PS/HL 중 하나여야 합니다: " + (div == null ? "(빈칸)" : div))); continue; }
            if (code == null) { errors.add(rowMsg(row, mlabel + "SAP 펄프자재가 비어 있습니다")); continue; }
            if (!materials.containsKey(code)) { errors.add(rowMsg(row, mlabel + "SAP 수불부에 없는 펄프자재입니다: " + code)); continue; }
            if (ym == null || !months.contains(ym)) { errors.add(rowMsg(row, "대상월이 시작월부터 3개월 범위가 아닙니다: " + p.get("ym"))); continue; }
            String key = div + "|" + code + "|" + ym;
            if (seen.containsKey(key)) { errors.add(rowMsg(row, mlabel + div + " " + code + " 이(가) " + seen.get(key) + "행과 중복됩니다 (사업부 + 자재는 한 줄)")); continue; }
            seen.put(key, row);
            for (Object[] q : new Object[][]{{in, "입고수량"}, {mv, "이동수량"}, {out, "출고수량"}, {price, "단가"}})
                if (q[0] != null && ((BigDecimal) q[0]).signum() < 0) errors.add(rowMsg(row, mlabel + q[1] + "은(는) 0 이상이어야 합니다"));
            if (mv != null && mv.signum() > 0 && (in == null || mv.compareTo(in) > 0))
                errors.add(rowMsg(row, mlabel + "이동수량(" + mv.toPlainString() + ")이 입고수량(" + (in == null ? "빈칸" : in.toPlainString()) + ")보다 큽니다"));
            BigDecimal purchase = (in == null ? BigDecimal.ZERO : in).subtract(mv == null ? BigDecimal.ZERO : mv);
            if (purchase.signum() > 0) {
                if (amt == null) {
                    if (cur == null) errors.add(rowMsg(row, mlabel + "구매분 " + purchase.toPlainString() + "톤의 지급통화가 비어 있습니다 (또는 입고금액 직접 입력)"));
                    if (price == null) errors.add(rowMsg(row, mlabel + "구매분 " + purchase.toPlainString() + "톤의 단가가 비어 있습니다 (또는 입고금액 직접 입력)"));
                }
                if (cur != null && !currencies.contains(cur)) errors.add(rowMsg(row, mlabel + "기준정보에 등록되지 않은 지급통화입니다: " + cur));
            } else if (cur != null || price != null || amt != null) {
                errors.add(rowMsg(row, mlabel + "구매분(입고 − 이동)이 없는데 지급통화·단가·입고금액이 입력되어 있습니다 — 이동분은 단가를 입력하지 않습니다"));
            }
            pulp.add(PurchasePulpPlan.builder().ym(ym).division(div).materialCode(code)
                    .materialName((String) materials.get(code).get("name"))
                    .matlGroupNm((String) materials.get(code).get("group"))
                    .inQtyTon(in).moveInQtyTon(mv != null && mv.signum() == 0 ? null : mv).payCurrency(cur).unitPriceFc(price)
                    .offerMonth(str(p.get("offerMonth"))).inAmountMkrw(amt).outQtyTon(out)
                    .note(cut(str(p.get("note")), 1000)).excelRowNo(row).build());
        }
        // 이동수량 ≤ 보내는 사업부 출고수량
        Map<String, PurchasePulpPlan> byKey = new HashMap<>();
        for (PurchasePulpPlan p : pulp) byKey.put(p.getDivision() + "|" + p.getMaterialCode() + "|" + p.getYm(), p);
        for (PurchasePulpPlan p : pulp) {
            if (p.getMoveInQtyTon() == null || p.getMoveInQtyTon().signum() <= 0) continue;
            String sender = opposite(p.getDivision());
            PurchasePulpPlan s = byKey.get(sender + "|" + p.getMaterialCode() + "|" + p.getYm());
            BigDecimal sOut = s == null || s.getOutQtyTon() == null ? BigDecimal.ZERO : s.getOutQtyTon();
            if (p.getMoveInQtyTon().compareTo(sOut) > 0)
                errors.add(rowMsg(p.getExcelRowNo(), "[" + ymDot(p.getYm()) + "] " + p.getDivision() + " 이동수량 " + p.getMoveInQtyTon().toPlainString()
                        + "톤이 보내는 사업부(" + sender + ") 같은 자재 출고수량 " + sOut.toPlainString() + "톤보다 큽니다 — "
                        + sender + " 출고에는 이동분을 포함해서 적어야 합니다"));
        }

        // ── 펄프외 영향 ──
        List<PurchaseNonPulpImpact> nonPulp = new ArrayList<>();
        for (Map<String, Object> n : (List<Map<String, Object>>) body.getOrDefault("nonPulp", List.of())) {
            Integer row = n.get("row") == null ? null : ((Number) n.get("row")).intValue();
            String ym = normYm(n.get("ym"));
            String div = str(n.get("division"));
            String grp = str(n.get("itemGroup"));
            String mg = str(n.get("matlGroup"));
            BigDecimal imp = num(n.get("impactMkrw"), "손익영향", row, errors);
            String lbl = "[펄프외] ";
            if (ym == null || !months.contains(ym)) errors.add(rowMsg(row, lbl + "대상월이 시작월부터 3개월 범위가 아닙니다: " + (n.get("ym") == null ? "(빈칸)" : n.get("ym"))));
            if (div == null || !DIVISIONS.contains(div)) errors.add(rowMsg(row, lbl + "사업부는 PS/HL 중 하나여야 합니다: " + (div == null ? "(빈칸)" : div)));
            if (grp == null) errors.add(rowMsg(row, lbl + "품목그룹이 비어 있습니다"));
            else if (!itemGroups.contains(grp)) errors.add(rowMsg(row, lbl + "허용되지 않은 품목그룹입니다: " + grp));
            if (mg != null && !matlGroups.contains(mg)) errors.add(rowMsg(row, lbl + "허용되지 않은 자재그룹입니다: " + mg));
            if (imp == null) errors.add(rowMsg(row, lbl + "손익영향(백만원)이 비어 있습니다"));
            nonPulp.add(PurchaseNonPulpImpact.builder().ym(ym).division(div).itemGroup(grp).matlGroupNm(mg)
                    .itemName(cut(str(n.get("itemName")), 200)).content(cut(str(n.get("content")), 1000))
                    .impactMkrw(imp).note(cut(str(n.get("note")), 1000)).excelRowNo(row).build());
        }

        if (pulp.isEmpty() && nonPulp.isEmpty() && errors.isEmpty()) errors.add("업로드할 데이터가 없습니다");
        res.put("startYm", startYm);
        if (!errors.isEmpty()) {
            res.put("ok", false);
            res.put("errors", errors);
            return res;
        }

        // ── 계산 미리 돌려서 경고 수집 (마이너스 기말 등) ──
        compute(startYm, pulp, warnings);

        // ── 같은 시작월 기존 업로드 ──
        List<PurchasePlanVersion> existing = versionRepo.findByStartYmAndStatus(startYm, PurchasePlanVersion.ACTIVE);
        boolean replace = Boolean.TRUE.equals(body.get("replace"));
        if (!existing.isEmpty() && !replace) {
            res.put("ok", false);
            res.put("needConfirm", true);
            res.put("existing", versionInfo(existing.get(0)));
            res.put("warnings", warnings);
            return res;
        }
        for (PurchasePlanVersion e : existing) { e.markReplaced(); versionRepo.save(e); }

        PurchasePlanVersion v = versionRepo.save(PurchasePlanVersion.builder().startYm(startYm).endYm(months.get(2))
                .writeDate(writeDate).fileName(cut(str(body.get("fileName")), 255)).build());
        List<PurchasePulpPlan> pulpSaved = new ArrayList<>();
        for (PurchasePulpPlan p : pulp) pulpSaved.add(withVersion(p, v.getVersionId()));
        List<PurchaseNonPulpImpact> npSaved = new ArrayList<>();
        for (PurchaseNonPulpImpact n : nonPulp) npSaved.add(withVersion(n, v.getVersionId()));
        pulpRepo.saveAll(pulpSaved);
        nonPulpRepo.saveAll(npSaved);
        v.changeStats(pulpSaved.size(), npSaved.size(), String.join("\n", warnings));
        versionRepo.save(v);

        res.put("ok", true);
        res.put("version", versionInfo(v));
        res.put("replaced", existing.size());
        res.put("warnings", warnings);
        return res;
    }

    private static String cut(String s, int n) { return s == null ? null : (s.length() > n ? s.substring(0, n) : s); }

    private static PurchasePulpPlan withVersion(PurchasePulpPlan p, Long vid) {
        return PurchasePulpPlan.builder().versionId(vid).ym(p.getYm()).division(p.getDivision()).materialCode(p.getMaterialCode())
                .materialName(p.getMaterialName()).matlGroupNm(p.getMatlGroupNm()).inQtyTon(p.getInQtyTon())
                .moveInQtyTon(p.getMoveInQtyTon()).payCurrency(p.getPayCurrency()).unitPriceFc(p.getUnitPriceFc())
                .offerMonth(p.getOfferMonth()).inAmountMkrw(p.getInAmountMkrw()).outQtyTon(p.getOutQtyTon())
                .note(p.getNote()).excelRowNo(p.getExcelRowNo()).build();
    }

    private static PurchaseNonPulpImpact withVersion(PurchaseNonPulpImpact n, Long vid) {
        return PurchaseNonPulpImpact.builder().versionId(vid).ym(n.getYm()).division(n.getDivision()).itemGroup(n.getItemGroup())
                .matlGroupNm(n.getMatlGroupNm()).itemName(n.getItemName()).content(n.getContent())
                .impactMkrw(n.getImpactMkrw()).note(n.getNote()).excelRowNo(n.getExcelRowNo()).build();
    }

    // ================================================================ SAP 기초재고

    private static final class Opening {
        double qtyTon, amtWon, outQtyTon, outAmtWon;
        String name;
    }

    /** SAP 수불부 calmonth 기말 → 사업부 × 자재 (톤, 원). 단위 KG/TO 만 처리 */
    private Map<String, Opening> loadSapClosing(String calmonth, List<String> warnings, Map<String, Object> basis) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT PLANT, MATERIAL, MATERIAL_NM, BASE_UOM, BIC_ZLBKUM60 AS OUTQ, BIC_ZRNETPR60 AS OUTP," +
                " BIC_ZLBKUM101 AS ENDQ, BIC_ZRNETP110 AS ENDP FROM rpsim_raw_inventory" +
                " WHERE CALMONTH = ? AND DELETED_YN = 'N' AND " + PULP_COND, calmonth);
        Map<String, Opening> out = new HashMap<>();
        double skippedP500 = 0;
        Set<String> badUom = new TreeSet<>();
        for (Map<String, Object> r : rows) {
            String plant = str(r.get("PLANT"));
            String div = plantToDivision(plant);
            double endQ = r.get("ENDQ") == null ? 0 : ((Number) r.get("ENDQ")).doubleValue();
            String uom = str(r.get("BASE_UOM"));
            double qf, pf; // 수량 → 톤, 단가 → 원/톤
            String u = uom == null ? "" : uom.toUpperCase();
            if (u.equals("KG")) { qf = 0.001; pf = 1000; }
            else if (u.equals("TO") || u.equals("TON") || u.equals("T")) { qf = 1; pf = 1; }
            else { if (Math.abs(endQ) > EPS) badUom.add(stripCode(r.get("MATERIAL")) + "(" + (uom == null ? "단위 없음" : uom) + ")"); continue; }
            if (div == null) { skippedP500 += endQ * qf; continue; }
            String key = div + "|" + stripCode(r.get("MATERIAL"));
            Opening o = out.computeIfAbsent(key, k -> new Opening());
            o.name = str(r.get("MATERIAL_NM"));
            double endP = r.get("ENDP") == null ? 0 : ((Number) r.get("ENDP")).doubleValue();
            double outQ = r.get("OUTQ") == null ? 0 : ((Number) r.get("OUTQ")).doubleValue();
            double outP = r.get("OUTP") == null ? 0 : ((Number) r.get("OUTP")).doubleValue();
            o.qtyTon += endQ * qf;
            o.amtWon += endQ * qf * endP * pf;
            o.outQtyTon += outQ * qf;
            o.outAmtWon += outQ * qf * outP * pf;
        }
        basis.put("sapMonth", calmonth);
        basis.put("sapRows", rows.size());
        if (rows.isEmpty()) warnings.add("SAP 수불부 " + ymDot(calmonth) + " 펄프 데이터가 없습니다 — 기초재고 0으로 계산 (인터페이스 원부자재 수불부 수신 필요)");
        if (skippedP500 > EPS) warnings.add("P500(음성) 등 대상 외 공장 펄프 기말 " + String.format("%,.3f", skippedP500) + "톤은 구매 이동계획에서 제외했습니다");
        if (!badUom.isEmpty()) warnings.add("단위를 알 수 없는 SAP 기말재고는 제외했습니다 (KG/TO만 처리): " + String.join(", ", badUom));
        if (!rows.isEmpty()) warnings.add("기초재고 금액 = SAP 기말수량 × 기말단가(원/kg 정수) — 구매팀 파일과 반올림 차이가 날 수 있습니다");
        return out;
    }

    // ================================================================ 계산 엔진

    /** 사업부 × 자재 × 월 계산 결과 */
    public static final class Cell {
        String div, code, name, ym;
        double openQty, openAmt, purchaseQty, purchaseAmt, moveInQty, moveInAmt, moveOutQty, outQty, useQty, outAmt, endQty, endAmt;
        Double avgPrice, prevPrice, baseAvg;
        double impactWon;
        String purchaseAmtBasis; // INPUT / CALC / MISSING_RATE / MISSING_INCIDENTAL / NONE
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("division", div); m.put("materialCode", code); m.put("materialName", name); m.put("ym", ym);
            m.put("openQty", r(openQty, 3)); m.put("openAmtWon", r(openAmt, 0));
            m.put("purchaseQty", r(purchaseQty, 3)); m.put("purchaseAmtWon", r(purchaseAmt, 0)); m.put("purchaseAmtBasis", purchaseAmtBasis);
            m.put("moveInQty", r(moveInQty, 3)); m.put("moveInAmtWon", r(moveInAmt, 0));
            m.put("outQty", r(outQty, 3)); m.put("moveOutQty", r(moveOutQty, 3)); m.put("useQty", r(useQty, 3));
            m.put("avgPrice", r(avgPrice, 0)); m.put("prevPrice", r(prevPrice, 0)); m.put("outAmtWon", r(outAmt, 0));
            m.put("endQty", r(endQty, 3)); m.put("endAmtWon", r(endAmt, 0)); m.put("impactWon", r(impactWon, 0));
            return m;
        }
    }

    public static final class Calc {
        List<String> months;
        Map<String, Cell> cells = new LinkedHashMap<>(); // div|code|ym
        Map<String, Object> openingBasis = new LinkedHashMap<>();
        List<Map<String, Object>> ledgerOut() {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Cell c : cells.values()) out.add(c.toMap());
            return out;
        }
        Map<String, Double> impactByDivMonth() {
            Map<String, Double> m = new TreeMap<>();
            for (Cell c : cells.values()) m.merge(c.div + "|" + c.ym, c.impactWon, Double::sum);
            m.replaceAll((k, v) -> r(v, 0));
            return m;
        }
    }

    public Calc compute(String startYm, List<PurchasePulpPlan> rows, List<String> warnings) {
        Calc c = new Calc();
        c.months = List.of(startYm, addMonths(startYm, 1), addMonths(startYm, 2));
        Map<String, Opening> opening = loadSapClosing(addMonths(startYm, -1), warnings, c.openingBasis);

        // 기준정보
        Map<String, Boolean> baseCur = new HashMap<>();
        for (PurchaseCurrency cur : currencyRepo.findAll()) baseCur.put(cur.getCurrencyCode(), "Y".equals(cur.getBaseYn()));
        Map<String, Double> fx = new HashMap<>();
        for (PurchaseExchangeRate x : rateRepo.findByYmIn(c.months)) fx.put(x.getYm() + "|" + x.getCurrencyCode(), d(x.getRate()));
        Set<Integer> years = new HashSet<>();
        for (String m : c.months) years.add(Integer.parseInt(m.substring(0, 4)));
        Map<String, Double> inc = new HashMap<>();
        for (PurchaseIncidentalRate x : incidentalRepo.findByYearIn(years)) inc.put(x.getYear() + "|" + x.getMaterialCode(), d(x.getRate()));

        // 입력 행
        Map<String, PurchasePulpPlan> plan = new HashMap<>();
        Map<String, String> names = new LinkedHashMap<>(); // div|code → name (표시 순서 = 엑셀 순서)
        for (PurchasePulpPlan p : rows) {
            plan.put(p.getDivision() + "|" + p.getMaterialCode() + "|" + p.getYm(), p);
            names.putIfAbsent(p.getDivision() + "|" + p.getMaterialCode(), p.getMaterialName());
        }
        // 이동이 있으면 보내는 쪽 키도 계산 대상 (출고 행이 없더라도 기초재고 단가 필요)
        for (PurchasePulpPlan p : rows)
            if (p.getMoveInQtyTon() != null && p.getMoveInQtyTon().signum() > 0)
                names.putIfAbsent(opposite(p.getDivision()) + "|" + p.getMaterialCode(), p.getMaterialName());

        Map<String, double[]> state = new HashMap<>(); // key → {qty, amt}
        Map<String, Double> lastPrice = new HashMap<>();
        for (String key : names.keySet()) {
            Opening o = opening.get(key);
            state.put(key, new double[]{o == null ? 0 : o.qtyTon, o == null ? 0 : o.amtWon});
            if (o != null) {
                if (o.outQtyTon > EPS) lastPrice.put(key, o.outAmtWon / o.outQtyTon);
                else if (o.qtyTon > EPS) lastPrice.put(key, o.amtWon / o.qtyTon);
                if (names.get(key) == null) names.put(key, o.name);
            }
        }
        Set<String> warned = new HashSet<>();

        for (String ym : c.months) {
            int year = Integer.parseInt(ym.substring(0, 4));
            Map<String, Cell> month = new LinkedHashMap<>();
            // 1) 기초 + 구매분
            for (String key : names.keySet()) {
                String[] k = key.split("\\|");
                PurchasePulpPlan p = plan.get(key + "|" + ym);
                Cell cell = new Cell();
                cell.div = k[0]; cell.code = k[1]; cell.name = names.get(key); cell.ym = ym;
                double[] st = state.get(key);
                cell.openQty = st[0]; cell.openAmt = st[1];
                double in = p == null ? 0 : d(p.getInQtyTon());
                cell.moveInQty = p == null ? 0 : d(p.getMoveInQtyTon());
                cell.purchaseQty = Math.max(0, in - cell.moveInQty);
                cell.outQty = p == null ? 0 : d(p.getOutQtyTon());
                cell.purchaseAmtBasis = "NONE";
                if (p != null && p.getInAmountMkrw() != null) {
                    cell.purchaseAmt = d(p.getInAmountMkrw()) * 1_000_000d;
                    cell.purchaseAmtBasis = "INPUT";
                } else if (cell.purchaseQty > EPS && p != null) {
                    String cur = p.getPayCurrency();
                    Double rate = Boolean.TRUE.equals(baseCur.get(cur)) ? Double.valueOf(1d) : fx.get(ym + "|" + cur);
                    Double ir = inc.get(year + "|" + cell.code);
                    if (rate == null) {
                        cell.purchaseAmtBasis = "MISSING_RATE";
                        if (warned.add("fx|" + ym + "|" + cur)) warnings.add(ymDot(ym) + " " + cur + " 이동계획 환율이 등록되지 않았습니다 — 해당 구매 금액 0으로 계산");
                    } else if (ir == null) {
                        cell.purchaseAmtBasis = "MISSING_INCIDENTAL";
                        if (warned.add("inc|" + year + "|" + cell.code)) warnings.add(year + "년 " + cell.code + " " + (cell.name == null ? "" : cell.name) + " 부대비율이 등록되지 않았습니다 — 해당 구매 금액 0으로 계산");
                    } else {
                        cell.purchaseAmt = cell.purchaseQty * d(p.getUnitPriceFc()) * ir * rate;
                        cell.purchaseAmtBasis = "CALC";
                    }
                }
                double q = cell.openQty + cell.purchaseQty;
                cell.baseAvg = q > EPS ? (cell.openAmt + cell.purchaseAmt) / q : null;
                month.put(key, cell);
            }
            // 2) 이동분 — 보내는 쪽 (기초 + 구매) 평균단가
            for (Cell cell : month.values()) {
                if (cell.moveInQty <= EPS) continue;
                Cell sender = month.get(opposite(cell.div) + "|" + cell.code);
                if (sender == null || sender.baseAvg == null) {
                    warnings.add("[" + ymDot(ym) + "] " + cell.div + " " + cell.code + " 이동분 " + String.format("%,.3f", cell.moveInQty)
                            + "톤 — 보내는 사업부(" + opposite(cell.div) + ")에 재고·구매가 없어 단가를 정할 수 없습니다 — 금액 0으로 계산");
                } else {
                    cell.moveInAmt = cell.moveInQty * sender.baseAvg;
                    if (sender.moveInQty > EPS && warned.add("both|" + ym + "|" + cell.code))
                        warnings.add("[" + ymDot(ym) + "] " + cell.code + " 같은 달 PS↔HL 양방향 이동 — 이동 단가는 각 사업부의 (기초 + 구매) 평균으로 계산했습니다");
                }
                if (sender != null) sender.moveOutQty += cell.moveInQty;
            }
            // 3) 출고단가·기말·손익영향
            for (Map.Entry<String, Cell> e : month.entrySet()) {
                String key = e.getKey();
                Cell cell = e.getValue();
                double tq = cell.openQty + cell.purchaseQty + cell.moveInQty;
                double ta = cell.openAmt + cell.purchaseAmt + cell.moveInAmt;
                cell.avgPrice = tq > EPS ? ta / tq : null;
                cell.useQty = cell.outQty - cell.moveOutQty;
                if (cell.outQty > EPS && cell.avgPrice == null)
                    warnings.add("[" + ymDot(ym) + "] " + cell.div + " " + cell.code + " 기초재고·입고 없이 출고 " + String.format("%,.3f", cell.outQty) + "톤 — 출고금액 0");
                cell.outAmt = cell.avgPrice == null ? 0 : cell.outQty * cell.avgPrice;
                cell.endQty = tq - cell.outQty;
                cell.endAmt = ta - cell.outAmt;
                if (cell.endQty < -0.0005)
                    warnings.add("[" + ymDot(ym) + "] " + cell.div + " " + cell.code + " " + (cell.name == null ? "" : cell.name)
                            + " 기말재고가 마이너스입니다 (" + String.format("%,.3f", cell.endQty) + "톤)");
                cell.prevPrice = lastPrice.get(key);
                if (cell.prevPrice != null && cell.avgPrice != null && cell.useQty > EPS)
                    cell.impactWon = (cell.prevPrice - cell.avgPrice) * cell.useQty;
                if (cell.avgPrice != null) lastPrice.put(key, cell.avgPrice);
                state.put(key, new double[]{cell.endQty, cell.endAmt});
                c.cells.put(key + "|" + ym, cell);
            }
        }
        return c;
    }
}
