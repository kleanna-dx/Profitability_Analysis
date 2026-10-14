package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BurnerLngRate;
import com.company.module.rollingplanningsimulation.repository.BurnerLngRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/burner-lng-rates") @RequiredArgsConstructor
public class BurnerLngRateController {
    private final BurnerLngRateRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<BurnerLngRate>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BurnerLngRate>> save(@RequestBody BurnerLngRate e) { return ResponseEntity.ok(ApiResponse.success(repo.save(e))); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
