package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SteamPriceInterval;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface SteamPriceIntervalRepository extends JpaRepository<SteamPriceInterval, Long> {
    List<SteamPriceInterval> findByDivisionOrderByContractYearAscIntervalSeqAsc(String division);
    List<SteamPriceInterval> findByContractYearAndDivision(String contractYear, String division);
    List<SteamPriceInterval> findByContractYearAndDivisionOrderByMonthAscIntervalSeqAsc(String contractYear, String division);
    List<SteamPriceInterval> findByContractYearAndMonthAndDivisionOrderByIntervalSeqAsc(String contractYear, Integer month, String division);
}
