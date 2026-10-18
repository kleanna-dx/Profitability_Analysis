package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.ProductMaster;
import com.company.module.rollingplanningsimulation.repository.ProductMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/product-masters") @RequiredArgsConstructor
public class ProductMasterController {
    private final ProductMasterRepository repo;
    @GetMapping
    public ResponseEntity<ApiResponse<List<ProductMaster>>> list(@RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByDisplayOrderAsc(division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<ProductMaster>> save(@RequestBody Map<String,Object> body) {
        ProductMaster e = ProductMaster.builder()
            .productCode((String)body.get("productCode"))
            .productName((String)body.get("productName"))
            .productGroup((String)body.get("productGroup"))
            .division((String)body.getOrDefault("division","PS"))
            .displayOrder(body.get("displayOrder")!=null?Integer.parseInt(body.get("displayOrder").toString()):0)
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
