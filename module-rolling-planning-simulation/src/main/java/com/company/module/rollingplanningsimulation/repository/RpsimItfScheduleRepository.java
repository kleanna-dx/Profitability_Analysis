package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.RpsimItfSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RpsimItfScheduleRepository extends JpaRepository<RpsimItfSchedule, Long> {
    List<RpsimItfSchedule> findByInterfaceIdOrderByScheduleIdAsc(String interfaceId);
    List<RpsimItfSchedule> findByIsActiveTrueOrderByInterfaceIdAsc();
    List<RpsimItfSchedule> findAllByOrderByInterfaceIdAscScheduleIdAsc();
}
