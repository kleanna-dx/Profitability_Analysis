package com.company.module.profit.sap;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * SAP RFC 연결 설정
 * application.yml의 sap.rfc 하위 프로퍼티를 바인딩
 *
 * 예시:
 * sap:
 *   rfc:
 *     ashost: 10.2.14.220
 *     sysnr: "01"
 *     sysid: BWP
 *     client: "100"
 *     user: BWSYSTEM
 *     passwd: kleannara123@
 *     lang: KO
 *     pool-capacity: 3
 *     peak-limit: 5
 */
@Component
@ConfigurationProperties(prefix = "sap.rfc")
@Getter
@Setter
public class SapRfcProperties {

    /** SAP 어플리케이션 서버 IP */
    private String ashost = "10.2.14.220";

    /** 인스턴스 번호 */
    private String sysnr = "01";

    /** 시스템 ID */
    private String sysid = "BWP";

    /** 클라이언트(만트) 번호 */
    private String client = "100";

    /** SAP 로그인 사용자 */
    private String user = "BWSYSTEM";

    /** SAP 로그인 비밀번호 */
    private String passwd = "kleannara123@";

    /** 언어 */
    private String lang = "KO";

    /** RFC 함수명 */
    private String rfcFunction = "Z_BI_WEB_EX_BL";

    /** 커넥션 풀 용량 */
    private int poolCapacity = 3;

    /** 최대 동시 접속 */
    private int peakLimit = 5;
}
