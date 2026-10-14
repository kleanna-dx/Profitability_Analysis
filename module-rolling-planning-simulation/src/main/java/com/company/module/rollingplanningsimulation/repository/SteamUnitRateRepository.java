package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SteamUnitRateRepository extends JpaRepository<SteamUnitRate, Long> {
    List<SteamUnitRate> findByYearAndDivision(Integer year,String division);
}
