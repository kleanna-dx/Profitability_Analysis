package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SalesCode;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface SalesCodeRepository extends JpaRepository<SalesCode, Long> {
    List<SalesCode> findAllByOrderByCodeTypeAscSortOrderAscCodeNameAsc();
    List<SalesCode> findByCodeTypeOrderBySortOrderAscCodeNameAsc(String codeType);
}
