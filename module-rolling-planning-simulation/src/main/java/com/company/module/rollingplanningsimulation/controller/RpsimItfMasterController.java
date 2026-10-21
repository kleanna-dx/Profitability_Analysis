package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.RpsimItfMaster;
import com.company.module.rollingplanningsimulation.repository.RpsimItfMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/itf-masters") @RequiredArgsConstructor
public class RpsimItfMasterController {
    private final RpsimItfMasterRepository repo;

    /* 전체 목록 (activeOnly 옵션) */
    @GetMapping
    public ResponseEntity<ApiResponse<List<RpsimItfMaster>>> list(
            @RequestParam(required=false) Boolean activeOnly,
            @RequestParam(required=false) String sender) {
        if (sender != null && !sender.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.success(repo.findBySenderOrderByInterfaceIdAsc(sender)));
        }
        if (Boolean.TRUE.equals(activeOnly)) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByIsActiveTrueOrderByInterfaceIdAsc()));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findAllByOrderByInterfaceIdAsc()));
    }

    /* 단건 조회 */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<RpsimItfMaster>> get(@PathVariable String id) {
        RpsimItfMaster e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        return ResponseEntity.ok(ApiResponse.success(e));
    }

    /* 등록 */
    @PostMapping
    public ResponseEntity<ApiResponse<RpsimItfMaster>> save(@RequestBody Map<String,Object> body) {
        RpsimItfMaster e = RpsimItfMaster.builder()
            .interfaceId((String)body.get("interfaceId"))
            .interfaceName((String)body.get("interfaceName"))
            .sender((String)body.getOrDefault("sender","MANUAL"))
            .receiver((String)body.getOrDefault("receiver","RPSIM"))
            .rfcName((String)body.get("rfcName"))
            .rfcFuncOrUrl((String)body.get("rfcFuncOrUrl"))
            .rfcParam((String)body.get("rfcParam"))
            .targetTable((String)body.get("targetTable"))
            .execMode((String)body.getOrDefault("execMode","REPLACE"))
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .remark((String)body.get("remark"))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 수정 (update 방식) */
    @PutMapping("/{id}")
    @SuppressWarnings("unchecked")
    public ResponseEntity update(@PathVariable String id, @RequestBody Map<String,Object> body) {
        RpsimItfMaster e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.update(
            body.containsKey("interfaceName") ? (String)body.get("interfaceName") : e.getInterfaceName(),
            body.containsKey("sender") ? (String)body.get("sender") : e.getSender(),
            body.containsKey("receiver") ? (String)body.get("receiver") : e.getReceiver(),
            body.containsKey("rfcName") ? (String)body.get("rfcName") : e.getRfcName(),
            body.containsKey("rfcFuncOrUrl") ? (String)body.get("rfcFuncOrUrl") : e.getRfcFuncOrUrl(),
            body.containsKey("rfcParam") ? (String)body.get("rfcParam") : e.getRfcParam(),
            body.containsKey("targetTable") ? (String)body.get("targetTable") : e.getTargetTable(),
            body.containsKey("execMode") ? (String)body.get("execMode") : e.getExecMode(),
            body.containsKey("isActive") ? Boolean.parseBoolean(body.get("isActive").toString()) : e.getIsActive(),
            body.containsKey("remark") ? (String)body.get("remark") : e.getRemark(),
            (String)body.get("updatedBy")
        );
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    /* 삭제 */
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable String id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
