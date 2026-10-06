package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.Material;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface MaterialRepository extends JpaRepository<Material, Long> {

    Page<Material> findByDeletedYnAndMaterialNameContaining(String deletedYn, String name, Pageable pageable);

    Optional<Material> findByMaterialCodeAndDeletedYn(String materialCode, String deletedYn);

    long countByDeletedYn(String deletedYn);
}
