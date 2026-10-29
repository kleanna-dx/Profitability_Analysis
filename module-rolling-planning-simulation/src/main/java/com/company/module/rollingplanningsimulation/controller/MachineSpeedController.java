package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.MachineSpeed;
import com.company.module.rollingplanningsimulation.repository.MachineSpeedRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/machine-speeds") @RequiredArgsConstructor
public class MachineSpeedController {
    private final MachineSpeedRepository repo;
    private final AuditSupport auditSupport;
    @GetMapping
    public ResponseEntity<ApiResponse<List<MachineSpeed>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivisionOrderByMachineCodeAscProductAsc(year, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<MachineSpeed>> save(@RequestBody MachineSpeed e) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.upsert(repo, e, "year", "machineCode", "product", "basisWeight", "division")));
    }
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<MachineSpeed>> update(@PathVariable Long id, @RequestBody MachineSpeed e) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.updateById(repo, id, e, "year", "machineCode", "product", "basisWeight", "division")));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
