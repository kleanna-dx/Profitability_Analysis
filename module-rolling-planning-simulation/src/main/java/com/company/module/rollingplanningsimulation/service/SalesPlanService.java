package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * 판매계획 — 표준 양식(한 줄 = 한 건) 업로드 검증·저장 / 버전 / 조회
 *
 * <ul>
 *   <li>허용 값(판매구분·제품유형·국가·지종)은 모두 기준정보(rpsim_sales_code / rpsim_sales_grade)에서 읽는다
 *       → 새 제품유형·지종·국가는 화면에서 기준정보에 추가만 하면 됨 (소스 수정 없음)</li>
 *   <li>기준정보에 없거나 미사용인 값은 업로드 거부 (행 번호와 함께 오류)</li>
 *   <li>버전은 사업부별. 같은 사업부·같은 시작월 사용중 버전이 있으면 확인 후 교체</li>
 *   <li>국가별 시트는 '국가 입력' 판매구분만 — 지종 합계와 국가 합계가 다르면 경고</li>
 *   <li>금액·단가는 받지 않음 (원가 중심 — 판매량만)</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class SalesPlanService {

    public static final String SALES_TYPE = "SALES_TYPE";
    public static final String PRODUCT_TYPE = "PRODUCT_TYPE";
    public static final String COUNTRY = "COUNTRY";
    public static final List<String> CODE_TYPES = List.of(SALES_TYPE, PRODUCT_TYPE, COUNTRY);
    private static final double EPS = 1e-6;

    private final SalesCodeRepository codeRepo;
    private final SalesGradeRepository gradeRepo;
    private final SalesPlanVersionRepository versionRepo;
    private final SalesPlanRepository planRepo;
    private final SalesPlanCountryRepository countryRepo;

    // ================================================================ 공통

    private static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    private static String cut(String s, int n) { return s == null ? null : (s.length() > n ? s.substring(0, n) : s); }
    private static String ymDot(String ym) { return ym == null || ym.length() != 6 ? String.valueOf(ym) : ym.substring(0, 4) + "." + ym.substring(4); }
    private static String rowMsg(String sheet, Object row, String msg) { return sheet + " " + (row == null ? "?" : row) + "행: " + msg; }

    public static String normDivision(Object v) {
        String d = str(v);
        if (d == null) throw new IllegalArgumentException("사업부를 선택하세요");
        d = d.toUpperCase();
        if (!PurchasePlanService.DIVISIONS.contains(d)) throw new IllegalArgumentException("사업부는 PS/HL 중 하나여야 합니다: " + d);
        return d;
    }

    private static BigDecimal num(Object o) {
        String s = str(o);
        if (s == null) return null;
        try { return new BigDecimal(s.replace(",", "")); } catch (NumberFormatException e) { return null; }
    }

    // ================================================================ 기준정보 (양식 드롭다운·검증용)

    /** 사용중 코드 (유형별) + 사업부 지종 */
    public Map<String, Object> masters(String divisionRaw) {
        String division = normDivision(divisionRaw);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("division", division);
        for (String t : CODE_TYPES) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (SalesCode c : codeRepo.findByCodeTypeOrderBySortOrderAscCodeNameAsc(t)) {
                if (!"Y".equals(c.getUseYn())) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("name", c.getCodeName());
                if (SALES_TYPE.equals(t)) m.put("countryYn", c.getCountryYn());
                list.add(m);
            }
            res.put(t, list);
        }
        List<Map<String, Object>> grades = new ArrayList<>();
        for (SalesGrade g : gradeRepo.findByDivisionOrderBySortOrderAscGradeNameAsc(division)) {
            if (!"Y".equals(g.getUseYn())) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("productType", g.getProductType());
            m.put("gradeName", g.getGradeName());
            m.put("prodProduct", g.getProdProduct());
            grades.add(m);
        }
        res.put("grades", grades);
        return res;
    }

    // ================================================================ 버전 조회

    public List<Map<String, Object>> versions(String divisionRaw) {
        String division = normDivision(divisionRaw);
        List<Map<String, Object>> out = new ArrayList<>();
        for (SalesPlanVersion v : versionRepo.findByDivisionOrderByVersionIdDesc(division)) out.add(versionInfo(v));
        return out;
    }

    private Map<String, Object> versionInfo(SalesPlanVersion v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("versionId", v.getVersionId());
        m.put("division", v.getDivision());
        m.put("startYm", v.getStartYm());
        m.put("endYm", v.getEndYm());
        m.put("writeDate", v.getWriteDate() == null ? null : v.getWriteDate().toString());
        m.put("fileName", v.getFileName());
        m.put("status", v.getStatus());
        m.put("gradeRows", v.getGradeRows());
        m.put("countryRows", v.getCountryRows());
        m.put("warnings", v.getWarnings() == null || v.getWarnings().isBlank() ? List.of() : List.of(v.getWarnings().split("\n")));
        m.put("createdBy", v.getCreatedBy());
        m.put("createdAt", v.getCreatedAt() == null ? null : v.getCreatedAt().toString());
        return m;
    }

    private static Map<String, Object> planOut(SalesPlan p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ym", p.getYm());
        m.put("salesType", p.getSalesType());
        m.put("productType", p.getProductType());
        m.put("gradeName", p.getGradeName());
        m.put("qtyTon", p.getQtyTon());
        m.put("note", p.getNote());
        m.put("excelRowNo", p.getExcelRowNo());
        return m;
    }

    private static Map<String, Object> countryOut(SalesPlanCountry p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ym", p.getYm());
        m.put("salesType", p.getSalesType());
        m.put("country", p.getCountry());
        m.put("qtyTon", p.getQtyTon());
        m.put("note", p.getNote());
        m.put("excelRowNo", p.getExcelRowNo());
        return m;
    }

    /** 버전 상세: 입력 행 + 국가별 행 (피벗은 화면에서) */
    public Map<String, Object> detail(Long versionId) {
        SalesPlanVersion v = versionRepo.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("판매계획 버전을 찾을 수 없습니다: " + versionId));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("version", versionInfo(v));
        res.put("rows", planRepo.findByVersionIdOrderByExcelRowNoAsc(versionId).stream().map(SalesPlanService::planOut).toList());
        res.put("countries", countryRepo.findByVersionIdOrderByExcelRowNoAsc(versionId).stream().map(SalesPlanService::countryOut).toList());
        return res;
    }

    @Transactional
    public void deleteVersion(Long versionId, String user) {
        SalesPlanVersion v = versionRepo.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("판매계획 버전을 찾을 수 없습니다: " + versionId));
        for (SalesPlan p : planRepo.findByVersionIdOrderByExcelRowNoAsc(versionId)) p.softDelete(user);
        for (SalesPlanCountry p : countryRepo.findByVersionIdOrderByExcelRowNoAsc(versionId)) p.softDelete(user);
        v.softDelete(user);
        versionRepo.save(v);
    }

    /** 기준월 판매계획 (다른 계산에서 사용) — 해당 월을 포함하는 사용중 버전 중 시작월이 가장 늦은 것. 없으면 found=false */
    public Map<String, Object> current(String ymRaw, String divisionRaw) {
        String ym = PurchasePlanService.normYm(ymRaw);
        if (ym == null) throw new IllegalArgumentException("기준월 형식이 올바르지 않습니다 (yyyy.mm): " + ymRaw);
        String division = normDivision(divisionRaw);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ym", ym);
        res.put("division", division);
        Optional<SalesPlanVersion> ov = versionRepo
                .findFirstByDivisionAndStatusAndStartYmLessThanEqualAndEndYmGreaterThanEqualOrderByStartYmDescVersionIdDesc(
                        division, SalesPlanVersion.ACTIVE, ym, ym);
        if (ov.isEmpty()) {
            res.put("found", false);
            res.put("warnings", List.of(division + " " + ymDot(ym) + " 판매계획이 없습니다 — 판매량 0으로 계산"));
            return res;
        }
        SalesPlanVersion v = ov.get();
        res.put("found", true);
        res.put("version", versionInfo(v));
        res.put("rows", planRepo.findByVersionIdAndYmOrderByExcelRowNoAsc(v.getVersionId(), ym).stream().map(SalesPlanService::planOut).toList());
        res.put("countries", countryRepo.findByVersionIdAndYmOrderByExcelRowNoAsc(v.getVersionId(), ym).stream().map(SalesPlanService::countryOut).toList());
        return res;
    }

    // ================================================================ 업로드

    /**
     * body: {division, writeDate, fileName, replace,
     *        rows:[{row, ym, salesType, productType, gradeName, qty, note}],
     *        countries:[{row, ym, salesType, country, qty, note}]}
     * 반환: ok=false + errors (저장 안 함) / needConfirm=true (같은 시작월 사용중 버전 있음) / ok=true + warnings
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> upload(Map<String, Object> body) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Map<String, Object> res = new LinkedHashMap<>();

        String division = normDivision(body.get("division"));
        LocalDate writeDate = null;
        if (str(body.get("writeDate")) != null) {
            try { writeDate = LocalDate.parse(str(body.get("writeDate")).replace(".", "-").replace("/", "-")); }
            catch (Exception e) { errors.add("기본정보: 작성일 형식이 올바르지 않습니다 (yyyy-mm-dd): " + body.get("writeDate")); }
        }

        // ── 기준정보 (사용중 / 미사용 구분 — 미사용은 '미사용' 오류) ──
        Map<String, Map<String, SalesCode>> codes = new HashMap<>();
        for (String t : CODE_TYPES) codes.put(t, new HashMap<>());
        for (SalesCode c : codeRepo.findAllByOrderByCodeTypeAscSortOrderAscCodeNameAsc())
            if (codes.containsKey(c.getCodeType())) codes.get(c.getCodeType()).put(c.getCodeName(), c);
        Map<String, SalesGrade> grades = new HashMap<>();
        for (SalesGrade g : gradeRepo.findByDivisionOrderBySortOrderAscGradeNameAsc(division)) grades.put(g.getProductType() + "|" + g.getGradeName(), g);
        // 기준정보에 없는 값 (화면에서 확인 후 일괄 등록용)
        Map<String, LinkedHashSet<String>> missing = new LinkedHashMap<>();
        for (String t : CODE_TYPES) missing.put(t, new LinkedHashSet<>());
        LinkedHashSet<String> missingGrades = new LinkedHashSet<>();
        Set<String> countrySalesTypes = new HashSet<>();

        // ── 판매계획 시트 ──
        List<Map<String, Object>> rows = body.get("rows") instanceof List ? (List<Map<String, Object>>) body.get("rows") : List.of();
        List<SalesPlan> plans = new ArrayList<>();
        Map<String, Integer> seen = new HashMap<>();
        Map<String, Double> gradeSum = new TreeMap<>(); // ym|salesType → 합계 (국가별 비교용)
        TreeSet<String> yms = new TreeSet<>();
        for (Map<String, Object> r : rows) {
            Object row = r.get("row");
            String sh = "판매계획";
            String ym = PurchasePlanService.normYm(r.get("ym"));
            String st = str(r.get("salesType")), pt = str(r.get("productType")), gn = str(r.get("gradeName"));
            BigDecimal qty = num(r.get("qty"));
            int before = errors.size();
            if (ym == null) errors.add(rowMsg(sh, row, "년월 형식이 올바르지 않습니다 (yyyy.mm): " + (r.get("ym") == null ? "(빈칸)" : r.get("ym"))));
            checkCode(errors, missing.get(SALES_TYPE), sh, row, codes.get(SALES_TYPE), st, "판매구분");
            checkCode(errors, missing.get(PRODUCT_TYPE), sh, row, codes.get(PRODUCT_TYPE), pt, "제품유형");
            if (gn == null) errors.add(rowMsg(sh, row, "지종이 비어 있습니다"));
            else if (pt != null) {
                SalesGrade g = grades.get(pt + "|" + gn);
                if (g == null) {
                    // DB 정렬규칙(utf8mb4_general_ci)은 대소문자를 구분하지 않음 → 대소문자만 다르면 새로 등록하지 않고 오류로 안내
                    String lk = (pt + "|" + gn).toLowerCase();
                    SalesGrade near = grades.entrySet().stream().filter(en -> en.getKey().toLowerCase().equals(lk)).map(Map.Entry::getValue).findFirst().orElse(null);
                    if (near != null) errors.add(rowMsg(sh, row, "지종 대소문자가 기준정보와 다릅니다: '" + gn + "' → '" + near.getGradeName() + "' 로 고쳐 주세요"));
                    else { errors.add(rowMsg(sh, row, division + " 판매 지종 기준정보에 없는 지종입니다: " + pt + " / " + gn + " ([판매 지종] 탭에서 등록)")); missingGrades.add(pt + "|" + gn); }
                }
                else if (!"Y".equals(g.getUseYn())) errors.add(rowMsg(sh, row, "미사용 지종입니다: " + pt + " / " + gn));
            }
            if (str(r.get("qty")) == null) errors.add(rowMsg(sh, row, "판매량(톤)이 비어 있습니다"));
            else if (qty == null) errors.add(rowMsg(sh, row, "판매량이 숫자가 아닙니다: " + r.get("qty")));
            else if (qty.signum() < 0) errors.add(rowMsg(sh, row, "판매량은 0 이상이어야 합니다: " + qty));
            if (errors.size() > before) continue;
            String key = ym + "|" + st + "|" + pt + "|" + gn;
            if (seen.containsKey(key)) {
                Integer dup = seen.get(key);
                errors.add(rowMsg(sh, row, "같은 년월·판매구분·제품유형·지종이 이미 있습니다 (" + ymDot(ym) + " " + st + " " + pt + " " + gn + (dup != null ? ", " + dup + "행" : "") + ") — 한 줄로 합쳐 주세요"));
                continue;
            }
            seen.put(key, row instanceof Number ? ((Number) row).intValue() : null);
            yms.add(ym);
            gradeSum.merge(ym + "|" + st, qty.doubleValue(), Double::sum);
            plans.add(SalesPlan.builder().ym(ym).division(division).salesType(st).productType(pt).gradeName(gn)
                    .qtyTon(qty).note(cut(str(r.get("note")), 500)).excelRowNo(row instanceof Number ? ((Number) row).intValue() : null).build());
        }

        // ── 국가별 시트 ──
        List<Map<String, Object>> crows = body.get("countries") instanceof List ? (List<Map<String, Object>>) body.get("countries") : List.of();
        List<SalesPlanCountry> cplans = new ArrayList<>();
        Set<String> cseen = new HashSet<>();
        Map<String, Double> countrySum = new TreeMap<>();
        for (Map<String, Object> r : crows) {
            Object row = r.get("row");
            String sh = "국가별";
            String ym = PurchasePlanService.normYm(r.get("ym"));
            String st = str(r.get("salesType")), ct = str(r.get("country"));
            BigDecimal qty = num(r.get("qty"));
            int before = errors.size();
            if (ym == null) errors.add(rowMsg(sh, row, "년월 형식이 올바르지 않습니다 (yyyy.mm): " + (r.get("ym") == null ? "(빈칸)" : r.get("ym"))));
            checkCode(errors, missing.get(SALES_TYPE), sh, row, codes.get(SALES_TYPE), st, "판매구분");
            if (st != null) countrySalesTypes.add(st);
            if (st != null && codes.get(SALES_TYPE).containsKey(st) && !"Y".equals(codes.get(SALES_TYPE).get(st).getCountryYn()))
                errors.add(rowMsg(sh, row, "국가 입력 대상이 아닌 판매구분입니다: " + st + " ([판매 코드] 탭에서 '국가 입력'을 켜세요)"));
            checkCode(errors, missing.get(COUNTRY), sh, row, codes.get(COUNTRY), ct, "국가");
            if (str(r.get("qty")) == null) errors.add(rowMsg(sh, row, "판매량(톤)이 비어 있습니다"));
            else if (qty == null) errors.add(rowMsg(sh, row, "판매량이 숫자가 아닙니다: " + r.get("qty")));
            else if (qty.signum() < 0) errors.add(rowMsg(sh, row, "판매량은 0 이상이어야 합니다: " + qty));
            if (errors.size() > before) continue;
            String key = ym + "|" + st + "|" + ct;
            if (!cseen.add(key)) { errors.add(rowMsg(sh, row, "같은 년월·판매구분·국가가 이미 있습니다 (" + ymDot(ym) + " " + st + " " + ct + ") — 한 줄로 합쳐 주세요")); continue; }
            yms.add(ym);
            countrySum.merge(ym + "|" + st, qty.doubleValue(), Double::sum);
            cplans.add(SalesPlanCountry.builder().ym(ym).division(division).salesType(st).country(ct).qtyTon(qty)
                    .note(cut(str(r.get("note")), 500)).excelRowNo(row instanceof Number ? ((Number) row).intValue() : null).build());
        }

        if (plans.isEmpty() && errors.isEmpty()) errors.add("판매계획 시트에 업로드할 데이터가 없습니다");
        if (!errors.isEmpty()) {
            res.put("ok", false);
            res.put("errors", errors);
            // 미등록 값 — 화면에서 사용자가 확인하면 /masters/bulk 로 등록 (자동 등록 안 함)
            List<Map<String, Object>> mc = new ArrayList<>();
            missing.forEach((t, set) -> set.forEach(n -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("codeType", t); m.put("codeName", n);
                if (SALES_TYPE.equals(t)) m.put("countryYn", countrySalesTypes.contains(n) ? "Y" : "N");
                mc.add(m);
            }));
            List<Map<String, Object>> mg = new ArrayList<>();
            for (String k : missingGrades) { String[] p = k.split("\\|", 2); mg.add(new LinkedHashMap<>(Map.of("productType", p[0], "gradeName", p[1]))); }
            if (!mc.isEmpty() || !mg.isEmpty()) {
                Map<String, Object> miss = new LinkedHashMap<>();
                miss.put("division", division); miss.put("codes", mc); miss.put("grades", mg);
                res.put("missing", miss);
            }
            return res;
        }

        // ── 경고: 국가 합계 vs 지종 합계 (국가 입력 판매구분) ──
        for (SalesCode st : codes.get(SALES_TYPE).values()) {
            if (!"Y".equals(st.getCountryYn())) continue;
            for (String ym : yms) {
                String k = ym + "|" + st.getCodeName();
                double g = gradeSum.getOrDefault(k, 0d), c = countrySum.getOrDefault(k, 0d);
                if (g < EPS && c < EPS) continue;
                if (c < EPS) warnings.add(ymDot(ym) + " " + st.getCodeName() + ": 국가별 판매량이 없습니다 (지종 합계 " + String.format("%,.3f", g) + "톤)");
                else if (Math.abs(g - c) > 0.001)
                    warnings.add(ymDot(ym) + " " + st.getCodeName() + ": 지종 합계 " + String.format("%,.3f", g) + "톤 ≠ 국가 합계 " + String.format("%,.3f", c) + "톤 (차이 " + String.format("%,.3f", g - c) + ")");
            }
        }
        // 빈 달 경고 (시작~끝 사이 빠진 달)
        String startYm = yms.first(), endYm = yms.last();
        for (String m = startYm; m.compareTo(endYm) < 0; ) {
            m = PurchasePlanService.addMonths(m, 1);
            if (!yms.contains(m)) warnings.add(ymDot(m) + " 판매계획이 없습니다 — 이 달 판매량은 0으로 계산됩니다");
        }

        // ── 같은 사업부·시작월 사용중 버전 ──
        List<SalesPlanVersion> existing = versionRepo.findByDivisionAndStartYmAndStatus(division, startYm, SalesPlanVersion.ACTIVE);
        boolean replace = Boolean.TRUE.equals(body.get("replace"));
        res.put("startYm", startYm);
        res.put("endYm", endYm);
        if (!existing.isEmpty() && !replace) {
            res.put("ok", false);
            res.put("needConfirm", true);
            res.put("existing", versionInfo(existing.get(0)));
            res.put("warnings", warnings);
            return res;
        }
        for (SalesPlanVersion e : existing) { e.markReplaced(); versionRepo.save(e); }

        SalesPlanVersion v = versionRepo.save(SalesPlanVersion.builder().division(division).startYm(startYm).endYm(endYm)
                .writeDate(writeDate).fileName(cut(str(body.get("fileName")), 255)).build());
        List<SalesPlan> ps = new ArrayList<>();
        for (SalesPlan p : plans) ps.add(SalesPlan.builder().versionId(v.getVersionId()).ym(p.getYm()).division(division)
                .salesType(p.getSalesType()).productType(p.getProductType()).gradeName(p.getGradeName()).qtyTon(p.getQtyTon())
                .note(p.getNote()).excelRowNo(p.getExcelRowNo()).build());
        List<SalesPlanCountry> cs = new ArrayList<>();
        for (SalesPlanCountry p : cplans) cs.add(SalesPlanCountry.builder().versionId(v.getVersionId()).ym(p.getYm()).division(division)
                .salesType(p.getSalesType()).country(p.getCountry()).qtyTon(p.getQtyTon()).note(p.getNote()).excelRowNo(p.getExcelRowNo()).build());
        planRepo.saveAll(ps);
        countryRepo.saveAll(cs);
        v.changeStats(ps.size(), cs.size(), String.join("\n", warnings));
        versionRepo.save(v);

        res.put("ok", true);
        res.put("version", versionInfo(v));
        res.put("replaced", existing.size());
        res.put("warnings", warnings);
        return res;
    }

    private static void checkCode(List<String> errors, Set<String> missing, String sheet, Object row, Map<String, SalesCode> map, String v, String label) {
        if (v == null) { errors.add(rowMsg(sheet, row, label + "이(가) 비어 있습니다")); return; }
        SalesCode c = map.get(v);
        if (c == null) {
            // 대소문자만 다른 값은 새로 등록하지 않음 (DB 정렬규칙이 대소문자 무시 → 등록 시 기존 값을 덮어씀)
            String near = map.keySet().stream().filter(k -> k.equalsIgnoreCase(v)).findFirst().orElse(null);
            if (near != null) errors.add(rowMsg(sheet, row, label + " 대소문자가 기준정보와 다릅니다: '" + v + "' → '" + near + "' 로 고쳐 주세요"));
            else { errors.add(rowMsg(sheet, row, "판매 코드 기준정보에 없는 " + label + "입니다: " + v + " ([판매 코드] 탭에서 등록)")); missing.add(v); }
        }
        else if (!"Y".equals(c.getUseYn())) errors.add(rowMsg(sheet, row, "미사용 " + label + "입니다: " + v));
    }
}
