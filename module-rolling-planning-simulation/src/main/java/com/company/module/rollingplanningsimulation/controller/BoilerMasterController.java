package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import com.company.module.rollingplanningsimulation.repository.BoilerMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-masters") @RequiredArgsConstructor
public class BoilerMasterController {
    private final BoilerMasterRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<BoilerMaster>>> list(@RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivision(division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BoilerMaster>> save(@RequestBody BoilerMaster e) { return ResponseEntity.ok(ApiResponse.success(repo.save(e))); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
