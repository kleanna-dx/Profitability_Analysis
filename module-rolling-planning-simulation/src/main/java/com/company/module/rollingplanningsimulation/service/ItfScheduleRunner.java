package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.RpsimItfMaster;
import com.company.module.rollingplanningsimulation.entity.RpsimItfSchedule;
import com.company.module.rollingplanningsimulation.repository.RpsimItfMasterRepository;
import com.company.module.rollingplanningsimulation.repository.RpsimItfScheduleRepository;
import com.company.module.rollingplanningsimulation.support.ItfScheduleRule;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 인터페이스 수행 스케줄 자동 실행기 (rpsim_itf_schedule)
 *
 * <ul>
 *   <li>1분마다 활성 스케줄 중 NEXT_RUN_AT 이 지난 건을 실행 (한국시간 기준)</li>
 *   <li>NEXT_RUN_AT 이 비어 있으면 다음 실행 시각만 계산해 두고 이번에는 실행하지 않음</li>
 *   <li>서버가 꺼져 있어 실행 시각을 놓쳤으면 다음 기동 후 1회만 실행 (밀린 횟수만큼 반복하지 않음)</li>
 *   <li>실행은 수동 실행(▶)과 같은 ItfExecutionService 사용 → 이력도 동일하게 남음</li>
 *   <li>사업부: 현재 PS 고정 (rpsim.itf-schedule.division)</li>
 *   <li>서버 1대 운영 기준 — 여러 대로 늘리면 중복 실행 방지(DB 잠금) 필요</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ItfScheduleRunner {

    public static final String EXECUTED_BY = "SCHEDULER";

    private final RpsimItfScheduleRepository schedRepo;
    private final RpsimItfMasterRepository masterRepo;
    private final ItfExecutionService executionService;

    @Value("${rpsim.itf-schedule.enabled:true}")
    private boolean enabled;

    @Value("${rpsim.itf-schedule.division:PS}")
    private String division;

    /** 이전 실행이 길어져도 겹쳐 돌지 않도록 */
    private final AtomicBoolean running = new AtomicBoolean(false);

    @Scheduled(initialDelay = 30_000, fixedDelay = 60_000)
    public void tick() {
        if (!enabled) return;
        if (!running.compareAndSet(false, true)) {
            log.warn("[ItfSchedule] 이전 실행이 아직 끝나지 않아 이번 회차는 건너뜁니다");
            return;
        }
        try {
            List<RpsimItfSchedule> list = schedRepo.findByIsActiveTrueOrderByInterfaceIdAsc();
            for (RpsimItfSchedule s : list) {
                try {
                    handle(s);
                } catch (Exception e) {
                    log.error("[ItfSchedule] 스케줄 #{} 처리 실패: {}", s.getScheduleId(), e.getMessage(), e);
                }
            }
        } catch (Exception e) {
            log.error("[ItfSchedule] 스케줄 조회 실패: {}", e.getMessage(), e);
        } finally {
            running.set(false);
        }
    }

    private void handle(RpsimItfSchedule s) {
        String type = s.getScheduleType();
        if (!ItfScheduleRule.isAuto(type)) return;

        LocalDateTime now = ItfScheduleRule.now();
        LocalDateTime due = s.getNextRunAt();

        // 다음 실행 예정이 없으면 계산만 하고 종료 (등록 직후·기존 데이터)
        if (due == null) {
            LocalDateTime next = ItfScheduleRule.next(type, s.getExecTime(), s.getExecDayOfMonth(),
                    s.getExecDatetime(), s.getLastRunAt(), now);
            if (next != null) {
                s.changeNextRunAt(next);
                schedRepo.save(s);
                log.info("[ItfSchedule] #{} {} 다음 실행 예정 설정: {}", s.getScheduleId(), s.getInterfaceId(), next);
            }
            return;
        }
        if (due.isAfter(now)) return;

        // 실행 전에 다음 예정부터 갱신 — 실행이 실패·지연돼도 같은 회차를 반복 실행하지 않음
        LocalDateTime next = "once".equals(type) ? null
                : ItfScheduleRule.next(type, s.getExecTime(), s.getExecDayOfMonth(), s.getExecDatetime(), now, now);
        s.changeNextRunAt(next);
        schedRepo.save(s);

        String cmonth = ItfScheduleRule.resolveTargetMonth(s.getTargetMonth(), now);
        RpsimItfMaster master = masterRepo.findById(s.getInterfaceId()).orElse(null);
        if (master == null) {
            log.warn("[ItfSchedule] #{} 인터페이스 마스터 없음: {}", s.getScheduleId(), s.getInterfaceId());
            s.markResult("failed", now);
            schedRepo.save(s);
            return;
        }
        if (Boolean.FALSE.equals(master.getIsActive())) {
            log.info("[ItfSchedule] #{} 인터페이스 {} 비활성 — 건너뜀", s.getScheduleId(), s.getInterfaceId());
            s.markResult("skipped", now);
            schedRepo.save(s);
            return;
        }

        String mode = s.getExecMode() != null && !s.getExecMode().isBlank()
                ? s.getExecMode().trim().toLowerCase()
                : (master.getExecMode() != null ? master.getExecMode().trim().toLowerCase() : "replace");

        log.info("[ItfSchedule] #{} 실행 — interface={}, 예정={}, 대상년월={}, mode={}, division={}",
                s.getScheduleId(), s.getInterfaceId(), due, cmonth, mode, division);
        Map<String, Object> result = executionService.execute(s.getInterfaceId(), cmonth, mode, EXECUTED_BY, division);
        if (result.containsKey("error")) {
            log.error("[ItfSchedule] #{} 실행 실패 — {}", s.getScheduleId(), result.get("error"));
        } else {
            log.info("[ItfSchedule] #{} 실행 완료 — historyId={}, 다음 예정={}", s.getScheduleId(), result.get("historyId"), next);
        }
    }
}
