package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlMaterialConv;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface HlMaterialConvRepository extends JpaRepository<HlMaterialConv, Long> {
    List<HlMaterialConv> findByDivisionOrderByMaterialCodeAsc(String division);
}
