package com.company.module.profit.dto.request;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/**
 * SAP RFC 동기화 실행 요청 DTO
 *
 * <p>[PR #332] Node.js 로부터 인터페이스 라우팅 정보(interfaceId / rfcName / targetTable)
 * 를 함께 전달받아, 두 인터페이스(수익성분석 / 제조원가) 를 하나의 Spring Boot 실행
 * 경로에서 처리할 수 있도록 확장한다.</p>
 *
 * <p>세 필드가 모두 null 또는 빈 값이면 기존 동작(수익성분석 = Z_BI_WEB_EX_BL /
 * bw_profitability_data) 을 유지하므로 스케줄러 / 기존 클라이언트와 완전 후위호환.</p>
 *
 * <p>[PR #334] Node.js 는 batch_master 스키마와 관례를 맞춰 snake_case
 * (interface_id / rfc_name / target_table) 로 전송한다. Jackson 기본 매핑은
 * 명명 규칙 자동 변환을 하지 않으므로, {@link JsonProperty} 로 wire name 을
 * 명시하고 {@link JsonAlias} 로 camelCase 도 계속 수신 가능하게 한다
 * (기존 클라이언트 / 테스트 하위호환).</p>
 */
@Getter
@Setter
public class SapRfcSyncRequest {

    /** 입력년월 (YYYYMM, 예: 202604) */
    @NotBlank(message = "입력년월(cmonth)은 필수입니다")
    @Pattern(regexp = "^\\d{6}$", message = "입력년월은 YYYYMM 형식이어야 합니다 (예: 202604)")
    private String cmonth;

    /** 실행 모드: replace(기존 삭제 후 INSERT), append(추가), dry-run(테스트) */
    @Pattern(regexp = "^(replace|append|dry-run)$",
             message = "mode는 replace, append, dry-run 중 하나여야 합니다")
    private String mode = "replace";

    /**
     * Node.js batch_jobs 레코드 ID (선택)
     * - Node.js가 이미 batch_jobs에 INSERT한 경우 해당 ID 전달
     * - 전달 시 Spring Boot가 새 레코드를 만들지 않고 기존 레코드를 업데이트
     */
    private Long jobId;

    // ─────────────────────────────────────────────────────────────
    // [PR #332] 인터페이스 라우팅 정보 (Node.js batch_master 조회 결과)
    // ─────────────────────────────────────────────────────────────

    /**
     * 인터페이스 ID (예: NLP_RFC_001, NLP_RFC_002)
     *
     * <p>Node.js 가 batch_master 를 조회해 결정한 값을 전달. 로깅 · 감사용이며,
     * 실제 분기 판정은 {@link #rfcName} · {@link #targetTable} 값을 사용한다.
     * 미전달 시 서비스 계층에서 수익성분석 기본값으로 처리.</p>
     */
    @Pattern(regexp = "^$|^[A-Z0-9_]+$",
             message = "interfaceId 는 영문 대문자/숫자/언더스코어만 사용 가능")
    @JsonProperty("interface_id")
    @JsonAlias({"interfaceId"})
    private String interfaceId;

    /**
     * SAP RFC 함수명 (예: Z_BI_WEB_EX_BL, Z_BI_WEB_EX_BL_4)
     *
     * <p>미전달(null/blank) 시 application.yml 의 <code>sap.rfc.rfc-function</code>
     * 값(=수익성분석 RFC) 을 폴백으로 사용한다. 스케줄러 / 기존 호출자를
     * 그대로 두고도 후위호환을 보장하기 위한 설계.</p>
     */
    @Pattern(regexp = "^$|^[A-Z0-9_/]+$",
             message = "rfcName 은 영문 대문자/숫자/언더스코어/슬래시만 사용 가능")
    @JsonProperty("rfc_name")
    @JsonAlias({"rfcName"})
    private String rfcName;

    /**
     * 적재 대상 DB 테이블 (예: bw_profitability_data, sys_aimd_cot015)
     *
     * <p>미전달(null/blank) 시 수익성분석 테이블(bw_profitability_data) 로 처리.
     * 서비스 계층에서 화이트리스트 검증 후 대응 매핑을 선택하며, 알 수 없는
     * 값이면 IllegalArgumentException 으로 즉시 실패한다 (오적재 원천 차단).</p>
     */
    @Pattern(regexp = "^$|^[a-zA-Z0-9_]+$",
             message = "targetTable 은 영숫자/언더스코어만 사용 가능")
    @JsonProperty("target_table")
    @JsonAlias({"targetTable"})
    private String targetTable;
}
