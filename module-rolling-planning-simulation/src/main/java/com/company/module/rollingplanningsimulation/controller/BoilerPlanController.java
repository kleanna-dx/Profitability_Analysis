package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerPlan;
import com.company.module.rollingplanningsimulation.repository.BoilerPlanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-plans") @RequiredArgsConstructor
public class BoilerPlanController {
    private final BoilerPlanRepository repo;
    private final AuditSupport auditSupport;
    @GetMapping public ResponseEntity<ApiResponse<List<BoilerPlan>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BoilerPlan>> save(@RequestBody Map<String,Object> body) {
        BoilerPlan e = BoilerPlan.builder().year(Integer.parseInt(body.get("year").toString()))
            .month(Integer.parseInt(body.get("month").toString()))
            .boilerCode((String)body.get("boilerCode"))
            .division((String)body.getOrDefault("division","PS"))
            .totalDays(body.get("totalDays")!=null?new BigDecimal(body.get("totalDays").toString()):BigDecimal.ZERO)
            .shutdownDays(body.get("shutdownDays")!=null?new BigDecimal(body.get("shutdownDays").toString()):BigDecimal.ZERO)
            .operationDays(body.get("operationDays")!=null?new BigDecimal(body.get("operationDays").toString()):BigDecimal.ZERO)
            .operationHours(body.get("operationHours")!=null?new BigDecimal(body.get("operationHours").toString()):BigDecimal.ZERO)
            .memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null)); }

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"year", "month", "boilerCode", "division"};
    private BoilerPlan persist(BoilerPlan e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
