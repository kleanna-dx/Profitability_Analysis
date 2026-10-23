package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.RpsimItfSchedule;
import com.company.module.rollingplanningsimulation.repository.RpsimItfScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/itf-schedules") @RequiredArgsConstructor
public class RpsimItfScheduleController {
    private final RpsimItfScheduleRepository repo;

    /* 전체 목록 or 인터페이스별 */
    @GetMapping
    public ResponseEntity<ApiResponse<List<RpsimItfSchedule>>> list(
            @RequestParam(required=false) String interfaceId) {
        if (interfaceId != null && !interfaceId.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByInterfaceIdOrderByScheduleIdAsc(interfaceId)));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findAllByOrderByInterfaceIdAscScheduleIdAsc()));
    }

    /* 등록 */
    @PostMapping
    public ResponseEntity<ApiResponse<RpsimItfSchedule>> save(@RequestBody Map<String,Object> body) {
        RpsimItfSchedule e = RpsimItfSchedule.builder()
            .interfaceId((String)body.get("interfaceId"))
            .scheduleType((String)body.getOrDefault("scheduleType","manual"))
            .execTime(parseTime(body.get("execTime")))
            .execDatetime(parseDT(body.get("execDatetime")))
            .execDayOfMonth(parseINullable(body.get("execDayOfMonth")))
            .targetMonth((String)body.get("targetMonth"))
            .execMode((String)body.get("execMode"))
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .remark((String)body.get("remark"))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 수정 */
    @PutMapping("/{id}")
    @SuppressWarnings("unchecked")
    public ResponseEntity update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        RpsimItfSchedule e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.update(
            body.containsKey("scheduleType") ? (String)body.get("scheduleType") : e.getScheduleType(),
            body.containsKey("execTime") ? parseTime(body.get("execTime")) : e.getExecTime(),
            body.containsKey("execDatetime") ? parseDT(body.get("execDatetime")) : e.getExecDatetime(),
            body.containsKey("execDayOfMonth") ? parseINullable(body.get("execDayOfMonth")) : e.getExecDayOfMonth(),
            body.containsKey("targetMonth") ? (String)body.get("targetMonth") : e.getTargetMonth(),
            body.containsKey("execMode") ? (String)body.get("execMode") : e.getExecMode(),
            body.containsKey("isActive") ? Boolean.parseBoolean(body.get("isActive").toString()) : e.getIsActive(),
            body.containsKey("remark") ? (String)body.get("remark") : e.getRemark(),
            (String)body.get("updatedBy")
        );
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 수동 실행 (이력 생성은 ItfHistoryController에서 / 여기서는 상태 갱신만) */
    @PostMapping("/{id}/run")
    public ResponseEntity<ApiResponse<RpsimItfSchedule>> markRun(@PathVariable Long id) {
        RpsimItfSchedule e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.updateRunStatus("running", LocalDateTime.now(), null);
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 활성/비활성 토글 */
    @PostMapping("/{id}/toggle")
    public ResponseEntity<ApiResponse<Map<String,Object>>> toggle(@PathVariable Long id) {
        RpsimItfSchedule e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        boolean newState = !Boolean.TRUE.equals(e.getIsActive());
        e.update(e.getScheduleType(), e.getExecTime(), e.getExecDatetime(),
                e.getExecDayOfMonth(), e.getTargetMonth(), e.getExecMode(),
                newState, e.getRemark(), e.getUpdatedBy());
        repo.save(e);
        Map<String,Object> r = new java.util.LinkedHashMap<>();
        r.put("scheduleId", id);
        r.put("is_active", newState);
        return ResponseEntity.ok(ApiResponse.success(r));
    }

    /* 삭제 */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private LocalTime parseTime(Object v) {
        if (v == null) return null;
        try { return LocalTime.parse(v.toString().trim()); } catch (Exception e) { return null; }
    }
    private LocalDateTime parseDT(Object v) {
        if (v == null) return null;
        try { return LocalDateTime.parse(v.toString().trim()); } catch (Exception e) { return null; }
    }
    private Integer parseINullable(Object v) {
        if (v == null) return null;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return null; }
    }
}
