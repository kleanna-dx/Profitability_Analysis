package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.entity.RpsimItfSchedule;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import com.company.module.rollingplanningsimulation.repository.RpsimItfScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/itf-histories") @RequiredArgsConstructor
public class RpsimItfHistoryController {
    private final RpsimItfHistoryRepository histRepo;
    private final RpsimItfScheduleRepository schedRepo;

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

    /* 수동 실행 시작 → 이력 pending 생성 */
    @PostMapping("/start")
    public ResponseEntity<ApiResponse<RpsimItfHistory>> startExec(@RequestBody Map<String,Object> body) {
        String interfaceId = (String) body.get("interfaceId");
        String interfaceName = (String) body.get("interfaceName");
        String jobType = (String) body.getOrDefault("jobType", "MANUAL_SYNC");
        String execMode = (String) body.getOrDefault("execMode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory h = RpsimItfHistory.builder()
            .interfaceId(interfaceId)
            .interfaceName(interfaceName)
            .jobType(jobType)
            .execMode(execMode)
            .status("running")
            .startedAt(LocalDateTime.now())
            .executedBy(executedBy)
            .build();
        RpsimItfHistory saved = histRepo.save(h);

        // 관련 스케줄 상태도 running으로 갱신
        List<RpsimItfSchedule> schedules = schedRepo.findByInterfaceIdOrderByScheduleIdAsc(interfaceId);
        for (RpsimItfSchedule s : schedules) {
            s.updateRunStatus("running", LocalDateTime.now(), null);
            schedRepo.save(s);
        }

        return ResponseEntity.ok(ApiResponse.success(saved));
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
            ? (int) java.time.Duration.between(h.getStartedAt(), now).toMillis()
            : 0;

        h.complete(status, now, durationMs, processCount, errorMessage);
        RpsimItfHistory saved = histRepo.save(h);

        // 관련 스케줄 상태 갱신
        List<RpsimItfSchedule> schedules = schedRepo.findByInterfaceIdOrderByScheduleIdAsc(h.getInterfaceId());
        for (RpsimItfSchedule s : schedules) {
            s.updateRunStatus(status, now, null);
            schedRepo.save(s);
        }

        return ResponseEntity.ok(ApiResponse.success(saved));
    }

    /* 삭제 (이력 정리) */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        histRepo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
