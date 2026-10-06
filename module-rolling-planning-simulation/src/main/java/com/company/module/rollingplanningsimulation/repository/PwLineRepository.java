package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwLine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PwLineRepository extends JpaRepository<PwLine, Long> {

    List<PwLine> findByDivisionAndDeletedYnOrderByDisplayOrder(String division, String deletedYn);

    Optional<PwLine> findByLineCodeAndDeletedYn(String lineCode, String deletedYn);
}
