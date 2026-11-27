package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlMaterialMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface HlMaterialMasterRepository extends JpaRepository<HlMaterialMaster, Long> {
    List<HlMaterialMaster> findByDivisionOrderByMaterialCodeAsc(String division);
}
