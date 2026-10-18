package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import com.company.module.rollingplanningsimulation.repository.BoilerMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-masters") @RequiredArgsConstructor
public class BoilerMasterController {
    private final BoilerMasterRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<BoilerMaster>>> list(@RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivision(division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BoilerMaster>> save(@RequestBody Map<String,Object> body) {
        BoilerMaster e = BoilerMaster.builder()
            .boilerCode((String)body.get("boilerCode"))
            .boilerName((String)body.get("boilerName"))
            .boilerType((String)body.getOrDefault("boilerType","COGEN"))
            .steamPerHour(body.get("steamPerHour")!=null?new BigDecimal(body.get("steamPerHour").toString()):BigDecimal.ZERO)
            .priority(body.get("priority")!=null?Integer.parseInt(body.get("priority").toString()):99)
            .capacityNote((String)body.get("capacityNote"))
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .division((String)body.getOrDefault("division","PS"))
            .displayOrder(body.get("displayOrder")!=null?Integer.parseInt(body.get("displayOrder").toString()):0)
            .build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
