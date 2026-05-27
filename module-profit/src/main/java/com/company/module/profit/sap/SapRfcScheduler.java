package com.company.module.profit.sap;

import com.company.module.profit.entity.BatchStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * SAP RFC 동기화 스케줄러
 *
 * <p>기본 동작:</p>
 * <ul>
 *   <li>매월 1일 새벽 2시에 전월 데이터를 자동 동기화</li>
 *   <li>replace 모드로 실행 (기존 데이터 삭제 후 INSERT)</li>
 *   <li>동시 실행 방지 (실행 중인 배치가 있으면 스킵)</li>
 * </ul>
 *
 * <p>스케줄 변경:</p>
 * application.yml에서 cron 표현식 수정 가능:
 * <pre>
 * sap:
 *   rfc:
 *     schedule:
 *       enabled: true
 *       cron: "0 0 2 1 * *"   # 매월 1일 02:00
 * </pre>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SapRfcScheduler {

    private final SapRfcSyncService sapRfcSyncService;

    /** 스케줄 활성화 여부 (기본: false — 운영 설정에서 true로 변경) */
    @Value("${sap.rfc.schedule.enabled:false}")
    private boolean scheduleEnabled;

    /**
     * 매월 1일 새벽 2시 — 전월 데이터 자동 동기화
     *
     * cron = "초 분 시 일 월 요일"
     * "0 0 2 1 * *" = 매월 1일 02:00:00
     */
    @Scheduled(cron = "${sap.rfc.schedule.cron:0 0 2 1 * *}")
    public void monthlySync() {
        if (!scheduleEnabled) {
            log.debug("[스케줄러] SAP RFC 자동 동기화 비활성화 상태");
            return;
        }

        // 실행 중인 배치가 있으면 스킵
        if (sapRfcSyncService.hasRunningBatch()) {
            log.warn("[스케줄러] 이미 실행 중인 배치가 있어 스킵합니다");
            return;
        }

        // 전월 년월 계산
        LocalDate lastMonth = LocalDate.now().minusMonths(1);
        String cmonth = lastMonth.format(DateTimeFormatter.ofPattern("yyyyMM"));

        log.info("[스케줄러] 월간 자동 동기화 시작 - cmonth={}", cmonth);

        try {
            BatchStatus batch = sapRfcSyncService.createBatchJob(cmonth, "replace", "SCHEDULER");
            sapRfcSyncService.executeAsync(batch.getBatchId(), cmonth, "replace", "SCHEDULER");
            log.info("[스케줄러] 배치 작업 등록 완료 - batchId={}", batch.getBatchId());
        } catch (Exception e) {
            log.error("[스케줄러] 월간 동기화 실패: {}", e.getMessage(), e);
        }
    }

    /**
     * 매일 새벽 6시 — 당월 데이터 갱신 (선택적)
     *
     * 당월 데이터가 SAP에서 업데이트될 수 있으므로
     * replace 모드로 매일 동기화
     */
    @Scheduled(cron = "${sap.rfc.schedule.daily-cron:0 0 6 * * *}")
    public void dailySync() {
        if (!scheduleEnabled) {
            return;
        }

        // 매일 동기화는 별도 플래그로 제어
        // 필요 시 sap.rfc.schedule.daily-enabled=true로 설정
        boolean dailyEnabled = false; // 기본 비활성화
        if (!dailyEnabled) {
            return;
        }

        if (sapRfcSyncService.hasRunningBatch()) {
            log.warn("[스케줄러] 이미 실행 중인 배치가 있어 일간 동기화 스킵");
            return;
        }

        String cmonth = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMM"));
        log.info("[스케줄러] 일간 동기화 시작 - cmonth={}", cmonth);

        try {
            BatchStatus batch = sapRfcSyncService.createBatchJob(cmonth, "replace", "DAILY_SCHEDULER");
            sapRfcSyncService.executeAsync(batch.getBatchId(), cmonth, "replace", "DAILY_SCHEDULER");
        } catch (Exception e) {
            log.error("[스케줄러] 일간 동기화 실패: {}", e.getMessage(), e);
        }
    }
}
