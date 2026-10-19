package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.ProductionPlan;
import com.company.module.rollingplanningsimulation.repository.ProductionPlanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/production-plans") @RequiredArgsConstructor
public class ProductionPlanController {
    private final ProductionPlanRepository repo;

    /** 조회: 호기/월 기준 */
    @GetMapping
    public ResponseEntity<ApiResponse<List<ProductionPlan>>> list(
            @RequestParam Integer year, @RequestParam Integer month,
            @RequestParam(required = false) String machineCode,
            @RequestParam(defaultValue = "PS") String division) {
        List<ProductionPlan> list = machineCode != null
            ? repo.findByYearAndMonthAndMachineCodeAndDivision(year, month, machineCode, division)
            : repo.findByYearAndMonthAndDivision(year, month, division);
        return ResponseEntity.ok(ApiResponse.success(list));
    }

    /** 일괄 저장 (upsert) */
    @PostMapping("/batch")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> saveBatch(@RequestBody Map<String, Object> body) {
        Integer year = parseInt(body.get("year"));
        Integer month = parseInt(body.get("month"));
        String mc = str(body.get("machineCode"));
        String div = str(body.getOrDefault("division", "PS"));
        String userId = str(body.get("createdBy"));
        BigDecimal opDays = parseBD(body.get("operationDays"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) body.get("rows");

        // 잠금 상태 체크
        List<ProductionPlan> existing = repo.findByYearAndMonthAndMachineCodeAndDivision(year, month, mc, div);
        boolean anyLocked = existing.stream().anyMatch(p -> Boolean.TRUE.equals(p.getIsLocked()));
        if (anyLocked) {
            return ResponseEntity.badRequest().body(ApiResponse.success(Map.of("error", "LOCKED", "message", "계획이 확정(잠금)되어 수정할 수 없습니다.")));
        }

        // 기존 데이터 삭제 후 재등록
        repo.deleteAll(existing);
        repo.flush();

        int saved = 0;
        if (rows != null) {
            for (Map<String, Object> row : rows) {
                ProductionPlan e = ProductionPlan.builder()
                    .division(div).machineCode(mc).year(year).month(month)
                    .product(str(row.get("product")))
                    .basisWeight(parseBD(row.get("basisWeight")))
                    .trimWidth(parseBD(row.get("trimWidth")))
                    .theoryProdTpd(parseBD(row.get("theoryProdTpd")))
                    .wasteRatePct(parseBD(row.get("wasteRatePct")))
                    .goodTon(parseBD(row.get("goodTon")))
                    .operationDays(opDays)
                    .createdBy(userId)
                    .build();
                repo.save(e);
                saved++;
            }
        }
        return ResponseEntity.ok(ApiResponse.success(Map.of("saved", saved)));
    }

    /** 잠금(확정) */
    @PostMapping("/lock")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> lock(@RequestBody Map<String, Object> body) {
        Integer year = parseInt(body.get("year"));
        Integer month = parseInt(body.get("month"));
        String mc = str(body.get("machineCode"));
        String div = str(body.getOrDefault("division", "PS"));
        String userId = str(body.get("userId"));
        int cnt = repo.lockByMachineCode(year, month, mc, div, userId);
        return ResponseEntity.ok(ApiResponse.success(Map.of("locked", cnt, "lockedBy", userId)));
    }

    /** 잠금해제 */
    @PostMapping("/unlock")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> unlock(@RequestBody Map<String, Object> body) {
        Integer year = parseInt(body.get("year"));
        Integer month = parseInt(body.get("month"));
        String mc = str(body.get("machineCode"));
        String div = str(body.getOrDefault("division", "PS"));
        int cnt = repo.unlockByMachineCode(year, month, mc, div);
        return ResponseEntity.ok(ApiResponse.success(Map.of("unlocked", cnt)));
    }

    private Integer parseInt(Object v) { if(v==null)return null; try{return Integer.parseInt(v.toString().trim());}catch(Exception e){return null;} }
    private BigDecimal parseBD(Object v) { if(v==null)return null; String s=v.toString().trim(); if(s.isEmpty())return null; try{return new BigDecimal(s);}catch(Exception e){return null;} }
    private String str(Object v) { return v!=null?v.toString():null; }
}
