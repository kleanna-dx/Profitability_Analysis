package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.ItfScheduleRule;
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
    private final AuditSupport auditSupport;

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
        String interfaceId = body.get("interfaceId") == null ? "" : body.get("interfaceId").toString().trim();
        if (interfaceId.isEmpty()) throw new IllegalArgumentException("인터페이스를 선택하세요.");
        String type = normType(body.getOrDefault("scheduleType","manual"));
        LocalTime time = parseTime(body.get("execTime"));
        LocalDateTime onceAt = parseDT(body.get("execDatetime"));
        Integer day = parseINullable(body.get("execDayOfMonth"));
        ItfScheduleRule.validate(type, time, day, onceAt);
        RpsimItfSchedule e = RpsimItfSchedule.builder()
            .interfaceId(interfaceId)
            .scheduleType(type)
            .execTime(time)
            .execDatetime(onceAt)
            .execDayOfMonth(day)
            .targetMonth(ItfScheduleRule.normalizeTargetMonth(body.get("targetMonth")))
            .execMode((String)body.get("execMode"))
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .remark((String)body.get("remark"))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        refreshNext(e);
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 수정 */
    @PutMapping("/{id}")
    @SuppressWarnings("unchecked")
    public ResponseEntity update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        RpsimItfSchedule e = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("스케줄을 찾을 수 없습니다: " + id));
        String type = body.containsKey("scheduleType") ? normType(body.get("scheduleType")) : e.getScheduleType();
        LocalTime time = body.containsKey("execTime") ? parseTime(body.get("execTime")) : e.getExecTime();
        LocalDateTime onceAt = body.containsKey("execDatetime") ? parseDT(body.get("execDatetime")) : e.getExecDatetime();
        Integer day = body.containsKey("execDayOfMonth") ? parseINullable(body.get("execDayOfMonth")) : e.getExecDayOfMonth();
        ItfScheduleRule.validate(type, time, day, onceAt);
        e.update(
            type, time, onceAt, day,
            body.containsKey("targetMonth") ? ItfScheduleRule.normalizeTargetMonth(body.get("targetMonth")) : e.getTargetMonth(),
            body.containsKey("execMode") ? (String)body.get("execMode") : e.getExecMode(),
            body.containsKey("isActive") ? Boolean.parseBoolean(body.get("isActive").toString()) : e.getIsActive(),
            body.containsKey("remark") ? (String)body.get("remark") : e.getRemark(),
            (String)body.get("updatedBy")
        );
        refreshNext(e);
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 수동 실행 (이력 생성은 ItfHistoryController에서 / 여기서는 상태 갱신만) */
    @PostMapping("/{id}/run")
    public ResponseEntity<ApiResponse<RpsimItfSchedule>> markRun(@PathVariable Long id) {
        RpsimItfSchedule e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.markResult("running", ItfScheduleRule.now());
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
        refreshNext(e);
        repo.save(e);
        Map<String,Object> r = new java.util.LinkedHashMap<>();
        r.put("scheduleId", id);
        r.put("is_active", newState);
        return ResponseEntity.ok(ApiResponse.success(r));
    }

    /* 삭제 */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /** 다음 실행 예정 재계산 — 비활성·manual 이면 비움 (지금 이후 첫 회차부터) */
    private void refreshNext(RpsimItfSchedule e) {
        if (!Boolean.TRUE.equals(e.getIsActive()) || !ItfScheduleRule.isAuto(e.getScheduleType())) {
            e.changeNextRunAt(null);
            return;
        }
        LocalDateTime now = ItfScheduleRule.now();
        e.changeNextRunAt(ItfScheduleRule.next(e.getScheduleType(), e.getExecTime(), e.getExecDayOfMonth(),
                e.getExecDatetime(), e.getLastRunAt(), now));
    }

    private String normType(Object v) {
        String t = v == null ? "manual" : v.toString().trim().toLowerCase();
        return t.isEmpty() ? "manual" : t;
    }

    /** HH:mm 또는 HH:mm:ss. 형식이 틀리면 오류 (빈 값은 null) */
    private LocalTime parseTime(Object v) {
        if (v == null || v.toString().trim().isEmpty()) return null;
        try { return LocalTime.parse(v.toString().trim()); }
        catch (Exception e) { throw new IllegalArgumentException("실행 시각은 HH:mm 형식입니다: " + v); }
    }
    /** yyyy-mm-ddTHH:mm 또는 yyyy-mm-dd HH:mm. 형식이 틀리면 오류 (빈 값은 null) */
    private LocalDateTime parseDT(Object v) {
        if (v == null || v.toString().trim().isEmpty()) return null;
        try { return LocalDateTime.parse(v.toString().trim().replace(' ', 'T')); }
        catch (Exception e) { throw new IllegalArgumentException("실행일시는 yyyy-mm-dd HH:mm 형식입니다: " + v); }
    }
    private Integer parseINullable(Object v) {
        if (v == null) return null;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return null; }
    }
}
