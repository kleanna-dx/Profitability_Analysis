package com.company.module.profit.sap;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * SAP RFC 연결 + 비동기/스케줄링 설정
 */
@Configuration
@EnableScheduling
@EnableAsync
@Slf4j
public class SapRfcConfig {

    /**
     * SAP JCo DestinationDataProvider 빈
     * - JCo 라이브러리가 classpath에 있을 때만 활성화
     */
    @Bean
    @ConditionalOnClass(name = "com.sap.conn.jco.JCoDestinationManager")
    public SapRfcDestinationProvider sapRfcDestinationProvider(SapRfcProperties properties) {
        SapRfcDestinationProvider provider = new SapRfcDestinationProvider(properties);
        provider.register();
        return provider;
    }

    /**
     * 배치 작업 전용 스레드 풀
     * - SAP RFC 호출은 시간이 오래 걸릴 수 있으므로 별도 스레드에서 실행
     */
    @Bean(name = "batchTaskExecutor")
    public Executor batchTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);
        executor.setQueueCapacity(10);
        executor.setThreadNamePrefix("batch-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(300); // 최대 5분 대기
        executor.initialize();
        log.info("[SAP] 배치 전용 스레드 풀 초기화: core=2, max=5");
        return executor;
    }
}
