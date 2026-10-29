package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
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
    private final AuditSupport auditSupport;
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
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }
    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null)); }

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"productCode", "division"};
    private ProductMaster persist(ProductMaster e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
