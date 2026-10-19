package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.UploadLog;
import com.company.module.rollingplanningsimulation.repository.UploadLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/upload-logs") @RequiredArgsConstructor
public class UploadLogController {
    private final UploadLogRepository repo;

    /** 업로드 로그 일괄 저장 (프론트에서 업로드 완료 후 호출) */
    @PostMapping("/batch")
    public ResponseEntity<ApiResponse<Map<String,Object>>> saveBatch(@RequestBody List<Map<String,Object>> logs) {
        int saved = 0;
        for (Map<String,Object> log : logs) {
            try {
                repo.save(UploadLog.builder()
                    .uploadBatchId((String) log.get("uploadBatchId"))
                    .refType((String) log.get("refType"))
                    .rowIndex(log.get("rowIndex") != null ? Integer.parseInt(log.get("rowIndex").toString()) : 0)
                    .rowData((String) log.get("rowData"))
                    .status((String) log.getOrDefault("status", "FAIL"))
                    .errorMessage((String) log.get("errorMessage"))
                    .uploadedBy((String) log.get("uploadedBy"))
                    .division((String) log.getOrDefault("division", "PS"))
                    .build());
                saved++;
            } catch (Exception e) { /* skip */ }
        }
        return ResponseEntity.ok(ApiResponse.success(Map.of("saved", saved)));
    }

    /** 배치ID별 로그 조회 */
    @GetMapping
    public ResponseEntity<ApiResponse<List<UploadLog>>> list(
            @RequestParam(required = false) String batchId,
            @RequestParam(defaultValue = "PS") String division) {
        if (batchId != null) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByUploadBatchIdOrderByRowIndexAsc(batchId)));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findTop100ByDivisionOrderByCreatedAtDesc(division)));
    }

    /** 배치ID별 실패 건만 조회 */
    @GetMapping("/failures")
    public ResponseEntity<ApiResponse<List<UploadLog>>> failures(@RequestParam String batchId) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByUploadBatchIdAndStatus(batchId, "FAIL")));
    }
}
