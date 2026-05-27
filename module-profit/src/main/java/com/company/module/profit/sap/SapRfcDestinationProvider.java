package com.company.module.profit.sap;

import com.sap.conn.jco.ext.DestinationDataEventListener;
import com.sap.conn.jco.ext.DestinationDataProvider;
import com.sap.conn.jco.ext.Environment;
import lombok.extern.slf4j.Slf4j;

import java.util.Properties;

/**
 * SAP JCo DestinationDataProvider 구현
 * - JCo는 파일 기반 설정이 기본이지만, Spring 환경에서는
 *   프로그래밍 방식으로 Destination을 제공하는 것이 적절
 * - application.yml 설정을 Properties로 변환하여 JCo에 전달
 */
@Slf4j
public class SapRfcDestinationProvider implements DestinationDataProvider {

    public static final String DESTINATION_NAME = "SAP_BWP";

    private final Properties connectionProperties;

    public SapRfcDestinationProvider(SapRfcProperties config) {
        this.connectionProperties = new Properties();
        connectionProperties.setProperty(DestinationDataProvider.JCO_ASHOST, config.getAshost());
        connectionProperties.setProperty(DestinationDataProvider.JCO_SYSNR, config.getSysnr());
        connectionProperties.setProperty(DestinationDataProvider.JCO_CLIENT, config.getClient());
        connectionProperties.setProperty(DestinationDataProvider.JCO_USER, config.getUser());
        connectionProperties.setProperty(DestinationDataProvider.JCO_PASSWD, config.getPasswd());
        connectionProperties.setProperty(DestinationDataProvider.JCO_LANG, config.getLang());
        connectionProperties.setProperty(DestinationDataProvider.JCO_POOL_CAPACITY,
                String.valueOf(config.getPoolCapacity()));
        connectionProperties.setProperty(DestinationDataProvider.JCO_PEAK_LIMIT,
                String.valueOf(config.getPeakLimit()));

        log.info("[SAP] Destination 설정 완료: {}:{} (SID: {}, Client: {})",
                config.getAshost(), config.getSysnr(), config.getSysid(), config.getClient());
    }

    @Override
    public Properties getDestinationProperties(String destinationName) {
        if (DESTINATION_NAME.equals(destinationName)) {
            return connectionProperties;
        }
        return null;
    }

    @Override
    public void setDestinationDataEventListener(DestinationDataEventListener eventListener) {
        // 변경 이벤트 불필요
    }

    @Override
    public boolean supportsEvents() {
        return false;
    }

    /**
     * JCo Environment에 이 Provider를 등록
     * (한 JVM에 한 번만 등록해야 함)
     */
    public void register() {
        try {
            Environment.registerDestinationDataProvider(this);
            log.info("[SAP] DestinationDataProvider 등록 완료");
        } catch (IllegalStateException e) {
            // 이미 등록되어 있으면 무시
            log.warn("[SAP] DestinationDataProvider 이미 등록됨: {}", e.getMessage());
        }
    }
}
