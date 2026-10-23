package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import com.company.module.rollingplanningsimulation.service.ItfExecutionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/itf-histories") @RequiredArgsConstructor
public class RpsimItfHistoryController {
    private final RpsimItfHistoryRepository histRepo;
    private final ItfExecutionService execService;

    /* 최근 이력 (전체) */
    @GetMapping
    public ResponseEntity<ApiResponse<List<RpsimItfHistory>>> list(
            @RequestParam(required=false) String interfaceId,
            @RequestParam(required=false) String status) {
        if (interfaceId != null && !interfaceId.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.success(histRepo.findByInterfaceIdOrderByCreatedAtDesc(interfaceId)));
        }
        if (status != null && !status.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.success(histRepo.findByStatusOrderByCreatedAtDesc(status)));
        }
        return ResponseEntity.ok(ApiResponse.success(histRepo.findTop100ByOrderByCreatedAtDesc()));
    }

    /* 단건 상세 조회 (로그 포함) */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<RpsimItfHistory>> detail(@PathVariable Long id) {
        RpsimItfHistory h = histRepo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        return ResponseEntity.ok(ApiResponse.success(h));
    }

    /* 수동 실행 시작 → 이력 pending 생성 */
    @PostMapping("/start")
    public ResponseEntity<ApiResponse<RpsimItfHistory>> startExec(@RequestBody Map<String,Object> body) {
        String interfaceId = (String) body.get("interfaceId");
        String interfaceName = (String) body.get("interfaceName");
        String jobType = (String) body.getOrDefault("jobType", "MANUAL_SYNC");
        String execMode = (String) body.getOrDefault("execMode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory h = RpsimItfHistory.builder()
            .interfaceId(interfaceId).interfaceName(interfaceName)
            .jobType(jobType).execMode(execMode).status("running")
            .startedAt(LocalDateTime.now()).executedBy(executedBy)
            .build();
        return ResponseEntity.ok(ApiResponse.success(histRepo.save(h)));
    }

    /* 실행 완료 처리 */
    @PostMapping("/{id}/complete")
    public ResponseEntity<ApiResponse<RpsimItfHistory>> completeExec(
            @PathVariable Long id, @RequestBody Map<String,Object> body) {
        RpsimItfHistory h = histRepo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        String status = (String) body.getOrDefault("status", "success");
        int processCount = body.get("processCount") != null ? Integer.parseInt(body.get("processCount").toString()) : 0;
        String errorMessage = (String) body.get("errorMessage");
        LocalDateTime now = LocalDateTime.now();
        int durationMs = h.getStartedAt() != null
            ? (int) java.time.Duration.between(h.getStartedAt(), now).toMillis() : 0;
        h.complete(status, now, durationMs, processCount, errorMessage);
        return ResponseEntity.ok(ApiResponse.success(histRepo.save(h)));
    }

    /* ★ 동적 실행 — 마스터의 rfc_func_or_url 기반 라우팅 */
    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<Map<String,Object>>> execute(@RequestBody Map<String,Object> body) {
        String interfaceId = (String) body.get("interfaceId");
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");
        try {
            Map<String,Object> result = execService.execute(interfaceId, cmonth, mode, executedBy);
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /* ★ 재수행 — 실패한 이력의 동일 조건으로 재실행 */
    @PostMapping("/{id}/rerun")
    public ResponseEntity<ApiResponse<Map<String,Object>>> rerun(@PathVariable Long id) {
        RpsimItfHistory orig = histRepo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        try {
            Map<String,Object> result = execService.execute(
                    orig.getInterfaceId(), orig.getCmonth(),
                    orig.getExecMode(), orig.getExecutedBy());
            result.put("rerunFromHistoryId", id);
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage(), "rerunFromHistoryId", id)));
        }
    }

    /* 삭제 */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        histRepo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
