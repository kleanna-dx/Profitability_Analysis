package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.ProductMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ProductMasterRepository extends JpaRepository<ProductMaster, Long> {
    List<ProductMaster> findByDivisionOrderByDisplayOrderAsc(String division);
    List<ProductMaster> findByDivisionAndIsActiveOrderByDisplayOrderAsc(String division, Boolean isActive);
}
