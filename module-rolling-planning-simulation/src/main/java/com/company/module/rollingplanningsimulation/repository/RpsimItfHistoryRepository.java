package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RpsimItfHistoryRepository extends JpaRepository<RpsimItfHistory, Long> {
    List<RpsimItfHistory> findByInterfaceIdOrderByCreatedAtDesc(String interfaceId);
    List<RpsimItfHistory> findTop100ByOrderByCreatedAtDesc();
    List<RpsimItfHistory> findByStatusOrderByCreatedAtDesc(String status);
}
