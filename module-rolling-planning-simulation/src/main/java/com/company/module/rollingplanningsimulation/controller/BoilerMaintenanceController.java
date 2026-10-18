package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerMaintenance;
import com.company.module.rollingplanningsimulation.repository.BoilerMaintenanceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-maintenances") @RequiredArgsConstructor
public class BoilerMaintenanceController {
    private final BoilerMaintenanceRepository repo;

    @GetMapping public ResponseEntity<ApiResponse<List<BoilerMaintenance>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year) {
        List<BoilerMaintenance> list = year != null
            ? repo.findByYearAndDivision(year, division)
            : repo.findByDivision(division);
        return ResponseEntity.ok(ApiResponse.success(list));
    }

    @PostMapping public ResponseEntity<ApiResponse<BoilerMaintenance>> save(@RequestBody Map<String,Object> body) {
        BoilerMaintenance e = BoilerMaintenance.builder()
            .year(body.get("year")!=null?Integer.parseInt(body.get("year").toString()):null)
            .month(body.get("month")!=null?Integer.parseInt(body.get("month").toString()):null)
            .boilerCode((String)body.get("boilerCode"))
            .division((String)body.getOrDefault("division","PS"))
            .maintType((String)body.getOrDefault("maintType","REGULAR"))
            .maintName((String)body.get("maintName"))
            .startDate(body.get("startDate")!=null?LocalDate.parse(body.get("startDate").toString()):null)
            .endDate(body.get("endDate")!=null?LocalDate.parse(body.get("endDate").toString()):null)
            .maintHours(body.get("maintHours")!=null?new BigDecimal(body.get("maintHours").toString()):BigDecimal.ZERO)
            .capacityReduction(body.get("capacityReduction")!=null?new BigDecimal(body.get("capacityReduction").toString()):new BigDecimal("100"))
            .memo((String)body.get("memo"))
            .build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
