package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SteamAllocRatio;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SteamAllocRatioRepository extends JpaRepository<SteamAllocRatio, Long> {
    List<SteamAllocRatio> findByYearAndDivision(Integer year,String division);
}
