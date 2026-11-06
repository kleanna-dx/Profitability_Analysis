package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchaseCurrency;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PurchaseCurrencyRepository extends JpaRepository<PurchaseCurrency, Long> {
    List<PurchaseCurrency> findAllByOrderBySortOrderAscCurrencyCodeAsc();
}
