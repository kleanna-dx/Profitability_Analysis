package com.company.module.rollingplanningsimulation.controller;
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
    @GetMapping
    public ResponseEntity<ApiResponse<List<MachineSpeed>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivisionOrderByMachineCodeAscProductAsc(year, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<MachineSpeed>> save(@RequestBody MachineSpeed e) {
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
