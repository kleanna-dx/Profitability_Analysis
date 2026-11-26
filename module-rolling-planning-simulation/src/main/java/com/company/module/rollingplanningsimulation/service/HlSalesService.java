package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import com.company.module.rollingplanningsimulation.entity.HlSalesClose;
import com.company.module.rollingplanningsimulation.entity.HlSalesPlan;
import com.company.module.rollingplanningsimulation.repository.HlCustomerExpenseRepository;
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
 *   <li>순매출 = BOX 수량 × BOX당 단가(장려금 제외) — 서버 계산</li>
 *   <li>영업팀은 화면에서 고름. 업로드 파일에 다른 년월·다른 팀 행이 있으면 저장하지 않음</li>
 *   <li>업로드 = 그 년월·팀 데이터를 파일 내용으로 통째 교체 (파일에 없는 행은 소프트 삭제)</li>
 *   <li>마감된 년월·팀·구분은 입력·수정·삭제·업로드 불가</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class HlSalesService {

    private final HlSalesPlanRepository planRepo;
    private final HlCustomerExpenseRepository expenseRepo;
    private final HlSalesCloseRepository closeRepo;
    private final AuditSupport auditSupport;

    static final String[] UK_PLAN = {"ym", "salesTeam", "customerCode", "materialCode"};
    static final String[] UK_EXPENSE = {"ym", "salesTeam", "customerCode"};
    static final List<String> CLOSE_TYPES = List.of(HlSalesClose.SALES, HlSalesClose.EXPENSE);

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
            throw new IllegalArgumentException("마감 구분은 SALES(판매계획) / EXPENSE(장려금·마케팅비) 중 하나입니다: " + v);
        return t.toUpperCase(Locale.ROOT);
    }

    /** 검사 결과 — 오류가 하나라도 있으면 아무것도 저장하지 않음 */
    public record Checked<T>(List<T> rows, List<String> errors) {
        public boolean ok() { return errors.isEmpty(); }
    }

    /** 한 행의 년월·영업팀이 화면에서 고른 값과 같은지 (비어 있으면 화면 값 사용) */
    private static void checkScope(Map<String, Object> r, String ym, String team, String at, List<String> errors) {
        Object rYm = r.get("ym");
        if (str(rYm) != null) {
            String n = PurchasePlanService.normYm(rYm);
            if (n == null) errors.add(at + "년월 형식 오류: " + rYm);
            else if (!n.equals(ym)) errors.add(at + "년월(" + n + ")이 선택한 년월(" + ym + ")과 다릅니다");
        }
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

    /** 장려금·마케팅비 행 검사 (금액 비어 있으면 0) */
    public static Checked<HlCustomerExpense> checkExpenses(String ym, String team, List<Map<String, Object>> rows) {
        List<String> errors = new ArrayList<>();
        List<HlCustomerExpense> out = new ArrayList<>();
        Map<String, String> seen = new HashMap<>();
        if (rows == null) rows = List.of();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            String at = rowAt(r, i);
            int before = errors.size();
            checkScope(r, ym, team, at, errors);
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
                out.add(HlCustomerExpense.builder().ym(ym).salesTeam(team).customerCode(cust).customerName(custName)
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
            throw new IllegalStateException(ym.substring(0, 4) + "." + ym.substring(4) + " " + team + " "
                    + (HlSalesClose.SALES.equals(type) ? "판매계획" : "장려금·마케팅비") + "은 마감되었습니다 — 마감 해제 후 수정하세요");
    }

    public List<HlSalesClose> closeStatus(Object ymRaw) {
        return closeRepo.findByYmOrderBySalesTeamAsc(requireYm(ymRaw));
    }

    @Transactional
    public HlSalesClose setClosed(Object ymRaw, Object teamRaw, Object typeRaw, boolean close) {
        String ym = requireYm(ymRaw), team = requireTeam(teamRaw), type = requireType(typeRaw);
        HlSalesClose c = closeRepo.findFirstByYmAndSalesTeamAndCloseType(ym, team, type).orElse(null);
        if (c == null) {
            if (!close) throw new IllegalStateException("마감된 적이 없습니다");
            c = auditSupport.upsert(closeRepo, HlSalesClose.builder().ym(ym).salesTeam(team).closeType(type).build(),
                    "ym", "salesTeam", "closeType");
        }
        if (close) {
            if (c.closed()) throw new IllegalStateException("이미 마감되었습니다");
            if (HlSalesClose.SALES.equals(type) && planRepo.findByYmAndSalesTeamOrderByCustomerCodeAscMaterialCodeAsc(ym, team).isEmpty())
                throw new IllegalStateException("판매계획이 한 건도 없어 마감할 수 없습니다");
            c.close(CurrentUser.get());
        } else {
            if (!c.closed()) throw new IllegalStateException("마감 상태가 아닙니다");
            c.reopen();
        }
        return closeRepo.save(c);
    }

    // ================================================================ 판매계획

    public List<String> teams() {
        TreeSet<String> s = new TreeSet<>(planRepo.findTeams());
        s.addAll(expenseRepo.findTeams());
        return new ArrayList<>(s);
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

    public List<HlCustomerExpense> expenses(Object ymRaw, Object teamRaw) {
        String ym = requireYm(ymRaw);
        String team = str(teamRaw);
        return team == null ? expenseRepo.findByYmOrderBySalesTeamAscCustomerCodeAsc(ym)
                : expenseRepo.findByYmAndSalesTeamOrderByCustomerCodeAsc(ym, team);
    }

    @Transactional
    public HlCustomerExpense saveExpense(Long id, Map<String, Object> b) {
        String ym = requireYm(b.get("ym")), team = requireTeam(b.get("salesTeam"));
        assertOpen(ym, team, HlSalesClose.EXPENSE);
        Checked<HlCustomerExpense> c = checkExpenses(ym, team, List.of(b));
        if (!c.ok()) throw new IllegalArgumentException(String.join(" / ", c.errors()).replace("1번째 행: ", ""));
        HlCustomerExpense in = c.rows().get(0);
        if (id == null) return auditSupport.upsert(expenseRepo, in, UK_EXPENSE);
        HlCustomerExpense e = expenseRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        if (!e.getYm().equals(ym) || !e.getSalesTeam().equals(team)) assertOpen(e.getYm(), e.getSalesTeam(), HlSalesClose.EXPENSE);
        return auditSupport.updateById(expenseRepo, id, in, UK_EXPENSE);
    }

    @Transactional
    public void deleteExpense(Long id) {
        HlCustomerExpense e = expenseRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        assertOpen(e.getYm(), e.getSalesTeam(), HlSalesClose.EXPENSE);
        auditSupport.softDelete(expenseRepo, id);
    }

    @Transactional
    public Map<String, Object> uploadExpenses(Map<String, Object> body) {
        String ym = requireYm(body.get("ym")), team = requireTeam(body.get("salesTeam"));
        assertOpen(ym, team, HlSalesClose.EXPENSE);
        @SuppressWarnings("unchecked") List<Map<String, Object>> rows = (List<Map<String, Object>>) body.get("rows");
        Checked<HlCustomerExpense> c = checkExpenses(ym, team, rows);
        Map<String, Object> res = new LinkedHashMap<>();
        if (!c.ok()) { res.put("ok", false); res.put("errors", c.errors()); return res; }
        if (c.rows().isEmpty()) { res.put("ok", false); res.put("errors", List.of("올릴 행이 없습니다")); return res; }

        Set<String> keep = new HashSet<>();
        for (HlCustomerExpense x : c.rows()) { auditSupport.upsert(expenseRepo, x, UK_EXPENSE); keep.add(x.getCustomerCode()); }
        int removed = 0;
        for (HlCustomerExpense old : expenseRepo.findByYmAndSalesTeamOrderByCustomerCodeAsc(ym, team))
            if (!keep.contains(old.getCustomerCode())) { auditSupport.softDelete(expenseRepo, old.getExpenseId()); removed++; }
        res.put("ok", true);
        res.put("saved", c.rows().size());
        res.put("removed", removed);
        return res;
    }

    // ================================================================ 요약 (P/L 연결용)

    /** 년월 요약 — 순매출·장려금·마케팅비, 팀별(마감 여부 포함)·카테고리별 */
    public Map<String, Object> summary(Object ymRaw) {
        String ym = requireYm(ymRaw);
        List<HlSalesPlan> ps = planRepo.findByYmOrderBySalesTeamAscCustomerCodeAscMaterialCodeAsc(ym);
        List<HlCustomerExpense> es = expenseRepo.findByYmOrderBySalesTeamAscCustomerCodeAsc(ym);
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
        for (HlCustomerExpense e : es) {
            inc = inc.add(e.getIncentiveAmt()); mkt = mkt.add(e.getMarketingAmt());
            add(team(byTeam, e.getSalesTeam()), "incentiveAmt", e.getIncentiveAmt());
            add(team(byTeam, e.getSalesTeam()), "marketingAmt", e.getMarketingAmt());
        }
        for (HlSalesClose c : closes) {
            if (!c.closed()) continue;
            team(byTeam, c.getSalesTeam()).put(HlSalesClose.SALES.equals(c.getCloseType()) ? "salesClosed" : "expenseClosed", true);
        }
        for (Map<String, Object> t : byTeam.values())
            t.put("netAfter", ((BigDecimal) t.get("netSales")).subtract((BigDecimal) t.get("incentiveAmt")).subtract((BigDecimal) t.get("marketingAmt")));
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ym", ym);
        r.put("boxQty", box);
        r.put("netSales", net);
        r.put("incentiveAmt", inc);
        r.put("marketingAmt", mkt);
        r.put("netAfter", net.subtract(inc).subtract(mkt));
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
            for (String f : List.of("boxQty", "netSales", "incentiveAmt", "marketingAmt")) m.put(f, BigDecimal.ZERO);
            m.put("salesClosed", false); m.put("expenseClosed", false);
            return m;
        });
    }

    private static void add(Map<String, Object> m, String k, BigDecimal v) {
        if (v != null) m.put(k, ((BigDecimal) m.get(k)).add(v));
    }
}
