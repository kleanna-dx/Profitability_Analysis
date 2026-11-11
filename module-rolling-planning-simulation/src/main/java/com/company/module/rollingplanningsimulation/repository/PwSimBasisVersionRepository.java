package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PwSimBasisVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PwSimBasisVersionRepository extends JpaRepository<PwSimBasisVersion, Long> {
    List<PwSimBasisVersion> findByDivisionOrderByVersionIdDesc(String division);
}
