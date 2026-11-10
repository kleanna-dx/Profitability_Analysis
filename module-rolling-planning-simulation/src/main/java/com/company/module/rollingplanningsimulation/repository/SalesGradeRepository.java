package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SalesGrade;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface SalesGradeRepository extends JpaRepository<SalesGrade, Long> {
    List<SalesGrade> findByDivisionOrderBySortOrderAscGradeNameAsc(String division);
    boolean existsByProductType(String productType);
}
