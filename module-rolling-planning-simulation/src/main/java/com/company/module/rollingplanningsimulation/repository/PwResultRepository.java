package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwResult;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PwResultRepository extends JpaRepository<PwResult, Long> {

    long countByYmAndDivision(String ym, String division);
}
