package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.LineSteamRatio;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface LineSteamRatioRepository extends JpaRepository<LineSteamRatio, Long> {
    List<LineSteamRatio> findByYearAndDivision(Integer year, String division);
    Optional<LineSteamRatio> findByYearAndDivisionAndMachineCode(Integer year, String division, String machineCode);
}
