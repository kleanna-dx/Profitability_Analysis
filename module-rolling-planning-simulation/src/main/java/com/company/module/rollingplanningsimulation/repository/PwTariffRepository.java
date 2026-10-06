package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwTariff;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PwTariffRepository extends JpaRepository<PwTariff, Long> {

    List<PwTariff> findByYearAndDivisionOrderBySeasonAscTimeZoneAsc(Integer year, String division);

    Optional<PwTariff> findByYearAndSeasonAndTimeZoneAndDivision(Integer year, String season, String timeZone, String division);
}
