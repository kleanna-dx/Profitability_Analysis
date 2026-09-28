package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.Unit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UnitRepository extends JpaRepository<Unit, Long> {

    List<Unit> findByDivisionAndDeletedYnOrderByUnitCode(String division, String deletedYn);

    Optional<Unit> findByUnitCodeAndDeletedYn(String unitCode, String deletedYn);

    List<Unit> findByDeletedYnOrderByDivisionAscUnitCodeAsc(String deletedYn);
}
