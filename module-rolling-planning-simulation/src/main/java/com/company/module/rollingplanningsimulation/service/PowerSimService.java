package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import com.company.module.rollingplanningsimulation.service.PowerSimCalculator.*;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.CurrentUser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;

/**
 * 호기별 생산량 기반 전력비 시뮬레이션 — 기준정보(버전·호기) / 월 평균단가 / 기타 가산·차감 / 계산 / 시나리오
 *
 * <ul>
 *   <li>자동 계산: 계획 생산량 → 가동시간 → 운휴시간 → 사용량 → × 월 평균단가 → 호기·공정·공장 전력비 ({@link PowerSimCalculator})</li>
 *   <li>현업 입력: 생산성, 가동·운휴 평균전력, 월 평균단가(+산정범위), 사용량 조정값(사유), 기타 가산·차감</li>
 *   <li>엑셀에서 가져온 기준정보는 DRAFT(검토용 초기값). 승인(APPROVED)하면 잠김 — 바꾸려면 복사해서 새 버전</li>
 *   <li>화면의 임시 변경(override)은 그 계산/시나리오에만 적용 — 기준정보 원본은 바꾸지 않음</li>
 *   <li>시나리오는 입력·결과 스냅샷(JSON) 저장 — 기준정보가 바뀌어도 저장 결과 불변. 최신 기준 재계산은 명시적 동작</li>
 * </ul>
 * 한전 요금체계(부하별·기본요금·역률·전력기금 등)는 계산하지 않음 — 월 평균단가를 쓰는 추정 모델.
 */
@Service
@RequiredArgsConstructor
public class PowerSimService {

    public static final String NOTICE = "월 평균단가를 적용한 추정값입니다 — 실제 한전 청구금액이나 증분비용이 아닙니다. 생산량을 바꿔도 단가는 고정입니다.";
    private static final List<String> OVERRIDE_FIELDS = List.of("productivityValue", "productivityBasis", "productivityUnit", "dayBasisHours", "runKw", "idleKw");

    private final PwSimBasisVersionRepository versionRepo;
    private final PwSimBasisLineRepository lineRepo;
    private final PwSimPriceRepository priceRepo;
    private final PwSimAdjustRepository adjustRepo;
    private final PwSimScenarioRepository scenarioRepo;
    private final PwLineKwRepository lineKwRepo;
    private final AuditSupport auditSupport;
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    // ================================================================ 공통

    static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    static String cut(String s, int n) { return s == null ? null : (s.length() > n ? s.substring(0, n) : s); }

    /** 숫자 — 빈칸이면 null(미입력). 숫자가 아니면 오류 */
    static BigDecimal num(Object o, String label) {
        String s = str(o);
        if (s == null) return null;
        try { return new BigDecimal(s.replace(",", "")); }
        catch (NumberFormatException e) { throw new IllegalArgumentException(label + " 숫자가 아닙니다: " + s); }
    }
    static BigDecimal nonNeg(Object o, String label) {
        BigDecimal v = num(o, label);
        if (v != null && v.signum() < 0) throw new IllegalArgumentException(label + "은(는) 0 이상이어야 합니다: " + v.toPlainString());
        return v;
    }
    static String yn(Object o, String label) {
        String s = str(o);
        if (s == null) throw new IllegalArgumentException(label + "을(를) 선택하세요 (포함/별도)");
        s = s.toUpperCase(Locale.ROOT);
        if (!"Y".equals(s) && !"N".equals(s)) throw new IllegalArgumentException(label + "은(는) Y/N 입니다: " + s);
        return s;
    }
    static String ym(Object o) {
        String v = PurchasePlanService.normYm(o);
        if (v == null) throw new IllegalArgumentException("년월 형식이 올바르지 않습니다 (yyyy.mm): " + o);
        return v;
    }
    static String division(Object o) { return SalesPlanService.normDivision(o); }

