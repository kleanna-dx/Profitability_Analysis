package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.CogenDeduction;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface CogenDeductionRepository extends JpaRepository<CogenDeduction, Long> {
    List<CogenDeduction> findByYearAndDivision(Integer year,String division);
}
