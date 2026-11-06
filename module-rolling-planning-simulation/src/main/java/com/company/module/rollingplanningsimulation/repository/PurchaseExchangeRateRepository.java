package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchaseExchangeRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;
public interface PurchaseExchangeRateRepository extends JpaRepository<PurchaseExchangeRate, Long> {
    List<PurchaseExchangeRate> findByYmStartingWithOrderByYmAscCurrencyCodeAsc(String yearPrefix);
    List<PurchaseExchangeRate> findByYmIn(Collection<String> yms);
}