    private PwSimBasisVersion version(Long id) {
        return versionRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("전력 기준정보 버전을 찾을 수 없습니다: " + id));
    }
    private void assertDraft(PwSimBasisVersion v) {
        if (v.isApproved()) throw new IllegalStateException("승인된 기준정보(" + v.getVersionName() + ")는 수정할 수 없습니다 — [복사]로 새 버전을 만들어 수정하세요");
    }

    // ================================================================ 기준정보 버전

    public List<Map<String, Object>> versions(String divisionRaw) {
        String div = division(divisionRaw);
        List<Map<String, Object>> out = new ArrayList<>();
        for (PwSimBasisVersion v : versionRepo.findByDivisionOrderByVersionIdDesc(div)) {
            Map<String, Object> m = versionInfo(v);
            m.put("lineCount", lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(v.getVersionId()).size());
            out.add(m);
        }
        return out;
    }

    static Map<String, Object> versionInfo(PwSimBasisVersion v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("versionId", v.getVersionId());
        m.put("division", v.getDivision());
        m.put("versionName", v.getVersionName());
        m.put("applyYm", v.getApplyYm());
        m.put("status", v.getStatus());
        m.put("source", v.getSource());
        m.put("sourceFile", v.getSourceFile());
        m.put("approvedBy", v.getApprovedBy());
        m.put("approvedAt", v.getApprovedAt() == null ? null : v.getApprovedAt().toString());
        m.put("memo", v.getMemo());
        m.put("createdBy", v.getCreatedBy());
        m.put("createdAt", v.getCreatedAt() == null ? null : v.getCreatedAt().toString());
        return m;
    }

    public Map<String, Object> versionDetail(Long id) {
        PwSimBasisVersion v = version(id);
        Map<String, Object> res = versionInfo(v);
        res.put("lines", lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(id));
        return res;
    }

    @Transactional
    public Map<String, Object> createVersion(Map<String, Object> b) {
        String name = str(b.get("versionName"));
        if (name == null) throw new IllegalArgumentException("버전 이름을 입력하세요");
        String applyYm = str(b.get("applyYm")) == null ? null : ym(b.get("applyYm"));
        PwSimBasisVersion v = versionRepo.save(PwSimBasisVersion.builder().division(division(b.get("division")))
                .versionName(cut(name, 100)).applyYm(applyYm).source("MANUAL").memo(cut(str(b.get("memo")), 1000)).build());
        return versionInfo(v);
    }

    @Transactional
    public Map<String, Object> updateVersion(Long id, Map<String, Object> b) {
        PwSimBasisVersion v = version(id);
        assertDraft(v);
        String name = str(b.get("versionName"));
        if (name == null) throw new IllegalArgumentException("버전 이름을 입력하세요");
        v.changeMeta(cut(name, 100), str(b.get("applyYm")) == null ? null : ym(b.get("applyYm")), cut(str(b.get("memo")), 1000));
        return versionInfo(versionRepo.save(v));
    }

    /** 복사 → 새 DRAFT (승인된 버전을 고칠 때) */
    @Transactional
    public Map<String, Object> copyVersion(Long id, Map<String, Object> b) {
        PwSimBasisVersion src = version(id);
        String name = str(b == null ? null : b.get("versionName"));
        PwSimBasisVersion v = versionRepo.save(PwSimBasisVersion.builder().division(src.getDivision())
                .versionName(cut(name != null ? name : src.getVersionName() + " (복사)", 100)).applyYm(src.getApplyYm())
                .source(src.getSource()).sourceFile(src.getSourceFile())
                .memo(cut("복사 원본: #" + src.getVersionId() + " " + src.getVersionName() + (src.getMemo() == null ? "" : " / " + src.getMemo()), 1000)).build());
        for (PwSimBasisLine l : lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(id)) lineRepo.save(copyLine(l, v.getVersionId()));
        return versionInfo(v);
    }

    static PwSimBasisLine copyLine(PwSimBasisLine l, Long versionId) {
        return PwSimBasisLine.builder().versionId(versionId).lineCode(l.getLineCode()).lineName(l.getLineName()).processName(l.getProcessName())
                .prodUnit(l.getProdUnit()).productivityValue(l.getProductivityValue()).productivityBasis(l.getProductivityBasis())
                .productivityUnit(l.getProductivityUnit()).dayBasisHours(l.getDayBasisHours()).runKw(l.getRunKw()).idleKw(l.getIdleKw())
                .fixedKwh(l.getFixedKwh()).fixedNote(l.getFixedNote()).refQty(l.getRefQty()).refRunHours(l.getRefRunHours())
                .scopeMemo(l.getScopeMemo()).sourceNote(l.getSourceNote()).sortOrder(l.getSortOrder()).build();
    }

    /** 승인 — 모든 호기의 계산 필수값이 채워져 있어야 함 (현업 확인 후 확정) */
    @Transactional
    public Map<String, Object> approveVersion(Long id) {
        PwSimBasisVersion v = version(id);
        assertDraft(v);
        List<PwSimBasisLine> lines = lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(id);
        if (lines.isEmpty()) throw new IllegalStateException("호기가 없는 기준정보는 승인할 수 없습니다");
        List<String> miss = new ArrayList<>();
        for (PwSimBasisLine l : lines) {
            List<String> m = new ArrayList<>();
            if (str(l.getProdUnit()) == null) m.add("생산량 단위");
            // 생산성은 승인 필수 아님 — 비가동 호기(예: 가공2)·고정 사용량 행(라미네이팅)은 생산성이 없음.
            // 생산량이 있는데 생산성·가동시간이 모두 없으면 계산 단계에서 오류로 막는다.
            if (l.getProductivityValue() != null && (str(l.getProductivityBasis()) == null || str(l.getProductivityUnit()) == null)) m.add("생산성 기준·단위");
            if (PowerSimCalculator.DAY.equals(l.getProductivityBasis()) && l.getDayBasisHours() == null) m.add("1일 기준시간");
            if (l.getRunKw() == null) m.add("가동 평균전력");
            if (l.getIdleKw() == null) m.add("운휴 평균전력");
            if (!m.isEmpty()) miss.add(l.getLineCode() + "(" + String.join(", ", m) + ")");
        }
        if (!miss.isEmpty()) throw new IllegalStateException("미입력 값이 있어 승인할 수 없습니다: " + String.join(" / ", miss));
        v.approve(CurrentUser.get());
        return versionInfo(versionRepo.save(v));
    }

    @Transactional
    public void deleteVersion(Long id) {
        PwSimBasisVersion v = version(id);
        String user = CurrentUser.get();
        for (PwSimBasisLine l : lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(id)) { l.softDelete(user); lineRepo.save(l); }
        v.softDelete(user);
        versionRepo.save(v); // 저장 시나리오는 스냅샷이라 영향 없음
    }

    /**
     * 엑셀(검토용 초기값) 가져오기 → 새 DRAFT 버전. 빈칸은 미입력(null)으로 남김 — 가짜 값으로 채우지 않음.
     * body: {division, versionName, applyYm, sourceFile, memo, lines:[{row, lineCode, lineName, processName, prodUnit,
     *        productivityValue, productivityBasis, productivityUnit, dayBasisHours, runKw, idleKw, scopeMemo, sourceNote}]}
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> importVersion(Map<String, Object> b) {
        String div = division(b.get("division"));
        List<Map<String, Object>> rows = b.get("lines") instanceof List ? (List<Map<String, Object>>) b.get("lines") : List.of();
        List<String> errors = new ArrayList<>();
        List<PwSimBasisLine> lines = new ArrayList<>();
        Set<String> codes = new HashSet<>();
        int i = 0;
        for (Map<String, Object> r : rows) {
            i++;
            String at = "기준정보 " + (r.get("row") == null ? i : r.get("row")) + "행: ";
            try {
                PwSimBasisLine l = buildLine(null, r, i * 10);
                if (!codes.add(l.getLineCode().toLowerCase(Locale.ROOT))) errors.add(at + "같은 호기코드가 이미 있습니다: " + l.getLineCode());
                else lines.add(l);
            } catch (IllegalArgumentException e) { errors.add(at + e.getMessage()); }
        }
        if (lines.isEmpty() && errors.isEmpty()) errors.add("가져올 호기가 없습니다");
        Map<String, Object> res = new LinkedHashMap<>();
        if (!errors.isEmpty()) { res.put("ok", false); res.put("errors", errors); return res; }
        String name = str(b.get("versionName"));
        PwSimBasisVersion v = versionRepo.save(PwSimBasisVersion.builder().division(div)
                .versionName(cut(name != null ? name : "엑셀 초기값", 100))
                .applyYm(str(b.get("applyYm")) == null ? null : ym(b.get("applyYm"))).source("EXCEL")
                .sourceFile(cut(str(b.get("sourceFile")), 255)).memo(cut(str(b.get("memo")), 1000)).build());
        for (PwSimBasisLine l : lines) lineRepo.save(copyLine(l, v.getVersionId()));
        res.put("ok", true);
        res.put("version", versionInfo(v));
        res.put("lineCount", lines.size());
        return res;
    }

    // ================================================================ 기준정보 호기

    /** 입력 검증 + 엔티티 생성 (빈칸 = null 유지) */
    static PwSimBasisLine buildLine(Long versionId, Map<String, Object> b, Integer defaultSort) {
        String code = str(b.get("lineCode"));
        if (code == null) throw new IllegalArgumentException("호기코드를 입력하세요");
        String basis = str(b.get("productivityBasis"));
        if (basis != null) {
            basis = basis.toUpperCase(Locale.ROOT);
            if (basis.equals("H") || basis.equals("시간") || basis.equals("시간당")) basis = PowerSimCalculator.HOUR;
            if (basis.equals("D") || basis.equals("일") || basis.equals("일당")) basis = PowerSimCalculator.DAY;
            if (!PowerSimCalculator.HOUR.equals(basis) && !PowerSimCalculator.DAY.equals(basis))
                throw new IllegalArgumentException("생산성 기준은 시간당(HOUR) / 일당(DAY) 중 하나입니다: " + basis);
        }
        BigDecimal pv = nonNeg(b.get("productivityValue"), "생산성");
        if (pv != null && pv.signum() == 0) throw new IllegalArgumentException("생산성은 0보다 커야 합니다 (모르면 비워 두세요)");
        BigDecimal dh = nonNeg(b.get("dayBasisHours"), "1일 기준시간");
        if (dh != null && (dh.signum() == 0 || dh.compareTo(BigDecimal.valueOf(24)) > 0)) throw new IllegalArgumentException("1일 기준시간은 0 초과 24 이하입니다");
        if (PowerSimCalculator.DAY.equals(basis) && pv != null && dh == null)
            throw new IllegalArgumentException("일당 생산성은 1일 기준시간(h)이 필요합니다 — 1일을 24시간으로 간주하지 않습니다");
        String pu = str(b.get("prodUnit")), qu = str(b.get("productivityUnit"));
        if (pu != null && qu != null && PowerSimCalculator.unitFactor(qu, pu) == null)
            throw new IllegalArgumentException("생산량 단위(" + pu + ")와 생산성 단위(" + qu + ")를 변환할 수 없습니다 — 같은 단위이거나 질량 단위(ton/kg)여야 합니다");
        BigDecimal fixed = num(b.get("fixedKwh"), "고정 사용량");
        String fixedNote = str(b.get("fixedNote"));
        if (fixed != null && fixed.signum() != 0 && fixedNote == null) throw new IllegalArgumentException("고정 사용량을 넣으면 근거를 입력하세요 (예: 라미네이팅 월 사용량)");
        Integer sort = null;
        if (str(b.get("sortOrder")) != null) {
            try { sort = Integer.valueOf(str(b.get("sortOrder"))); } catch (NumberFormatException e) { throw new IllegalArgumentException("정렬순서는 정수입니다"); }
        }
        return PwSimBasisLine.builder().versionId(versionId).lineCode(cut(code, 30)).lineName(cut(str(b.get("lineName")), 100))
                .processName(cut(str(b.get("processName")), 100)).prodUnit(cut(pu, 20)).productivityValue(pv).productivityBasis(basis)
                .productivityUnit(cut(qu, 20)).dayBasisHours(dh)
                .runKw(nonNeg(b.get("runKw"), "가동 중 평균전력")).idleKw(nonNeg(b.get("idleKw"), "운휴 중 평균전력"))
                .fixedKwh(fixed).fixedNote(cut(fixedNote, 500))
                .refQty(nonNeg(b.get("refQty"), "엑셀 생산량")).refRunHours(nonNeg(b.get("refRunHours"), "엑셀 가동시간"))
                .scopeMemo(cut(str(b.get("scopeMemo")), 1000)).sourceNote(cut(str(b.get("sourceNote")), 500))
                .sortOrder(sort != null ? sort : defaultSort).build();
    }

    @Transactional
    public PwSimBasisLine saveLine(Long versionId, Long lineId, Map<String, Object> b) {
        assertDraft(version(versionId));
        PwSimBasisLine e = buildLine(versionId, b, null);
        String[] uk = {"versionId", "lineCode"};
        if (lineId != null) {
            PwSimBasisLine cur = lineRepo.findById(lineId).orElseThrow(() -> new IllegalArgumentException("호기를 찾을 수 없습니다: " + lineId));
            if (!versionId.equals(cur.getVersionId())) throw new IllegalArgumentException("다른 버전의 호기입니다");
            return auditSupport.updateById(lineRepo, lineId, e, uk);
        }
        return auditSupport.upsert(lineRepo, e, uk);
    }

    @Transactional
    public void deleteLine(Long versionId, Long lineId) {
        assertDraft(version(versionId));
        PwSimBasisLine cur = lineRepo.findById(lineId).orElseThrow(() -> new IllegalArgumentException("호기를 찾을 수 없습니다: " + lineId));
        if (!versionId.equals(cur.getVersionId())) throw new IllegalArgumentException("다른 버전의 호기입니다");
        auditSupport.softDelete(lineRepo, lineId);
    }

    // ================================================================ 월 평균단가 / 기타 가산·차감

    public List<PwSimPrice> prices(String divisionRaw, Integer year) {
        return priceRepo.findByDivisionAndYmStartingWithOrderByYmAsc(division(divisionRaw), String.valueOf(year));
    }

    @Transactional
    public PwSimPrice savePrice(Long id, Map<String, Object> b) {
        BigDecimal p = nonNeg(b.get("priceKrwPerKwh"), "평균 전력단가");
        if (p == null) throw new IllegalArgumentException("평균 전력단가(원/kWh)를 입력하세요");
        String scope = str(b.get("scopeDesc"));
        if (scope == null) throw new IllegalArgumentException("단가 산정범위 설명을 입력하세요 (예: 부가세 별도, 기본요금·ESS 포함, DR 정산금 별도)");
        PwSimPrice e = PwSimPrice.builder().division(division(b.get("division"))).ym(ym(b.get("ym"))).priceKrwPerKwh(p)
                .vatIncludedYn(yn(b.get("vatIncludedYn"), "부가세 포함 여부")).baseFeeIncludedYn(yn(b.get("baseFeeIncludedYn"), "기본요금 포함 여부"))
                .essIncludedYn(yn(b.get("essIncludedYn"), "ESS 포함 여부")).settlementIncludedYn(yn(b.get("settlementIncludedYn"), "정산금 포함 여부"))
                .scopeDesc(cut(scope, 1000)).memo(cut(str(b.get("memo")), 1000)).build();
        String[] uk = {"division", "ym"};
        return id != null ? auditSupport.updateById(priceRepo, id, e, uk) : auditSupport.upsert(priceRepo, e, uk);
    }

    @Transactional public void deletePrice(Long id) { auditSupport.softDelete(priceRepo, id); }

    public List<PwSimAdjust> adjusts(String divisionRaw, String ymRaw) {
        return adjustRepo.findByDivisionAndYmOrderByAdjustIdAsc(division(divisionRaw), ym(ymRaw));
    }

    @Transactional
    public PwSimAdjust saveAdjust(Long id, Map<String, Object> b) {
        String name = str(b.get("itemName"));
        if (name == null) throw new IllegalArgumentException("항목명을 입력하세요");
        String dir = str(b.get("direction"));
        if (!PowerSimCalculator.ADD.equals(dir) && !PowerSimCalculator.DEDUCT.equals(dir)) throw new IllegalArgumentException("구분(가산/차감)을 선택하세요");
        BigDecimal amt = nonNeg(b.get("amountKrw"), "금액");
        if (amt == null) throw new IllegalArgumentException("금액(원)을 입력하세요 — 차감도 0 이상 금액 + 구분 '차감'");
        String cat = str(b.get("category"));
        if (cat == null || !PowerSimCalculator.CATEGORIES.contains(cat)) throw new IllegalArgumentException("항목 구분을 선택하세요");
        String memo = str(b.get("memo"));
        if (memo == null) throw new IllegalArgumentException("입력 근거 또는 메모를 입력하세요");
        PwSimAdjust e = PwSimAdjust.builder().division(division(b.get("division"))).ym(ym(b.get("ym"))).itemName(cut(name, 200))
                .direction(dir).amountKrw(amt.setScale(0, java.math.RoundingMode.HALF_UP)).category(cat)
                .vatIncludedYn(yn(b.get("vatIncludedYn"), "부가세 포함 여부")).memo(cut(memo, 1000)).build();
        return id != null ? auditSupport.updateById(adjustRepo, id, e) : auditSupport.upsert(adjustRepo, e);
    }

    @Transactional public void deleteAdjust(Long id) { auditSupport.softDelete(adjustRepo, id); }

    // ================================================================ 생산계획 생산량 (자동 채움용)

    /** 생산계획(rpsim_production_plan) 양품량 합계 — 호기코드별, ton. 생산계획이 없는 호기는 목록에 없음(미입력) */
    public Map<String, Object> planQty(String ymRaw, String divisionRaw) {
        String ym = ym(ymRaw), div = division(divisionRaw);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT MACHINE_CODE, SUM(GOOD_TON) AS TON, COUNT(*) AS N, SUM(CASE WHEN GOOD_TON IS NULL THEN 1 ELSE 0 END) AS NULLS" +
                " FROM rpsim_production_plan WHERE DIVISION = ? AND YEAR = ? AND MONTH = ? AND DELETED_YN = 'N' GROUP BY MACHINE_CODE",
                div, Integer.parseInt(ym.substring(0, 4)), Integer.parseInt(ym.substring(4)));
        Map<String, Object> qty = new LinkedHashMap<>();
        List<String> warnings = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            String mc = str(r.get("MACHINE_CODE"));
            qty.put(mc, r.get("TON"));
            if (r.get("NULLS") instanceof Number n && n.intValue() > 0) warnings.add(mc + ": 양품량이 비어 있는 생산계획 " + n + "건은 합계에서 빠졌습니다");
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ym", ym); res.put("division", div); res.put("unit", "ton"); res.put("qty", qty); res.put("warnings", warnings);
        return res;
    }

    // ================================================================ 계산

    /**
     * body: {division, ym, versionId, lines:[{lineCode, baseQty, qty, baseRunHours, runHours(생산팀 통보 가동시간 — 선택), adjKwh, adjReason,
     *        override:{productivityValue, productivityBasis, productivityUnit, dayBasisHours, runKw, idleKw}}]}
     * baseQty 가 모두 비어 있으면 기준 대비 계산 생략. override 는 이번 계산에만 적용 (기준정보 원본 불변)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> calculate(Map<String, Object> body) {
        String div = division(body.get("division")), ym = ym(body.get("ym"));
        Long vid = body.get("versionId") == null ? null : Long.valueOf(String.valueOf(body.get("versionId")));
        if (vid == null) throw new IllegalArgumentException("전력 기준정보 버전을 선택하세요");
        PwSimBasisVersion v = version(vid);
        if (!div.equals(v.getDivision())) throw new IllegalArgumentException("다른 사업부의 기준정보입니다: " + v.getDivision());
        List<PwSimBasisLine> basis = lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(vid);
        Map<String, Map<String, Object>> req = new HashMap<>();
        for (Map<String, Object> r : body.get("lines") instanceof List ? (List<Map<String, Object>>) body.get("lines") : List.<Map<String, Object>>of())
            if (str(r.get("lineCode")) != null) req.put(str(r.get("lineCode")), r);
        Price price = priceRepo.findFirstByDivisionAndYm(div, ym).map(PowerSimService::toPrice).orElse(null);
        List<Adjust> adjusts = adjustRepo.findByDivisionAndYmOrderByAdjustIdAsc(div, ym).stream().map(PowerSimService::toAdjust).toList();
        return compute(div, ym, v, basis, req, price, adjusts, monthKw(div, ym));
    }

    /** 기준정보 › 호기별 전력 kW (월별) — 계산월 값만 (다른 달 값으로 채우지 않음). key = 호기코드 소문자 */
    Map<String, PwLineKw> monthKw(String div, String ym) {
        Map<String, PwLineKw> m = new HashMap<>();
        for (PwLineKw k : lineKwRepo.findByYearAndMonthAndDivisionOrderByMachineCodeAsc(Integer.parseInt(ym.substring(0, 4)), Integer.parseInt(ym.substring(4)), div))
            m.put(k.getMachineCode().toLowerCase(Locale.ROOT), k);
        return m;
    }

    static Price toPrice(PwSimPrice p) {
        return new Price(p.getPriceKrwPerKwh(), p.getVatIncludedYn(), p.getBaseFeeIncludedYn(), p.getEssIncludedYn(), p.getSettlementIncludedYn(), p.getScopeDesc());
    }
    static Adjust toAdjust(PwSimAdjust a) {
        return new Adjust(a.getItemName(), a.getDirection(), a.getAmountKrw(), a.getCategory(), a.getVatIncludedYn(), a.getMemo());
    }

    /** 순수 계산 조립 (DB 없음 — 테스트 가능). 화면 요청 + 기준정보 → 기준/시뮬 Input → 결과·증감 */
    @SuppressWarnings("unchecked")
    static Map<String, Object> compute(String div, String ym, PwSimBasisVersion v, List<PwSimBasisLine> basis,
                                       Map<String, Map<String, Object>> req, Price price, List<Adjust> adjusts) {
        return compute(div, ym, v, basis, req, price, adjusts, Map.of());
    }

    /**
     * kW 적용 순서: 화면 임시 변경 > 기준정보 › 호기별 전력 kW(계산월) > 전력 기준정보 버전 값.
     * 월별 kW 는 가동/운휴 각각 따로 적용 (월별에 가동만 있으면 운휴는 버전 값). 출처는 lineInfo.kwSource 에 표시.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> compute(String div, String ym, PwSimBasisVersion v, List<PwSimBasisLine> basis,
                                       Map<String, Map<String, Object>> req, Price price, List<Adjust> adjusts,
                                       Map<String, PwLineKw> monthKw) {
        if (monthKw == null) monthKw = Map.of();
        List<String> noMonthKw = new ArrayList<>();
        int y = Integer.parseInt(ym.substring(0, 4)), m = Integer.parseInt(ym.substring(4));
        List<Line> base = new ArrayList<>(), sim = new ArrayList<>();
        List<Map<String, Object>> lineInfo = new ArrayList<>();
        boolean anyBase = false;
        List<String> warnings = new ArrayList<>();
        for (PwSimBasisLine b : basis) {
            Map<String, Object> r = req.getOrDefault(b.getLineCode(), Map.of());
            Map<String, Object> ov = r.get("override") instanceof Map ? (Map<String, Object>) r.get("override") : Map.of();
            List<String> overridden = new ArrayList<>();
            for (String f : OVERRIDE_FIELDS) if (ov.containsKey(f) && str(ov.get(f)) != null) overridden.add(f);
            BigDecimal pv = overridden.contains("productivityValue") ? nonNeg(ov.get("productivityValue"), b.getLineCode() + " 생산성") : b.getProductivityValue();
            String pb = overridden.contains("productivityBasis") ? str(ov.get("productivityBasis")).toUpperCase(Locale.ROOT) : b.getProductivityBasis();
            String pu = overridden.contains("productivityUnit") ? str(ov.get("productivityUnit")) : b.getProductivityUnit();
            BigDecimal dh = overridden.contains("dayBasisHours") ? nonNeg(ov.get("dayBasisHours"), b.getLineCode() + " 1일 기준시간") : b.getDayBasisHours();
            PwLineKw mk = monthKw.get(b.getLineCode().toLowerCase(Locale.ROOT));
            BigDecimal mRun = mk == null ? null : mk.getRunKw(), mIdle = mk == null ? null : mk.getIdleKw();
            String runSrc = overridden.contains("runKw") ? "OVERRIDE" : mRun != null ? "MONTH" : "VERSION";
            String idleSrc = overridden.contains("idleKw") ? "OVERRIDE" : mIdle != null ? "MONTH" : "VERSION";
            BigDecimal rk = overridden.contains("runKw") ? nonNeg(ov.get("runKw"), b.getLineCode() + " 가동 평균전력") : mRun != null ? mRun : b.getRunKw();
            BigDecimal ik = overridden.contains("idleKw") ? nonNeg(ov.get("idleKw"), b.getLineCode() + " 운휴 평균전력") : mIdle != null ? mIdle : b.getIdleKw();
            if (!monthKw.isEmpty() && mk == null && (b.getRunKw() != null || b.getIdleKw() != null)) noMonthKw.add(b.getLineCode());
            BigDecimal adj = num(r.get("adjKwh"), b.getLineCode() + " 사용량 조정값");
            String reason = str(r.get("adjReason"));
            BigDecimal qty = num(r.get("qty"), b.getLineCode() + " 생산량");
            BigDecimal bq = num(r.get("baseQty"), b.getLineCode() + " 기준 생산량");
            BigDecimal runH = num(r.get("runHours"), b.getLineCode() + " 가동시간");
            BigDecimal baseRunH = num(r.get("baseRunHours"), b.getLineCode() + " 기준 가동시간");
            if (bq != null) anyBase = true;
            sim.add(new Line(b.getLineCode(), b.getLineName(), b.getProcessName(), b.getProdUnit(), qty, pv, pb, pu, dh, rk, ik, adj, reason,
                    b.getFixedKwh(), b.getFixedNote(), runH));
            base.add(new Line(b.getLineCode(), b.getLineName(), b.getProcessName(), b.getProdUnit(), bq, pv, pb, pu, dh, rk, ik, adj, reason,
                    b.getFixedKwh(), b.getFixedNote(), baseRunH));
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("lineCode", b.getLineCode());
            info.put("overridden", overridden);
            info.put("runKwSource", runSrc);
            info.put("idleKwSource", idleSrc);
            info.put("runKwApplied", rk);
            info.put("idleKwApplied", ik);
            info.put("scopeMemo", b.getScopeMemo());
            info.put("sourceNote", b.getSourceNote());
            info.put("fixedKwh", b.getFixedKwh());
            info.put("fixedNote", b.getFixedNote());
            info.put("refQty", b.getRefQty());
            info.put("refRunHours", b.getRefRunHours());
            Map<String, Object> bv = new LinkedHashMap<>();
            bv.put("productivityValue", b.getProductivityValue()); bv.put("productivityBasis", b.getProductivityBasis());
            bv.put("productivityUnit", b.getProductivityUnit()); bv.put("dayBasisHours", b.getDayBasisHours());
            bv.put("runKw", b.getRunKw()); bv.put("idleKw", b.getIdleKw());
            info.put("basis", bv);
            lineInfo.add(info);
        }
        String ymTxt = ym.substring(0, 4) + "." + ym.substring(4);
        if (monthKw.isEmpty()) warnings.add(ymTxt + " 호기별 전력 kW(월별 기준정보)가 없어 전력 기준정보 버전의 kW로 계산했습니다");
        else if (!noMonthKw.isEmpty()) warnings.add(ymTxt + " 호기별 전력 kW(월별)에 없는 호기는 전력 기준정보 버전의 kW로 계산했습니다: " + String.join(", ", noMonthKw));
        Set<String> basisCodes = new HashSet<>();
        basis.forEach(b -> basisCodes.add(b.getLineCode().toLowerCase(Locale.ROOT)));
        List<String> extraKw = monthKw.values().stream().map(PwLineKw::getMachineCode).filter(c -> !basisCodes.contains(c.toLowerCase(Locale.ROOT))).sorted().toList();
        if (!extraKw.isEmpty()) warnings.add("호기별 전력 kW(월별)에는 있지만 전력 기준정보 버전에 없는 호기 — 계산에 쓰지 않음: " + String.join(", ", extraKw));
        if (!v.isApproved()) warnings.add("검토용 초기값(미승인 기준정보 '" + v.getVersionName() + "')으로 계산했습니다 — 현업 승인 전에는 확정값이 아닙니다");
        if (v.getApplyYm() != null && !v.getApplyYm().equals(ym))
            warnings.add("기준정보 적용월(" + v.getApplyYm().substring(0, 4) + "." + v.getApplyYm().substring(4) + ")과 계산월(" + ym.substring(0, 4) + "." + ym.substring(4) + ")이 다릅니다 — 버전 선택을 확인하세요");
        if (lineInfo.stream().anyMatch(i -> !((List<?>) i.get("overridden")).isEmpty()))
            warnings.add("화면에서 임시 변경한 값이 있습니다 — 이 계산(시나리오)에만 적용되고 기준정보 원본은 바뀌지 않습니다");

        Input simIn = new Input(y, m, price, List.copyOf(sim), List.copyOf(adjusts));
        Result simR = PowerSimCalculator.calculate(simIn);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("division", div);
        res.put("ym", ym);
        res.put("version", versionInfo(v));
        res.put("notice", NOTICE);
        res.put("warnings", warnings);
        res.put("lineInfo", lineInfo);
        res.put("sim", simR);
        res.put("simInput", simIn);
        if (anyBase) {
            Input baseIn = new Input(y, m, price, List.copyOf(base), List.copyOf(adjusts));
            Result baseR = PowerSimCalculator.calculate(baseIn);
            res.put("base", baseR);
            res.put("baseInput", baseIn);
            res.put("delta", PowerSimCalculator.delta(baseR, simR));
        }
        return res;
    }

    // ================================================================ P/L 전력비 연결

    /** P/L 이 쓸 기준정보 버전: 계산월 승인 → 계산월 검토용 → 최신 승인 → 최신 (없으면 null) */
    static PwSimBasisVersion pickVersion(List<PwSimBasisVersion> vs, String ym) {
        if (vs == null || vs.isEmpty()) return null;
        for (PwSimBasisVersion v : vs) if (ym.equals(v.getApplyYm()) && v.isApproved()) return v;
        for (PwSimBasisVersion v : vs) if (ym.equals(v.getApplyYm())) return v;
        for (PwSimBasisVersion v : vs) if (v.isApproved()) return v;
        return vs.get(0);
    }

    record PlReq(Map<String, Map<String, Object>> req, List<String> matched, List<String> unusedPlanCodes) {}

    /**
     * 호기별 기준·시뮬 생산량(ton) → 전력비 계산 요청. 가동시간은 넣지 않음 → 생산량 ÷ 생산성으로 계산.
     * 생산계획이 없는 호기 = 생산량 0(운휴 전력만) + 경고 (가짜 값 없음)
     */
    static PlReq plRequest(List<PwSimBasisLine> basis, Map<String, BigDecimal> baseTon, Map<String, BigDecimal> simTon, List<String> warnings) {
        Map<String, String> lower = new HashMap<>();
        baseTon.keySet().forEach(k -> lower.put(k.toLowerCase(Locale.ROOT), k));
        Set<String> used = new HashSet<>();
        List<String> matched = new ArrayList<>(), noPlan = new ArrayList<>();
        Map<String, Map<String, Object>> req = new HashMap<>();
        for (PwSimBasisLine b : basis) {
            String key = lower.get(b.getLineCode().toLowerCase(Locale.ROOT));
            BigDecimal base, sim;
            if (key == null) {
                base = BigDecimal.ZERO; sim = BigDecimal.ZERO;
                if (b.getRunKw() != null && b.getRunKw().signum() > 0) noPlan.add(b.getLineCode());
            } else {
                used.add(key);
                BigDecimal bt = baseTon.get(key) == null ? BigDecimal.ZERO : baseTon.get(key);
                BigDecimal st = simTon.get(key) == null ? bt : simTon.get(key);
                BigDecimal f = PowerSimCalculator.unitFactor("ton", b.getProdUnit());
                if (f == null) {
                    base = null; sim = null;
                    warnings.add(b.getLineCode() + ": 생산계획(ton)을 생산량 단위 '" + b.getProdUnit() + "'(으)로 바꿀 수 없습니다 — 계산 미완료 (전력 기준정보의 생산량 단위를 ton으로 하세요)");
                } else {
                    base = bt.multiply(f, PowerSimCalculator.MC); sim = st.multiply(f, PowerSimCalculator.MC);
                    matched.add(b.getLineCode());
                }
            }
            Map<String, Object> r = new HashMap<>();
            r.put("lineCode", b.getLineCode());
            r.put("baseQty", base == null ? null : base.toPlainString());
            r.put("qty", sim == null ? null : sim.toPlainString());
            req.put(b.getLineCode(), r);
        }
        if (!noPlan.isEmpty())
            warnings.add("생산계획이 없는 호기는 생산량 0(운휴 전력만)으로 계산했습니다: " + String.join(", ", noPlan) + " — 전력 기준정보 호기코드가 생산계획 호기코드와 같은지 확인하세요");
        List<String> unused = baseTon.keySet().stream().filter(k -> !used.contains(k)).sorted().toList();
        if (!unused.isEmpty()) warnings.add("전력 기준정보에 없는 생산계획 호기 — 전력비 0으로 계산: " + String.join(", ", unused));
        return new PlReq(req, matched, unused);
    }

    /** 지종별 생산 비율 — P/L 지종 {product, plan(톤), sim(톤)} → 시뮬 ÷ 생산계획 */
    record ProductSim(String product, BigDecimal plan, BigDecimal sim) {}

    /**
     * 생산계획(호기 × 지종 양품 ton) + P/L 지종별 시뮬 생산량 → 호기별 기준·시뮬 생산량(ton).
     * 호기 시뮬 = Σ 지종 (그 호기 생산계획 양품 × 지종 시뮬 ÷ 지종 생산계획). P/L 에 없는 지종은 생산계획 그대로.
     * 생산계획이 없는 지종에 시뮬 생산량이 있으면 어느 호기인지 알 수 없어 반영하지 않고 경고.
     */
    static Map<String, Map<String, BigDecimal>> machineTonFromProducts(List<Map<String, Object>> planRows, List<ProductSim> products, String machine, List<String> warnings) {
        Map<String, BigDecimal> ratio = new HashMap<>();
        Set<String> planProducts = new HashSet<>();
        for (Map<String, Object> r : planRows) planProducts.add(str(r.get("PRODUCT")));
        List<String> noPlan = new ArrayList<>();
        for (ProductSim p : products) {
            if (p.product() == null || p.sim() == null) continue;
            if (p.plan() == null || p.plan().signum() <= 0) {
                if (p.sim().signum() > 0) noPlan.add(p.product());
                continue;
            }
            ratio.put(p.product(), p.sim().divide(p.plan(), PowerSimCalculator.MC));
        }
        if (!noPlan.isEmpty())
            warnings.add("생산계획이 없는 지종의 시뮬 생산량은 어느 호기인지 알 수 없어 전력비에 반영하지 않았습니다: " + String.join(", ", noPlan));
        Map<String, BigDecimal> base = new LinkedHashMap<>(), sim = new LinkedHashMap<>();
        for (Map<String, Object> r : planRows) {
            String mc = str(r.get("MACHINE_CODE")), prod = str(r.get("PRODUCT"));
            BigDecimal t = r.get("TON") == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(r.get("TON")));
            base.merge(mc, t, BigDecimal::add);
            // P/L 에서 호기를 하나 골랐으면 그 호기에만 지종 비율 적용 (다른 호기는 생산계획 그대로)
            // STEP3 에서 확정(잠금)한 호기는 확정 생산계획 그대로 — P/L 입력 생산량을 적용하지 않음
            boolean locked = isLocked(r.get("LOCKED"));
            boolean apply = !locked && (machine == null || "ALL".equalsIgnoreCase(machine) || machine.equalsIgnoreCase(mc));
            sim.merge(mc, apply ? t.multiply(ratio.getOrDefault(prod, BigDecimal.ONE), PowerSimCalculator.MC) : t, BigDecimal::add);
        }
        Map<String, Map<String, BigDecimal>> out = new LinkedHashMap<>();
        out.put("base", base); out.put("sim", sim);
        return out;
    }


    static boolean isLocked(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() == 1;
        String x = v.toString().trim();
        return "1".equals(x) || "true".equalsIgnoreCase(x) || "Y".equalsIgnoreCase(x);
    }

    /** 호기별 생산량 출처 — 호기 전체가 확정이면 LOCKED, 하나라도 미확정이면 UNLOCKED */
    static Map<String, Object> qtySource(List<Map<String, Object>> planRows, boolean hasPlInput) {
        Map<String, Boolean> lockByMc = new TreeMap<>();
        for (Map<String, Object> r : planRows) lockByMc.merge(str(r.get("MACHINE_CODE")), isLocked(r.get("LOCKED")), Boolean::logicalAnd);
        List<String> locked = new ArrayList<>(), unlocked = new ArrayList<>();
        lockByMc.forEach((k, v) -> (v ? locked : unlocked).add(k));
        String code, label;
        if (planRows.isEmpty()) { code = "NONE"; label = "생산계획 없음"; }
        else if (unlocked.isEmpty()) { code = "LOCKED"; label = "STEP3 확정 생산계획"; }
        else if (locked.isEmpty()) { code = hasPlInput ? "PL" : "PLAN"; label = hasPlInput ? "P/L 시뮬레이터 생산량 (생산계획 미확정)" : "생산계획 (미확정)"; }
        else { code = "MIXED"; label = "확정 호기 = STEP3 확정 생산계획 / 미확정 호기 = " + (hasPlInput ? "P/L 시뮬레이터 생산량" : "생산계획(미확정)"); }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code); m.put("label", label); m.put("lockedMachines", locked); m.put("unlockedMachines", unlocked);
        return m;
    }

    record ProdQty(PwSimBasisVersion version, List<PwSimBasisLine> basis, Map<String, Map<String, BigDecimal>> machineTon,
                   PlReq req, Map<String, Object> source, List<String> warnings) {}

    /**
     * 전력비 생산량 결정 (P/L 전력비 · 전력비 시뮬레이션 탭 공통).
     * <ul>
     *   <li>STEP3 생산계획을 확정(잠금)한 호기 → 확정 생산계획 그대로</li>
     *   <li>미확정 호기 → P/L 시뮬레이터 지종별 입력 생산량을 생산계획 호기×지종 비중으로 나눈 값 (P/L 입력이 없으면 생산계획 그대로)</li>
     *   <li>생산량 = 총생산량 = 양품 ÷ (1 − 손지율) — P/L 생산량과 같은 기준</li>
     * </ul>
     * body: {division, ym, machine(ALL/호기), versionId(선택 — 없으면 자동 선택), products:[{product, plan, sim}]} (톤)
     */
    ProdQty prodQty(Map<String, Object> body) {
        String div = division(body.get("division")), ym = ym(body.get("ym"));
        List<ProductSim> products = new ArrayList<>();
        if (body.get("products") instanceof List<?> l)
            for (Object o : l) if (o instanceof Map<?, ?> m) {
                BigDecimal sim = num(m.get("sim"), "지종 시뮬 생산량");
                if (sim != null && sim.signum() < 0) throw new IllegalArgumentException("시뮬 생산량은 0 이상이어야 합니다: " + m.get("product"));
                products.add(new ProductSim(str(m.get("product")), num(m.get("plan"), "지종 생산계획"), sim));
            }
        PwSimBasisVersion v;
        if (body.get("versionId") != null && str(body.get("versionId")) != null) {
            v = version(Long.valueOf(String.valueOf(body.get("versionId"))));
            if (!div.equals(v.getDivision())) throw new IllegalArgumentException("다른 사업부의 기준정보입니다: " + v.getDivision());
        } else v = pickVersion(versionRepo.findByDivisionOrderByVersionIdDesc(div), ym);
        if (v == null) return new ProdQty(null, List.of(), Map.of(), null, Map.of(), List.of());
        List<PwSimBasisLine> basis = lineRepo.findByVersionIdOrderBySortOrderAscLineCodeAsc(v.getVersionId());
        String expr = com.company.module.rollingplanningsimulation.support.RawMaterialSql.PLAN_PRODUCT_EXPR;
        List<Map<String, Object>> planRows = jdbc.queryForList(
                "SELECT MACHINE_CODE, " + expr + " AS PRODUCT, SUM(GOOD_TON * 100 / (100 - COALESCE(WASTE_RATE_PCT,0))) AS TON," +
                " MIN(CASE WHEN COALESCE(IS_LOCKED,0) = 1 THEN 1 ELSE 0 END) AS LOCKED" +
                " FROM rpsim_production_plan WHERE DIVISION = ? AND `YEAR` = ? AND `MONTH` = ? AND DELETED_YN = 'N'" +
                " AND COALESCE(GOOD_TON,0) > 0 AND COALESCE(WASTE_RATE_PCT,0) < 100" +
                " GROUP BY MACHINE_CODE, " + expr,
                div, Integer.parseInt(ym.substring(0, 4)), Integer.parseInt(ym.substring(4)));
        List<String> warnings = new ArrayList<>();
        String ymTxt = ym.substring(0, 4) + "." + ym.substring(4);
        boolean hasPl = products.stream().anyMatch(p -> p.sim() != null);
        Map<String, Object> src = qtySource(planRows, hasPl);
        if (planRows.isEmpty()) warnings.add(ymTxt + " STEP3 생산계획이 없습니다 — 모든 호기를 생산량 0(운휴 전력만)으로 계산했습니다");
        else if (!((List<?>) src.get("unlockedMachines")).isEmpty())
            warnings.add(ymTxt + " STEP3 생산계획 미확정 호기: " + String.join(", ", (List<String>) src.get("unlockedMachines"))
                    + (hasPl ? " — P/L 시뮬레이터 생산량으로 계산했습니다" : " — 미확정 생산계획으로 계산했습니다") + " (확정하면 확정 생산계획으로 바뀝니다)");
        Map<String, Map<String, BigDecimal>> mt = machineTonFromProducts(planRows, products, str(body.get("machine")), warnings);
        PlReq pr = plRequest(basis, mt.get("base"), mt.get("sim"), warnings);
        return new ProdQty(v, basis, mt, pr, src, warnings);
    }

    /** 전력비 시뮬레이션 탭 — 호기별 기준·시뮬 생산량 (전력 기준정보 생산량 단위로 변환). 계산·저장하지 않음 */
    public Map<String, Object> productionQty(Map<String, Object> body) {
        ProdQty q = prodQty(body);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("division", division(body.get("division"))); res.put("ym", ym(body.get("ym")));
        if (q.version() == null) { res.put("available", false); res.put("reason", "전력비 기준정보가 없습니다"); return res; }
        res.put("available", true);
        res.put("versionId", q.version().getVersionId());
        res.put("source", q.source());
        res.put("lines", q.req().req().values());
        res.put("machineBaseTon", q.machineTon().get("base"));
        res.put("machineSimTon", q.machineTon().get("sim"));
        res.put("warnings", q.warnings());
        return res;
    }

    /**
     * P/L 전력비 — {@link #prodQty} 생산량 → 전력비 계산 (기준정보 kW·생산성·단가 사용). 저장하지 않음.
     * body: {division, ym, machine(ALL/호기), products:[{product, plan, sim}]}  (톤)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> plCost(Map<String, Object> body) {
        String div = division(body.get("division")), ym = ym(body.get("ym"));
        ProdQty q = prodQty(body);
        if (q.version() == null) {
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("division", div); res.put("ym", ym); res.put("available", false);
            res.put("reason", div + " 전력비 기준정보가 없습니다");
            return res;
        }
        List<String> warnings = new ArrayList<>(q.warnings());
        Price price = priceRepo.findFirstByDivisionAndYm(div, ym).map(PowerSimService::toPrice).orElse(null);
        List<Adjust> adjusts = adjustRepo.findByDivisionAndYmOrderByAdjustIdAsc(div, ym).stream().map(PowerSimService::toAdjust).toList();
        Map<String, Object> calc = compute(div, ym, q.version(), q.basis(), q.req().req(), price, adjusts, monthKw(div, ym));
        warnings.addAll((List<String>) calc.get("warnings"));
        calc.put("warnings", warnings);
        calc.put("available", true);
        calc.put("source", q.source());
        calc.put("machineBaseTon", q.machineTon().get("base"));
        calc.put("machineSimTon", q.machineTon().get("sim"));
        calc.put("matched", q.req().matched());
        calc.put("unusedPlanCodes", q.req().unusedPlanCodes());
        calc.remove("simInput"); calc.remove("baseInput");
        return calc;
    }

    // ================================================================ 시나리오

    /** 저장 — 서버에서 다시 계산한 결과를 입력과 함께 스냅샷 저장 (화면이 보낸 결과는 믿지 않음) */
    @Transactional
    public Map<String, Object> saveScenario(Map<String, Object> body) {
        String name = str(body.get("scenarioName"));
        if (name == null) throw new IllegalArgumentException("시나리오 이름을 입력하세요");
        Map<String, Object> calc = calculate(body);
        Map<String, Object> request = new LinkedHashMap<>();
        for (String k : List.of("division", "ym", "versionId", "lines")) request.put(k, body.get(k));
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("request", request);
        input.put("simInput", calc.get("simInput"));
        input.put("baseInput", calc.get("baseInput"));
        input.put("lineInfo", calc.get("lineInfo"));
        input.put("version", calc.get("version"));
        Map<String, Object> result = new LinkedHashMap<>();
        for (String k : List.of("sim", "base", "delta", "warnings", "notice")) result.put(k, calc.get(k));
        Result sim = (Result) calc.get("sim");
        @SuppressWarnings("unchecked") Map<String, Object> vi = (Map<String, Object>) calc.get("version");
        PwSimScenario s = scenarioRepo.save(PwSimScenario.builder().division((String) calc.get("division")).ym((String) calc.get("ym"))
                .scenarioName(cut(name, 200)).basisVersionId((Long) vi.get("versionId")).basisVersionName((String) vi.get("versionName"))
                .basisStatus((String) vi.get("status")).completeYn(sim.complete() ? "Y" : "N").totalKwh(sim.totalKwh())
                .finalCostKrw(sim.finalCost()).inputJson(toJson(input)).resultJson(toJson(result)).memo(cut(str(body.get("memo")), 1000)).build());
        return scenarioInfo(s);
    }

    String toJson(Object o) {
        try { return objectMapper.writeValueAsString(o); }
        catch (JsonProcessingException e) { throw new IllegalStateException("시나리오 저장 실패(JSON): " + e.getMessage(), e); }
    }
    Map<String, Object> fromJson(String s) {
        try { return objectMapper.readValue(s, new TypeReference<Map<String, Object>>() {}); }
        catch (JsonProcessingException e) { throw new IllegalStateException("저장된 시나리오를 읽지 못했습니다: " + e.getMessage(), e); }
    }

    static Map<String, Object> scenarioInfo(PwSimScenario s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("scenarioId", s.getScenarioId());
        m.put("division", s.getDivision());
        m.put("ym", s.getYm());
        m.put("scenarioName", s.getScenarioName());
        m.put("basisVersionId", s.getBasisVersionId());
        m.put("basisVersionName", s.getBasisVersionName());
        m.put("basisStatus", s.getBasisStatus());
        m.put("complete", "Y".equals(s.getCompleteYn()));
        m.put("totalKwh", s.getTotalKwh());
        m.put("finalCostKrw", s.getFinalCostKrw());
        m.put("memo", s.getMemo());
        m.put("savedBy", s.getCreatedBy());
        m.put("savedAt", s.getCreatedAt() == null ? null : s.getCreatedAt().toString());
        return m;
    }

    public List<Map<String, Object>> scenarios(String divisionRaw) {
        return scenarioRepo.findByDivisionOrderByScenarioIdDesc(division(divisionRaw)).stream().map(PowerSimService::scenarioInfo).toList();
    }

    /** 저장 당시 결과 그대로 (다시 계산하지 않음) */
    public Map<String, Object> scenario(Long id) {
        PwSimScenario s = scenarioRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("시나리오를 찾을 수 없습니다: " + id));
        Map<String, Object> res = scenarioInfo(s);
        res.put("input", fromJson(s.getInputJson()));
        res.put("result", fromJson(s.getResultJson()));
        return res;
    }

    /**
     * 최신 기준으로 다시 계산 (명시적 동작) — 저장된 생산량·임시 변경·조정값은 그대로, 기준정보/단가/가산차감은 현재 값.
     * versionId 를 주면 그 버전, 없으면 저장 당시 버전. 결과는 저장하지 않음 (새 시나리오로 저장은 사용자가 선택)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> recalculate(Long id, Long versionId) {
        Map<String, Object> sc = scenario(id);
        Map<String, Object> request = new LinkedHashMap<>((Map<String, Object>) ((Map<String, Object>) sc.get("input")).get("request"));
        if (versionId != null) request.put("versionId", versionId);
        Map<String, Object> calc = calculate(request);
        calc.put("fromScenario", scenarioInfo(scenarioRepo.findById(id).orElseThrow()));
        calc.put("request", request);
        return calc;
    }

    @Transactional public void deleteScenario(Long id) { auditSupport.softDelete(scenarioRepo, id); }
}
