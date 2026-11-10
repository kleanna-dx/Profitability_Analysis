package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SalesCode;
import com.company.module.rollingplanningsimulation.entity.SalesGrade;
import com.company.module.rollingplanningsimulation.repository.SalesCodeRepository;
import com.company.module.rollingplanningsimulation.repository.SalesGradeRepository;
import com.company.module.rollingplanningsimulation.service.SalesPlanService;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.CurrentUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 판매계획 — 기준정보(판매 코드·판매 지종) / 업로드 / 버전 / 조회
 * 기준정보 등록: UK 같으면 덮어씀 / 수정: 지정 행만 / 삭제: 소프트 삭제. 기본값 없음 (필수값 누락 시 오류)
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/sales-plan")
@RequiredArgsConstructor
public class SalesPlanController {

    private final SalesPlanService service;
    private final SalesCodeRepository codeRepo;
    private final SalesGradeRepository gradeRepo;
    private final AuditSupport auditSupport;

    private static final String[] UK_CODE = {"codeType", "codeName"};
    private static final String[] UK_GRADE = {"division", "productType", "gradeName"};

    private static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    private static Integer intOrNull(Object o, String label) {
        String s = str(o);
        if (s == null) return null;
        try { return Integer.valueOf(s); } catch (NumberFormatException e) { throw new IllegalArgumentException(label + "는 정수입니다: " + s); }
    }

    // ── 판매 코드 (판매구분 / 제품유형 / 국가 — 전사 공통) ──
    @GetMapping("/codes")
    public ResponseEntity<ApiResponse<List<SalesCode>>> codes() {
        return ResponseEntity.ok(ApiResponse.success(codeRepo.findAllByOrderByCodeTypeAscSortOrderAscCodeNameAsc()));
    }

