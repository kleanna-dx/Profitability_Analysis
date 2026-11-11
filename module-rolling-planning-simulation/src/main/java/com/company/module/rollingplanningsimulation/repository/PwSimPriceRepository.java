package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PwSimPrice;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PwSimPriceRepository extends JpaRepository<PwSimPrice, Long> {
    List<PwSimPrice> findByDivisionAndYmStartingWithOrderByYmAsc(String division, String year);
    java.util.Optional<PwSimPrice> findFirstByDivisionAndYm(String division, String ym);
}
