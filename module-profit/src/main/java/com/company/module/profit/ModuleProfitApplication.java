package com.company.module.profit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Module-Profit 독립 실행 메인 클래스
 * SAP RFC 동기화 + 배치 관리 API 서버
 */
@SpringBootApplication(scanBasePackages = {
        "com.company.module.profit",
        "com.company.module.rollingplanningsimulation"   // [경영시뮬레이션]
})
@EntityScan({
        "com.company.module.profit.entity",
        "com.company.module.rollingplanningsimulation.entity"
})
@EnableJpaRepositories({
        "com.company.module.profit.repository",
        "com.company.module.rollingplanningsimulation.repository"
})
public class ModuleProfitApplication {

    public static void main(String[] args) {
        SpringApplication.run(ModuleProfitApplication.class, args);
    }
}
