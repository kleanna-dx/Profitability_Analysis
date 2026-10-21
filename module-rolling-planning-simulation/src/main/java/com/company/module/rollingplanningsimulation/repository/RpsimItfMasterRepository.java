package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.RpsimItfMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RpsimItfMasterRepository extends JpaRepository<RpsimItfMaster, String> {
    List<RpsimItfMaster> findByIsActiveTrueOrderByInterfaceIdAsc();
    List<RpsimItfMaster> findAllByOrderByInterfaceIdAsc();
    List<RpsimItfMaster> findBySenderOrderByInterfaceIdAsc(String sender);
}
