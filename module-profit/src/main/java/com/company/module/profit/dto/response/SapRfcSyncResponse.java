package com.company.module.profit.dto.response;

import com.company.module.profit.entity.BatchStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

/**
 * SAP RFC 동기화 실행 응답 DTO
 */
@Getter
@Builder
public class SapRfcSyncResponse {

    /** 배치 작업 ID */
    private Long batchId;

    /** 입력년월 */
    private String cmonth;

    /** 실행 모드 */
    private String mode;

    /** 상태 (PENDING → RUNNING → COMPLETED / FAILED) */
    private String status;

    /** 메시지 */
    private String message;

    /** 해당 월 기존 데이터 건수 */
    private Long existingDataCount;

    /** 생성일시 */
    private LocalDateTime createdAt;

    public static SapRfcSyncResponse fromBatch(BatchStatus batch, String cmonth, String mode, Long existingCount) {
        return SapRfcSyncResponse.builder()
                .batchId(batch.getBatchId())
                .cmonth(cmonth)
                .mode(mode)
                .status(batch.getStatus())
                .message("배치 작업이 등록되었습니다. 비동기로 실행 중입니다.")
                .existingDataCount(existingCount)
                .createdAt(batch.getCreatedAt())
                .build();
    }
}
