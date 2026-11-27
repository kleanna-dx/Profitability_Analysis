package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import com.company.module.rollingplanningsimulation.entity.HlProductionPlan;
import com.company.module.rollingplanningsimulation.entity.HlSalesClose;
import com.company.module.rollingplanningsimulation.entity.HlSalesPlan;
import com.company.module.rollingplanningsimulation.repository.HlCustomerExpenseRepository;
import com.company.module.rollingplanningsimulation.repository.HlProductionPlanRepository;
import com.company.module.rollingplanningsimulation.repository.HlMaterialMasterRepository;
import com.company.module.rollingplanningsimulation.support.HlConversion;
import com.company.module.rollingplanningsimulation.repository.UnitRepository;
import com.company.module.rollingplanningsimulation.repository.HlSalesCloseRepository;
import com.company.module.rollingplanningsimulation.repository.HlSalesPlanRepository;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.CurrentUser;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;

/**
 * HL 판매계획(SKU별)·거래처별 장려금/마케팅비·마감.
 * <ul>
 *   <li>순매출 = BOX 수량 × BOX당 단가 — 서버 계산</li>
 *   <li>판매계획 = 영업팀이 입력. 영업팀은 화면에서 고름. 업로드 파일에 다른 년월·다른 팀 행이 있으면 저장하지 않음</li>
 *   <li>장려금·마케팅비 = 기획팀이 년월 전체를 올림 (영업팀 구분 없음, 년월 × 거래처 = 1행)</li>
 *   <li>업로드 = 그 범위(판매계획: 년월·팀 / 장려금·마케팅비: 년월) 데이터를 파일 내용으로 통째 교체 (파일에 없는 행은 소프트 삭제)</li>
 *   <li>생산계획 = 현업이 년월 전체를 입력 (년월 × 생산 호기 × 자재코드 = 월 생산량 EA) 후 확정</li>
 *   <li>마감: 판매계획 = 년월·팀별 / 장려금·마케팅비·생산계획(확정) = 년월 전체. 마감되면 입력·수정·삭제·업로드 불가</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class HlSalesService {

    private final HlSalesPlanRepository planRepo;
    private final HlCustomerExpenseRepository expenseRepo;
    private final HlSalesCloseRepository closeRepo;
    private final HlProductionPlanRepository prodRepo;
    private final UnitRepository unitRepo;
    private final HlMaterialMasterRepository materialRepo;
    private final AuditSupport auditSupport;

    static final String[] UK_PLAN = {"ym", "salesTeam", "customerCode", "materialCode"};
    static final String[] UK_EXPENSE = {"ym", "customerCode"};
    static final String[] UK_PROD = {"ym", "machine", "materialCode"};
    static final List<String> CLOSE_TYPES = List.of(HlSalesClose.SALES, HlSalesClose.EXPENSE, HlSalesClose.PRODUCTION);
    public static final String HL = "HL";

    // ================================================================ 공통 검사

    static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }

    /** 숫자 (쉼표 허용). 비어 있으면 null, 숫자가 아니면 예외 */
    static BigDecimal num(Object o) {
        if (o == null) return null;
        if (o instanceof BigDecimal b) return b;
        if (o instanceof Number n) return new BigDecimal(n.toString());
        String s = o.toString().replace(",", "").trim();
        if (s.isEmpty()) return null;
        return new BigDecimal(s);
    }

    static String requireYm(Object v) {
        String ym = PurchasePlanService.normYm(v);
        if (ym == null) throw new IllegalArgumentException("년월은 YYYYMM 형식이어야 합니다: " + v);
        return ym;
    }

    static String requireTeam(Object v) {
        String t = str(v);
        if (t == null) throw new IllegalArgumentException("영업팀을 선택하세요");
        if (t.length() > 100) throw new IllegalArgumentException("영업팀은 100자 이내입니다");
        return t;
    }

    static String requireType(Object v) {
        String t = str(v);
        if (t == null || !CLOSE_TYPES.contains(t.toUpperCase(Locale.ROOT)))
            throw new IllegalArgumentException("마감 구분은 SALES(판매계획) / EXPENSE(장려금·마케팅비) / PRODUCTION(생산계획) 중 하나입니다: " + v);
        return t.toUpperCase(Locale.ROOT);
    }

    /** 검사 결과 — 오류가 하나라도 있으면 아무것도 저장하지 않음 */
    public record Checked<T>(List<T> rows, List<String> errors) {
        public boolean ok() { return errors.isEmpty(); }
    }

    /** 한 행의 년월(·영업팀)이 화면에서 고른 값과 같은지 (비어 있으면 화면 값 사용). team=null 이면 영업팀 검사 안 함 */
    private static void checkScope(Map<String, Object> r, String ym, String team, String at, List<String> errors) {
        Object rYm = r.get("ym");
        if (str(rYm) != null) {
            String n = PurchasePlanService.normYm(rYm);
            if (n == null) errors.add(at + "년월 형식 오류: " + rYm);
            else if (!n.equals(ym)) errors.add(at + "년월(" + n + ")이 선택한 년월(" + ym + ")과 다릅니다");
        }
        if (team == null) return;
        String rTeam = str(r.get("salesTeam"));
        if (rTeam != null && !rTeam.equals(team)) errors.add(at + "영업팀(" + rTeam + ")이 선택한 영업팀(" + team + ")과 다릅니다 — 다른 팀 행은 올릴 수 없습니다");
    }

    private static BigDecimal nonNegative(Object v, String label, String at, List<String> errors, boolean required) {
        BigDecimal n;
        try { n = num(v); } catch (NumberFormatException e) { errors.add(at + label + "가 숫자가 아닙니다: " + v); return null; }
        if (n == null) { if (required) errors.add(at + label + "를 입력하세요"); return null; }
        if (n.signum() < 0) { errors.add(at + label + "는 0 이상이어야 합니다: " + n.toPlainString()); return null; }
        return n;
    }

    private static String maxLen(Object v, int len, String label, String at, List<String> errors) {
        String s = str(v);
        if (s != null && s.length() > len) { errors.add(at + label + "는 " + len + "자 이내입니다"); return null; }
        return s;
    }

    private static String rowAt(Map<String, Object> r, int i) {
        Object no = r.get("rowNo");
        return (no != null ? no + "행" : (i + 1) + "번째 행") + ": ";
    }

    /** 판매계획 행 검사 */
    public static Checked<HlSalesPlan> checkPlans(String ym, String team, List<Map<String, Object>> rows) {
        List<String> errors = new ArrayList<>();
        List<HlSalesPlan> out = new ArrayList<>();
        Map<String, String> seen = new HashMap<>();
        if (rows == null) rows = List.of();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            String at = rowAt(r, i);
            int before = errors.size();
            checkScope(r, ym, team, at, errors);
            String cust = maxLen(r.get("customerCode"), 30, "거래처코드", at, errors);
            String mat = maxLen(r.get("materialCode"), 50, "자재코드", at, errors);
            if (str(r.get("customerCode")) == null) errors.add(at + "거래처코드를 입력하세요");
            if (str(r.get("materialCode")) == null) errors.add(at + "자재코드를 입력하세요");
            String custName = maxLen(r.get("customerName"), 200, "거래처명", at, errors);
            String cat = maxLen(r.get("category"), 100, "카테고리", at, errors);
            String note = maxLen(r.get("note"), 500, "비고", at, errors);
            BigDecimal qty = nonNegative(r.get("boxQty"), "BOX 수량", at, errors, true);
            BigDecimal price = nonNegative(r.get("boxPrice"), "BOX당 단가", at, errors, true);
            if (cust != null && mat != null) {
                String key = cust + "|" + mat;
                String prev = seen.putIfAbsent(key, at);
                if (prev != null) errors.add(at + "거래처 " + cust + " · 자재 " + mat + " 가 " + prev.replace(": ", "") + "과 중복입니다");
            }
            if (errors.size() == before)
                out.add(HlSalesPlan.builder().ym(ym).salesTeam(team).customerCode(cust).customerName(custName)
                        .category(cat).materialCode(mat).boxQty(qty).boxPrice(price).note(note).build());
        }
        return new Checked<>(out, errors);
    }

    /** 장려금·마케팅비 행 검사 (금액 비어 있으면 0). 영업팀 구분 없음 — 년월 × 거래처 */
    public static Checked<HlCustomerExpense> checkExpenses(String ym, List<Map<String, Object>> rows) {
        List<String> errors = new ArrayList<>();
        List<HlCustomerExpense> out = new ArrayList<>();
        Map<String, String> seen = new HashMap<>();
        if (rows == null) rows = List.of();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            String at = rowAt(r, i);
            int before = errors.size();
            checkScope(r, ym, null, at, errors);
            String cust = maxLen(r.get("customerCode"), 30, "거래처코드", at, errors);
            if (str(r.get("customerCode")) == null) errors.add(at + "거래처코드를 입력하세요");
            String custName = maxLen(r.get("customerName"), 200, "거래처명", at, errors);
            String note = maxLen(r.get("note"), 500, "비고", at, errors);
            BigDecimal inc = nonNegative(r.get("incentiveAmt"), "장려금", at, errors, false);
            BigDecimal mkt = nonNegative(r.get("marketingAmt"), "마케팅비", at, errors, false);
            if (cust != null) {
                String prev = seen.putIfAbsent(cust, at);
                if (prev != null) errors.add(at + "거래처 " + cust + " 가 " + prev.replace(": ", "") + "과 중복입니다");
            }
            if (errors.size() == before)
                out.add(HlCustomerExpense.builder().ym(ym).customerCode(cust).customerName(custName)
                        .incentiveAmt(inc).marketingAmt(mkt).note(note).build());
        }
        return new Checked<>(out, errors);
    }

    // ================================================================ 마감

    public boolean isClosed(String ym, String team, String type) {
        return closeRepo.findFirstByYmAndSalesTeamAndCloseType(ym, team, type).map(HlSalesClose::closed).orElse(false);
    }

    private void assertOpen(String ym, String team, String type) {
        if (isClosed(ym, team, type))
            throw new IllegalStateException(ym.substring(0, 4) + "." + ym.substring(4) + " "
                    + (HlSalesClose.SALES.equals(type) ? team + " 판매계획은 마감되었습니다 — 마감 해제 후 수정하세요"
                    : HlSalesClose.PRODUCTION.equals(type) ? "생산계획은 확정되었습니다 — 확정 해제 후 수정하세요"
                    : "장려금·마케팅비는 마감되었습니다 — 마감 해제 후 수정하세요"));
    }

    /** 마감 단위의 영업팀 값 — 장려금·마케팅비·생산계획은 년월 전체라 '전체' */
    static String closeTeam(String type, Object teamRaw) {
        return HlSalesClose.SALES.equals(type) ? requireTeam(teamRaw) : HlSalesClose.ALL_TEAMS;
    }

    public List<HlSalesClose> closeStatus(Object ymRaw) {
        return closeRepo.findByYmOrderBySalesTeamAsc(requireYm(ymRaw));
    }

    @Transactional
    public HlSalesClose setClosed(Object ymRaw, Object teamRaw, Object typeRaw, boolean close) {
        String ym = requireYm(ymRaw), type = requireType(typeRaw), team = closeTeam(type, teamRaw);
        HlSalesClose c = closeRepo.findFirstByYmAndSalesTeamAndCloseType(ym, team, type).orElse(null);
        if (c == null) {
            if (!close) throw new IllegalStateException(HlSalesClose.PRODUCTION.equals(type) ? "확정된 적이 없습니다" : "마감된 적이 없습니다");
            c = auditSupport.upsert(closeRepo, HlSalesClose.builder().ym(ym).salesTeam(team).closeType(type).build(),
                    "ym", "salesTeam", "closeType");
        }
        if (close) {
            if (c.closed()) throw new IllegalStateException(HlSalesClose.PRODUCTION.equals(type) ? "이미 확정되었습니다" : "이미 마감되었습니다");
            if (HlSalesClose.SALES.equals(type) && planRepo.findByYmAndSalesTeamOrderByCustomerCodeAscMaterialCodeAsc(ym, team).isEmpty())
                throw new IllegalStateException("판매계획이 한 건도 없어 마감할 수 없습니다");
            if (HlSalesClose.EXPENSE.equals(type) && expenseRepo.findByYmOrderByCustomerCodeAsc(ym).isEmpty())
                throw new IllegalStateException("장려금·마케팅비가 한 건도 없어 마감할 수 없습니다");
            if (HlSalesClose.PRODUCTION.equals(type) && prodRepo.findByYmOrderByMachineAscMaterialCodeAsc(ym).isEmpty())
                throw new IllegalStateException("생산계획이 한 건도 없어 확정할 수 없습니다");
            c.close(CurrentUser.get());
        } else {
            if (!c.closed()) throw new IllegalStateException(HlSalesClose.PRODUCTION.equals(type) ? "확정 상태가 아닙니다" : "마감 상태가 아닙니다");
            c.reopen();
        }
        return closeRepo.save(c);
    }

    // ================================================================ 판매계획

    public List<String> teams() {
        return planRepo.findTeams();
    }

    public List<HlSalesPlan> plans(Object ymRaw, Object teamRaw) {
        String ym = requireYm(ymRaw);
        String team = str(teamRaw);
        return team == null ? planRepo.findByYmOrderBySalesTeamAscCustomerCodeAscMaterialCodeAsc(ym)
                : planRepo.findByYmAndSalesTeamOrderByCustomerCodeAscMaterialCodeAsc(ym, team);
    }

    /** 화면에서 한 행 등록(id=null) 또는 수정 */
    @Transactional
    public HlSalesPlan savePlan(Long id, Map<String, Object> b) {
        String ym = requireYm(b.get("ym")), team = requireTeam(b.get("salesTeam"));
        assertOpen(ym, team, HlSalesClose.SALES);
        Checked<HlSalesPlan> c = checkPlans(ym, team, List.of(b));
        if (!c.ok()) throw new IllegalArgumentException(String.join(" / ", c.errors()).replace("1번째 행: ", ""));
        HlSalesPlan in = c.rows().get(0);
        if (id == null) return auditSupport.upsert(planRepo, in, UK_PLAN);
        HlSalesPlan e = planRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        if (!e.getYm().equals(ym) || !e.getSalesTeam().equals(team)) assertOpen(e.getYm(), e.getSalesTeam(), HlSalesClose.SALES);
        return auditSupport.updateById(planRepo, id, in, UK_PLAN);
    }

    @Transactional
    public void deletePlan(Long id) {
        HlSalesPlan e = planRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        assertOpen(e.getYm(), e.getSalesTeam(), HlSalesClose.SALES);
        auditSupport.softDelete(planRepo, id);
    }

    /** 업로드 — 그 년월·팀을 파일 내용으로 교체. 오류가 있으면 저장하지 않고 오류 목록 반환 */
    @Transactional
    public Map<String, Object> uploadPlans(Map<String, Object> body) {
        String ym = requireYm(body.get("ym")), team = requireTeam(body.get("salesTeam"));
        assertOpen(ym, team, HlSalesClose.SALES);
        @SuppressWarnings("unchecked") List<Map<String, Object>> rows = (List<Map<String, Object>>) body.get("rows");
        Checked<HlSalesPlan> c = checkPlans(ym, team, rows);
        Map<String, Object> res = new LinkedHashMap<>();
        if (!c.ok()) { res.put("ok", false); res.put("errors", c.errors()); return res; }
        if (c.rows().isEmpty()) { res.put("ok", false); res.put("errors", List.of("올릴 행이 없습니다")); return res; }

        Set<String> keep = new HashSet<>();
        for (HlSalesPlan p : c.rows()) { auditSupport.upsert(planRepo, p, UK_PLAN); keep.add(p.getCustomerCode() + "|" + p.getMaterialCode()); }
        int removed = 0;
        for (HlSalesPlan old : planRepo.findByYmAndSalesTeamOrderByCustomerCodeAscMaterialCodeAsc(ym, team))
            if (!keep.contains(old.getCustomerCode() + "|" + old.getMaterialCode())) { auditSupport.softDelete(planRepo, old.getPlanId()); removed++; }
        res.put("ok", true);
        res.put("saved", c.rows().size());
        res.put("removed", removed);
        res.put("netSales", c.rows().stream().map(HlSalesPlan::getNetSales).reduce(BigDecimal.ZERO, BigDecimal::add));
        return res;
    }

    // ================================================================ 장려금·마케팅비

    public List<HlCustomerExpense> expenses(Object ymRaw) {
        return expenseRepo.findByYmOrderByCustomerCodeAsc(requireYm(ymRaw));
    }

    @Transactional
    public HlCustomerExpense saveExpense(Long id, Map<String, Object> b) {
        String ym = requireYm(b.get("ym"));
        assertOpen(ym, HlSalesClose.ALL_TEAMS, HlSalesClose.EXPENSE);
        Checked<HlCustomerExpense> c = checkExpenses(ym, List.of(b));
        if (!c.ok()) throw new IllegalArgumentException(String.join(" / ", c.errors()).replace("1번째 행: ", ""));
        HlCustomerExpense in = c.rows().get(0);
        if (id == null) return auditSupport.upsert(expenseRepo, in, UK_EXPENSE);
        HlCustomerExpense e = expenseRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        if (!e.getYm().equals(ym)) assertOpen(e.getYm(), HlSalesClose.ALL_TEAMS, HlSalesClose.EXPENSE);
        return auditSupport.updateById(expenseRepo, id, in, UK_EXPENSE);
    }

    @Transactional
    public void deleteExpense(Long id) {
        HlCustomerExpense e = expenseRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        assertOpen(e.getYm(), HlSalesClose.ALL_TEAMS, HlSalesClose.EXPENSE);
        auditSupport.softDelete(expenseRepo, id);
    }

    /** 업로드 — 그 년월 장려금·마케팅비 전체를 파일 내용으로 교체 */
    @Transactional
    public Map<String, Object> uploadExpenses(Map<String, Object> body) {
        String ym = requireYm(body.get("ym"));
        assertOpen(ym, HlSalesClose.ALL_TEAMS, HlSalesClose.EXPENSE);
        @SuppressWarnings("unchecked") List<Map<String, Object>> rows = (List<Map<String, Object>>) body.get("rows");
        Checked<HlCustomerExpense> c = checkExpenses(ym, rows);
        Map<String, Object> res = new LinkedHashMap<>();
        if (!c.ok()) { res.put("ok", false); res.put("errors", c.errors()); return res; }
        if (c.rows().isEmpty()) { res.put("ok", false); res.put("errors", List.of("올릴 행이 없습니다")); return res; }

        Set<String> keep = new HashSet<>();
        for (HlCustomerExpense x : c.rows()) { auditSupport.upsert(expenseRepo, x, UK_EXPENSE); keep.add(x.getCustomerCode()); }
        int removed = 0;
        for (HlCustomerExpense old : expenseRepo.findByYmOrderByCustomerCodeAsc(ym))
            if (!keep.contains(old.getCustomerCode())) { auditSupport.softDelete(expenseRepo, old.getExpenseId()); removed++; }
        res.put("ok", true);
        res.put("saved", c.rows().size());
        res.put("removed", removed);
        return res;
    }

    // ================================================================ 생산계획 (현업, 년월 전체 → 확정)

    /** 생산계획 행 검사 — 생산 호기·자재코드·월 생산량(EA) 필수, 같은 호기·자재코드 중복 금지 */
    public static Checked<HlProductionPlan> checkProductions(String ym, List<Map<String, Object>> rows) {
        List<String> errors = new ArrayList<>();
        List<HlProductionPlan> out = new ArrayList<>();
        Map<String, String> seen = new HashMap<>();
        if (rows == null) rows = List.of();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            String at = rowAt(r, i);
            int before = errors.size();
            checkScope(r, ym, null, at, errors);
            String mc = maxLen(r.get("machine"), 50, "생산 호기", at, errors);
            String mat = maxLen(r.get("materialCode"), 50, "자재코드", at, errors);
            if (str(r.get("machine")) == null) errors.add(at + "생산 호기를 입력하세요");
            if (str(r.get("materialCode")) == null) errors.add(at + "자재코드를 입력하세요");
            String cat = maxLen(r.get("category"), 100, "카테고리 분류", at, errors);
            String type = maxLen(r.get("prodType"), 100, "생산 분류", at, errors);
            String matName = maxLen(r.get("materialName"), 200, "자재명", at, errors);
            String note = maxLen(r.get("note"), 500, "기타", at, errors);
            BigDecimal qty = nonNegative(r.get("qtyEa"), "월 생산량(EA)", at, errors, true);
            if (mc != null && mat != null) {
                String prev = seen.putIfAbsent(mc + "|" + mat, at);
                if (prev != null) errors.add(at + "생산 호기 " + mc + " · 자재 " + mat + " 가 " + prev.replace(": ", "") + "과 중복입니다");
            }
            if (errors.size() == before)
                out.add(HlProductionPlan.builder().ym(ym).category(cat).machine(mc).prodType(type)
                        .materialCode(mat).materialName(matName).qtyEa(qty).note(note).build());
        }
        return new Checked<>(out, errors);
    }

    /** HL 호기 마스터 (사용중) — 화면 드롭다운·미등록 호기 경고용 */
    public List<Map<String, String>> hlMachines() {
        List<Map<String, String>> out = new ArrayList<>();
        for (var u : unitRepo.findByDivisionAndDeletedYnOrderByUnitCode(HL, "N")) {
            if (Boolean.FALSE.equals(u.getIsActive())) continue;
            Map<String, String> m = new LinkedHashMap<>();
            m.put("code", u.getUnitCode()); m.put("name", u.getUnitName());
            out.add(m);
        }
        return out;
    }

    /** 호기 마스터(코드·이름)·별칭(가공3→RP3 등)으로 찾을 수 없는 생산 호기 — 공백·'호기'·대소문자 무시. 기저귀 라인은 계산 대상이 아니므로 제외. 저장은 하되 경고 */
    static List<String> unknownMachines(Collection<String> machines, List<Map<String, String>> master) {
        Map<String, String> byNorm = HlConversion.unitByNorm(master);
        TreeSet<String> out = new TreeSet<>();
        for (String mc : machines)
            if (mc != null && !HlConversion.excluded(mc) && HlConversion.resolveMachine(mc, byNorm) == null) out.add(mc);
        return new ArrayList<>(out);
    }

    private List<String> machineWarnings(Collection<String> machines) {
        List<String> unknown = unknownMachines(machines, hlMachines());
        return unknown.isEmpty() ? List.of()
                : List.of("HL 호기 마스터에 없는 생산 호기: " + String.join(", ", unknown) + " — 저장은 했지만 전력비·에너지비 연결 때 호기를 찾지 못합니다. [기준정보 › 호기 마스터]에 등록하거나 호기 이름을 맞추세요");
    }

    public Map<String, Object> productions(Object ymRaw) {
        List<HlProductionPlan> rows = prodRepo.findByYmOrderByMachineAscMaterialCodeAsc(requireYm(ymRaw));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("rows", rows);
        List<String> warnings = new ArrayList<>(machineWarnings(rows.stream().map(HlProductionPlan::getMachine).toList()));
        // HL 자재 마스터 → 1EA 중량(kg) — 화면 톤 표시용. 없는 자재·계산 불가 자재 = 0톤 + 경고
        Map<String, BigDecimal> kg = new LinkedHashMap<>();
        try {
            Map<String, String> issue = new HashMap<>();
            for (var m : materialRepo.findByDivisionOrderByMaterialCodeAsc(HL)) {
                String key = m.getMaterialCode().trim().toUpperCase(Locale.ROOT);
                if (m.getKgPerEa() != null) kg.put(key, m.getKgPerEa()); else issue.put(key, m.getWeightIssue());
            }
            TreeSet<String> miss = new TreeSet<>();
            for (HlProductionPlan r : rows) {
                if (r.getQtyEa().signum() <= 0 || HlConversion.excluded(r.getMachine())) continue;
                String key = r.getMaterialCode().trim().toUpperCase(Locale.ROOT);
                if (!kg.containsKey(key)) miss.add(r.getMaterialCode() + (issue.containsKey(key) ? "(" + issue.get(key) + ")" : "(미등록)"));
            }
            if (!miss.isEmpty()) warnings.add("1EA 중량을 구할 수 없는 자재 " + miss.size() + "건은 전력비·에너지비에 0톤으로 계산됩니다: "
                    + String.join(", ", miss) + " — [STEP1 › 기준정보 관리 › HL 자재 마스터]에 등록하세요");
        } catch (org.springframework.dao.DataAccessException e) {
            warnings.add("HL 자재 마스터 테이블(rpsim_hl_material_master)을 읽지 못했습니다 — 테이블을 만들었는지 확인하세요");
        }
        TreeSet<String> skipped = new TreeSet<>();
        for (HlProductionPlan r : rows) if (HlConversion.excluded(r.getMachine())) skipped.add(r.getMachine());
        if (!skipped.isEmpty()) warnings.add("기저귀 라인은 전력비·에너지비 계산 대상이 아닙니다 (저장만 됨): " + String.join(", ", skipped));
        res.put("kgPerEa", kg);
        res.put("warnings", warnings);
        return res;
    }

    @Transactional
    public HlProductionPlan saveProduction(Long id, Map<String, Object> b) {
        String ym = requireYm(b.get("ym"));
        assertOpen(ym, HlSalesClose.ALL_TEAMS, HlSalesClose.PRODUCTION);
        Checked<HlProductionPlan> c = checkProductions(ym, List.of(b));
        if (!c.ok()) throw new IllegalArgumentException(String.join(" / ", c.errors()).replace("1번째 행: ", ""));
        HlProductionPlan in = c.rows().get(0);
        if (id == null) return auditSupport.upsert(prodRepo, in, UK_PROD);
        HlProductionPlan e = prodRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        if (!e.getYm().equals(ym)) assertOpen(e.getYm(), HlSalesClose.ALL_TEAMS, HlSalesClose.PRODUCTION);
        return auditSupport.updateById(prodRepo, id, in, UK_PROD);
    }

    @Transactional
    public void deleteProduction(Long id) {
        HlProductionPlan e = prodRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        assertOpen(e.getYm(), HlSalesClose.ALL_TEAMS, HlSalesClose.PRODUCTION);
        auditSupport.softDelete(prodRepo, id);
    }

    /** 업로드 — 그 년월 생산계획 전체를 파일 내용으로 교체. 호기 마스터에 없는 호기는 저장하고 경고 */
    @Transactional
    public Map<String, Object> uploadProductions(Map<String, Object> body) {
        String ym = requireYm(body.get("ym"));
        assertOpen(ym, HlSalesClose.ALL_TEAMS, HlSalesClose.PRODUCTION);
        @SuppressWarnings("unchecked") List<Map<String, Object>> rows = (List<Map<String, Object>>) body.get("rows");
        Checked<HlProductionPlan> c = checkProductions(ym, rows);
        Map<String, Object> res = new LinkedHashMap<>();
        if (!c.ok()) { res.put("ok", false); res.put("errors", c.errors()); return res; }
        if (c.rows().isEmpty()) { res.put("ok", false); res.put("errors", List.of("올릴 행이 없습니다")); return res; }

        Set<String> keep = new HashSet<>();
        for (HlProductionPlan x : c.rows()) { auditSupport.upsert(prodRepo, x, UK_PROD); keep.add(x.getMachine() + "|" + x.getMaterialCode()); }
        int removed = 0;
        for (HlProductionPlan old : prodRepo.findByYmOrderByMachineAscMaterialCodeAsc(ym))
            if (!keep.contains(old.getMachine() + "|" + old.getMaterialCode())) { auditSupport.softDelete(prodRepo, old.getProdId()); removed++; }
        res.put("ok", true);
        res.put("saved", c.rows().size());
        res.put("removed", removed);
        res.put("qtyEa", c.rows().stream().map(HlProductionPlan::getQtyEa).reduce(BigDecimal.ZERO, BigDecimal::add));
        res.put("warnings", machineWarnings(c.rows().stream().map(HlProductionPlan::getMachine).toList()));
        return res;
    }

    // ================================================================ 요약 (P/L 연결용)

    /** 년월 요약 — 순매출·장려금·마케팅비(년월 전체), 영업팀별 순매출(판매계획 마감 여부 포함)·카테고리별 */
    public Map<String, Object> summary(Object ymRaw) {
        String ym = requireYm(ymRaw);
        List<HlSalesPlan> ps = planRepo.findByYmOrderBySalesTeamAscCustomerCodeAscMaterialCodeAsc(ym);
        List<HlCustomerExpense> es = expenseRepo.findByYmOrderByCustomerCodeAsc(ym);
        return summarize(ym, ps, es, closeRepo.findByYmOrderBySalesTeamAsc(ym));
    }

    static Map<String, Object> summarize(String ym, List<HlSalesPlan> ps, List<HlCustomerExpense> es, List<HlSalesClose> closes) {
        Map<String, Map<String, Object>> byTeam = new TreeMap<>();
        Map<String, Map<String, Object>> byCat = new TreeMap<>();
        BigDecimal box = BigDecimal.ZERO, net = BigDecimal.ZERO, inc = BigDecimal.ZERO, mkt = BigDecimal.ZERO;
        for (HlSalesPlan p : ps) {
            box = box.add(p.getBoxQty()); net = net.add(p.getNetSales());
            add(team(byTeam, p.getSalesTeam()), "boxQty", p.getBoxQty());
            add(team(byTeam, p.getSalesTeam()), "netSales", p.getNetSales());
            String cat = p.getCategory() == null ? "(미입력)" : p.getCategory();
            Map<String, Object> c = byCat.computeIfAbsent(cat, k -> { Map<String, Object> m = new LinkedHashMap<>(); m.put("category", k); m.put("boxQty", BigDecimal.ZERO); m.put("netSales", BigDecimal.ZERO); return m; });
            add(c, "boxQty", p.getBoxQty()); add(c, "netSales", p.getNetSales());
        }
        for (HlCustomerExpense e : es) { inc = inc.add(e.getIncentiveAmt()); mkt = mkt.add(e.getMarketingAmt()); }
        boolean expenseClosed = false;
        for (HlSalesClose c : closes) {
            if (!c.closed()) continue;
            if (HlSalesClose.EXPENSE.equals(c.getCloseType())) expenseClosed = true;
            else team(byTeam, c.getSalesTeam()).put("salesClosed", true);
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ym", ym);
        r.put("boxQty", box);
        r.put("netSales", net);
        r.put("incentiveAmt", inc);
        r.put("marketingAmt", mkt);
        r.put("netAfter", net.subtract(inc).subtract(mkt));
        r.put("expenseClosed", expenseClosed);
        r.put("planRows", ps.size());
        r.put("expenseRows", es.size());
        r.put("teams", new ArrayList<>(byTeam.values()));
        r.put("categories", new ArrayList<>(byCat.values()));
        return r;
    }

    private static Map<String, Object> team(Map<String, Map<String, Object>> byTeam, String t) {
        return byTeam.computeIfAbsent(t, k -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("salesTeam", k);
            for (String f : List.of("boxQty", "netSales")) m.put(f, BigDecimal.ZERO);
            m.put("salesClosed", false);
            return m;
        });
    }

    private static void add(Map<String, Object> m, String k, BigDecimal v) {
        if (v != null) m.put(k, ((BigDecimal) m.get(k)).add(v));
    }
}