    @PostMapping("/codes")
    public ResponseEntity<ApiResponse<SalesCode>> saveCode(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistCode(null, b)));
    }

    @PutMapping("/codes/{id}")
    public ResponseEntity<ApiResponse<SalesCode>> updateCode(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistCode(id, b)));
    }

    @DeleteMapping("/codes/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteCode(@PathVariable Long id) {
        SalesCode c = codeRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        if (SalesPlanService.PRODUCT_TYPE.equals(c.getCodeType()) && gradeRepo.existsByProductType(c.getCodeName()))
            throw new IllegalStateException("판매 지종에서 쓰는 제품유형입니다: " + c.getCodeName() + " — 해당 지종을 먼저 삭제하거나 '미사용'으로 바꾸세요");
        auditSupport.softDelete(codeRepo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private SalesCode persistCode(Long id, Map<String, Object> b) {
        String type = str(b.get("codeType"));
        if (type == null || !SalesPlanService.CODE_TYPES.contains(type))
            throw new IllegalArgumentException("코드 종류는 판매구분 / 제품유형 / 국가 중 하나여야 합니다: " + type);
        String name = str(b.get("codeName"));
        if (name == null) throw new IllegalArgumentException("코드명을 입력하세요");
        if (name.length() > 100) throw new IllegalArgumentException("코드명은 100자 이내입니다");
        String countryYn = SalesPlanService.SALES_TYPE.equals(type) ? str(b.get("countryYn")) : "N";
        SalesCode e = SalesCode.builder().codeType(type).codeName(name).countryYn(countryYn)
                .sortOrder(intOrNull(b.get("sortOrder"), "정렬순서")).useYn(str(b.get("useYn"))).memo(str(b.get("memo"))).build();
        return id != null ? auditSupport.updateById(codeRepo, id, e, UK_CODE) : auditSupport.upsert(codeRepo, e, UK_CODE);
    }

    // ── 판매 지종 (사업부별) ──
    @GetMapping("/grades")
    public ResponseEntity<ApiResponse<List<SalesGrade>>> grades(@RequestParam String division) {
        return ResponseEntity.ok(ApiResponse.success(gradeRepo.findByDivisionOrderBySortOrderAscGradeNameAsc(SalesPlanService.normDivision(division))));
    }

    @PostMapping("/grades")
    public ResponseEntity<ApiResponse<SalesGrade>> saveGrade(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistGrade(null, b)));
    }

    @PutMapping("/grades/{id}")
    public ResponseEntity<ApiResponse<SalesGrade>> updateGrade(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistGrade(id, b)));
    }

    @DeleteMapping("/grades/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteGrade(@PathVariable Long id) {
        auditSupport.softDelete(gradeRepo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private SalesGrade persistGrade(Long id, Map<String, Object> b) {
        String division = SalesPlanService.normDivision(b.get("division"));
        String pt = str(b.get("productType"));
        if (pt == null) throw new IllegalArgumentException("제품유형을 선택하세요");
        if (codeRepo.findByCodeTypeOrderBySortOrderAscCodeNameAsc(SalesPlanService.PRODUCT_TYPE).stream().noneMatch(c -> c.getCodeName().equals(pt)))
            throw new IllegalArgumentException("판매 코드에 없는 제품유형입니다: " + pt + " ([판매 코드] 탭에서 먼저 등록)");
        String gn = str(b.get("gradeName"));
        if (gn == null) throw new IllegalArgumentException("지종명을 입력하세요");
        if (gn.length() > 100) throw new IllegalArgumentException("지종명은 100자 이내입니다");
        SalesGrade e = SalesGrade.builder().division(division).productType(pt).gradeName(gn).prodProduct(str(b.get("prodProduct")))
                .sortOrder(intOrNull(b.get("sortOrder"), "정렬순서")).useYn(str(b.get("useYn"))).memo(str(b.get("memo"))).build();
        return id != null ? auditSupport.updateById(gradeRepo, id, e, UK_GRADE) : auditSupport.upsert(gradeRepo, e, UK_GRADE);
    }

    /**
     * 업로드에서 발견된 미등록 값 일괄 등록 — 화면에서 사용자가 목록을 확인하고 [등록]을 눌렀을 때만 호출 (자동 등록 없음)
     * body: {division, codes:[{codeType, codeName, countryYn}], grades:[{productType, gradeName, prodProduct}]}
     * 이미 있는 값은 건너뜀 (덮어쓰지 않음). 정렬순서는 비워 둠
     */
    @PostMapping("/masters/bulk")
    @SuppressWarnings("unchecked")
    public ResponseEntity<ApiResponse<Map<String, Object>>> bulkRegister(@RequestBody Map<String, Object> b) {
        String division = SalesPlanService.normDivision(b.get("division"));
        List<Map<String, Object>> codes = b.get("codes") instanceof List ? (List<Map<String, Object>>) b.get("codes") : List.of();
        List<Map<String, Object>> grades = b.get("grades") instanceof List ? (List<Map<String, Object>>) b.get("grades") : List.of();
        // 정렬순서: 비어 있으면 같은 종류의 마지막 정렬순서 다음 (파일에 나온 순서 유지, 10 단위)
        java.util.Set<String> haveCodes = new java.util.HashSet<>();
        Map<String, Integer> maxSort = new java.util.HashMap<>();
        for (SalesCode c : codeRepo.findAllByOrderByCodeTypeAscSortOrderAscCodeNameAsc()) {
            haveCodes.add((c.getCodeType() + "|" + c.getCodeName()).toLowerCase());
            if (c.getSortOrder() != null) maxSort.merge(c.getCodeType(), c.getSortOrder(), Math::max);
        }
        int codeAdded = 0, gradeAdded = 0;
        // 제품유형을 먼저 등록해야 지종 검증을 통과함
        for (Map<String, Object> c : codes) {
            String type = str(c.get("codeType"));
            String key = (type + "|" + str(c.get("codeName"))).toLowerCase(); // 대소문자만 다른 값은 건너뜀 (덮어쓰기 방지)
            if (haveCodes.contains(key)) continue;
            Map<String, Object> m = new java.util.HashMap<>(c);
            if (str(m.get("sortOrder")) == null) { int next = maxSort.getOrDefault(type, 0) + 10; m.put("sortOrder", next); maxSort.put(type, next); }
            persistCode(null, m);
            haveCodes.add(key);
            codeAdded++;
        }
        java.util.Set<String> haveGrades = new java.util.HashSet<>();
        int gradeMax = 0;
        for (SalesGrade g : gradeRepo.findByDivisionOrderBySortOrderAscGradeNameAsc(division)) {
            haveGrades.add((g.getProductType() + "|" + g.getGradeName()).toLowerCase());
            if (g.getSortOrder() != null) gradeMax = Math.max(gradeMax, g.getSortOrder());
        }
        for (Map<String, Object> g : grades) {
            String key = (str(g.get("productType")) + "|" + str(g.get("gradeName"))).toLowerCase();
            if (haveGrades.contains(key)) continue;
            Map<String, Object> m = new java.util.HashMap<>(g);
            m.put("division", division);
            if (str(m.get("sortOrder")) == null) { gradeMax += 10; m.put("sortOrder", gradeMax); }
            persistGrade(null, m);
            haveGrades.add(key);
            gradeAdded++;
        }
        return ResponseEntity.ok(ApiResponse.success(Map.of("codeAdded", codeAdded, "gradeAdded", gradeAdded)));
    }

    // ── 업로드 / 버전 ──
    /** 양식 드롭다운·검증용 — 사용중 코드 + 사업부 지종 */
    @GetMapping("/masters")
    public ResponseEntity<ApiResponse<Map<String, Object>>> masters(@RequestParam String division) {
        return ResponseEntity.ok(ApiResponse.success(service.masters(division)));
    }

    /** 업로드 — 오류 있으면 저장 안 함, 같은 사업부·시작월 있으면 needConfirm (replace=true 로 다시 호출) */
    @PostMapping("/upload")
    public ResponseEntity<ApiResponse<Map<String, Object>>> upload(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(ApiResponse.success(service.upload(body)));
    }

    @GetMapping("/versions")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> versions(@RequestParam String division) {
        return ResponseEntity.ok(ApiResponse.success(service.versions(division)));
    }

    @GetMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> detail(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(service.detail(id)));
    }

    @DeleteMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        service.deleteVersion(id, CurrentUser.get());
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /** 기준월 판매계획 (사용중 버전 중 시작월이 가장 늦은 것) */
    @GetMapping("/current")
    public ResponseEntity<ApiResponse<Map<String, Object>>> current(@RequestParam String ym, @RequestParam String division) {
        return ResponseEntity.ok(ApiResponse.success(service.current(ym, division)));
    }
}
