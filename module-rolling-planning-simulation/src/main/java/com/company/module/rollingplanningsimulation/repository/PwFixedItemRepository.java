package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwFixedItem;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface PwFixedItemRepository extends JpaRepository<PwFixedItem, Long> {
    List<PwFixedItem> findByYmAndDivision(String ym, String division);
    Optional<PwFixedItem> findByYmAndDivisionAndItemCode(String ym, String division, String itemCode);
}
