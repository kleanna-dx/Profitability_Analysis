package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface HlCustomerExpenseRepository extends JpaRepository<HlCustomerExpense, Long> {
    List<HlCustomerExpense> findByYmOrderByCustomerCodeAsc(String ym);
}
