package com.company.module.rollingplanningsimulation.service;

import com.company.module.profit.sap.SapRfcSyncService;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.entity.RpsimItfMaster;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import com.company.module.rollingplanningsimulation.repository.RpsimItfMasterRepository;
import com.company.module.rollingplanningsimulation.repository.RpsimItfScheduleRepository;
import com.company.module.rollingplanningsimulation.entity.RpsimItfSchedule;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 인터페이스 동적 실행 서비스.
 *
 * <p>마스터의 rfc_func_or_url 값을 읽어서 적절한 서비스로 라우팅합니다.</p>
 * <ul>
 *   <li>SAP RFC → SapRfcSyncService.execute() (수익성분석 검증 로직 재사용)</li>
 *   <li>에너지팀 DB → EnergyDataSyncService</li>
 *   <li>NULL/빈값 → 수기 입력 (실행 불가, 안내 메시지)</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ItfExecutionService {

    private final RpsimItfMasterRepository masterRepo;
    private final RpsimItfScheduleRepository schedRepo;
    private final RpsimItfHistoryRepository histRepo;
    private final SapRfcSyncService sapRfcSyncService;
    private final EnergyDataSyncService energySyncService;

    /**
     * 인터페이스 실행 (마스터 정보 기반 동적 라우팅)
     *
     * @param interfaceId 인터페이스 ID
     * @param cmonth      대상년월 YYYYMM
     * @param mode        실행모드 (replace/append/dry-run)
     * @param executedBy  실행자
     * @return 실행 결과
     */
    public Map<String, Object> execute(String interfaceId, String cmonth, String mode, String executedBy) {
        // 1) 마스터 조회
        RpsimItfMaster master = masterRepo.findById(interfaceId)
                .orElseThrow(() -> new RuntimeException("인터페이스를 찾을 수 없습니다: " + interfaceId));

        String rfcFuncOrUrl = master.getRfcFuncOrUrl();
        String rfcName = master.getRfcName();
        String targetTable = master.getTargetTable();
        String rfcParam = master.getRfcParam();

        log.info("[ItfExec] 실행 시작 — id={}, rfc={}, url={}, table={}, cmonth={}, mode={}",
                interfaceId, rfcName, rfcFuncOrUrl, targetTable, cmonth, mode);

        // 2) 이력 생성
        RpsimItfHistory hist = RpsimItfHistory.builder()
                .interfaceId(interfaceId)
                .interfaceName(master.getInterfaceName())
                .jobType(determineJobType(rfcFuncOrUrl))
                .rfcName(rfcName)
                .targetTable(targetTable)
                .cmonth(cmonth)
                .execMode(mode != null ? mode : "replace")
                .status("running")
                .startedAt(LocalDateTime.now())
                .executedBy(executedBy)
                .build();
        hist = histRepo.save(hist);
        hist.appendLog("실행 시작 — interface=" + interfaceId + ", rfc=" + rfcName + ", table=" + targetTable);
        hist.appendLog("cmonth=" + cmonth + ", mode=" + mode + ", user=" + executedBy);

        try {
            Map<String, Object> result;

            // 3) rfcFuncOrUrl 기반 동적 라우팅
            if (rfcFuncOrUrl != null && rfcFuncOrUrl.contains("/sap-rfc/")) {
                // SAP RFC 실행
                result = executeSapRfc(hist, rfcName, targetTable, cmonth, mode);
            } else if (rfcFuncOrUrl != null && rfcFuncOrUrl.contains("/energy-sync/")) {
                // 에너지팀 DB 수신
                result = executeEnergySync(hist, rfcFuncOrUrl, cmonth, mode);
            } else {
                // 수기 입력 또는 미설정
                hist.appendLog("자동 실행 대상이 아닙니다 (수기입력/엑셀업로드 인터페이스)");
                result = Map.of("message", "수기 입력 인터페이스입니다. 기준정보 관리에서 직접 등록하세요.");
                completeHistory(hist, "success", 0, 0, null);
            }

            result = new LinkedHashMap<>(result);
            result.put("historyId", hist.getHistoryId());
            result.put("interfaceId", interfaceId);

            // 4) 관련 스케줄 상태 갱신
            updateScheduleStatus(interfaceId, hist.getStatus());

            return result;

        } catch (Exception e) {
            String detail = e.getMessage();
            if (e.getCause() != null) detail += " | Cause: " + e.getCause().getMessage();
            hist.appendLog("실행 실패: " + detail);
            completeHistory(hist, "failed", 0, 0, detail);
            updateScheduleStatus(interfaceId, "failed");

            Map<String, Object> errResult = new LinkedHashMap<>();
            errResult.put("error", detail);
            errResult.put("historyId", hist.getHistoryId());
            errResult.put("interfaceId", interfaceId);
            return errResult;
        }
    }

    // ================================================================
    // SAP RFC 실행 (수익성분석 서비스 재사용)
    // ================================================================

    private Map<String, Object> executeSapRfc(RpsimItfHistory hist, String rfcName, String targetTable,
                                              String cmonth, String mode) {
        hist.appendLog("[SAP RFC] rfcName=" + rfcName + ", targetTable=" + targetTable);

        // batch_jobs 레코드 생성 (수익성분석과 동일 이력)
        var batch = sapRfcSyncService.createBatchJob(cmonth, mode, hist.getExecutedBy());
        hist.appendLog("[SAP RFC] batch_jobs id=" + batch.getId());

        // 동기 실행
        SapRfcSyncService.TableMapping mapping = SapRfcSyncService.resolveMapping(targetTable);
        sapRfcSyncService.execute(batch.getId(), cmonth, mode, rfcName, mapping);

        // 결과 확인
        long insertedCount = sapRfcSyncService.countExistingData(cmonth, targetTable);
        hist.appendLog("[SAP RFC] 완료 — insertedCount=" + insertedCount + ", batchId=" + batch.getId());

        completeHistory(hist, "success", (int) insertedCount, 0, null);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rfcName", rfcName);
        result.put("targetTable", targetTable);
        result.put("cmonth", cmonth);
        result.put("mode", mode);
        result.put("insertedRows", insertedCount);
        result.put("batchId", batch.getId());
        return result;
    }

    // ================================================================
    // 에너지팀 DB 수신
    // ================================================================

    private Map<String, Object> executeEnergySync(RpsimItfHistory hist, String rfcFuncOrUrl,
                                                   String cmonth, String mode) {
        int year = Integer.parseInt(cmonth.substring(0, 4));
        String division = "PS";

        hist.appendLog("[에너지팀] url=" + rfcFuncOrUrl + ", year=" + year);

        Map<String, Object> result = new LinkedHashMap<>();

        if (rfcFuncOrUrl.contains("/energy-sync/prices") || rfcFuncOrUrl.contains("/energy-sync/all")) {
            int priceCount = energySyncService.syncPriceData(year, division);
            hist.appendLog("[에너지팀] 단가 수신 완료: " + priceCount + "건");
            result.put("priceCount", priceCount);

            if (rfcFuncOrUrl.contains("/energy-sync/all")) {
                int unitCount = energySyncService.syncUnitRateData(year, division);
                hist.appendLog("[에너지팀] 원단위 수신 완료: " + unitCount + "건");
                result.put("unitRateCount", unitCount);
                int total = priceCount + unitCount;
                result.put("totalCount", total);
                completeHistory(hist, "success", total, 0, null);
            } else {
                completeHistory(hist, "success", priceCount, 0, null);
            }
        } else if (rfcFuncOrUrl.contains("/energy-sync/unit-rates")) {
            int count = energySyncService.syncUnitRateData(year, division);
            hist.appendLog("[에너지팀] 원단위 수신 완료: " + count + "건");
            result.put("unitRateCount", count);
            completeHistory(hist, "success", count, 0, null);
        } else {
            hist.appendLog("[에너지팀] 알 수 없는 URL: " + rfcFuncOrUrl);
            completeHistory(hist, "failed", 0, 0, "알 수 없는 에너지 동기화 URL: " + rfcFuncOrUrl);
            result.put("error", "알 수 없는 URL");
        }

        return result;
    }

    // ================================================================
    // 헬퍼
    // ================================================================

    private String determineJobType(String rfcFuncOrUrl) {
        if (rfcFuncOrUrl == null) return "MANUAL";
        if (rfcFuncOrUrl.contains("/sap-rfc/")) return "SAP_RFC_SYNC";
        if (rfcFuncOrUrl.contains("/energy-sync/")) return "ENERGY_DB_SYNC";
        return "MANUAL";
    }

    private void completeHistory(RpsimItfHistory hist, String status, int insertedRows, int deletedRows, String errorMessage) {
        LocalDateTime now = LocalDateTime.now();
        int durationMs = hist.getStartedAt() != null
                ? (int) Duration.between(hist.getStartedAt(), now).toMillis() : 0;
        hist.completeDetail(status, now, durationMs, insertedRows, deletedRows, errorMessage,
                status.equals("success") ? "실행 완료" : "실행 실패");
        histRepo.save(hist);
    }

    private void updateScheduleStatus(String interfaceId, String status) {
        List<RpsimItfSchedule> schedules = schedRepo.findByInterfaceIdOrderByScheduleIdAsc(interfaceId);
        for (RpsimItfSchedule s : schedules) {
            s.updateRunStatus(status, LocalDateTime.now(), null);
            schedRepo.save(s);
        }
    }
}
