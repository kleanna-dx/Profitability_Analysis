package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PwSimBasisLine;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PwSimBasisLineRepository extends JpaRepository<PwSimBasisLine, Long> {
    List<PwSimBasisLine> findByVersionIdOrderBySortOrderAscLineCodeAsc(Long versionId);
}
