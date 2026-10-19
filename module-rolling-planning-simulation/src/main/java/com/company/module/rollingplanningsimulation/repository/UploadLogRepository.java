package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.UploadLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface UploadLogRepository extends JpaRepository<UploadLog, Long> {
    List<UploadLog> findByUploadBatchIdOrderByRowIndexAsc(String uploadBatchId);
    List<UploadLog> findByRefTypeAndStatusOrderByCreatedAtDesc(String refType, String status);
    List<UploadLog> findTop100ByDivisionOrderByCreatedAtDesc(String division);
    List<UploadLog> findByUploadBatchIdAndStatus(String uploadBatchId, String status);
}
