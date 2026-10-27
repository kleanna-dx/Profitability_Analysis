package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamPriceInterval;
import com.company.module.rollingplanningsimulation.repository.SteamPriceIntervalRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-price-intervals") @RequiredArgsConstructor
public class SteamPriceIntervalController {
    private final SteamPriceIntervalRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<SteamPriceInterval>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year,
            @RequestParam(required=false) Integer month) {
        if (year != null) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByContractYearAndDivision(String.valueOf(year), division)));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByContractYearAscIntervalSeqAsc(division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamPriceInterval>> save(@RequestBody Map<String,Object> body) {
        SteamPriceInterval e = SteamPriceInterval.builder().contractYear((String)body.get("contractYear"))
            .boilerCode((String)body.get("boilerCode"))
            .intervalSeq(body.get("intervalSeq")!=null?Integer.parseInt(body.get("intervalSeq").toString()):0)
            .intervalName((String)body.get("intervalName"))
            .minUsageTon(parseBD(body.get("minUsageTon")))
            .maxUsageTon(parseBDnull(body.get("maxUsageTon")))
            .pricePerTon(parseBD(body.get("pricePerTon")))
            .division((String)body.getOrDefault("division","PS")).memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @SuppressWarnings("unchecked") @PutMapping("/{id}") public ResponseEntity update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
    private BigDecimal parseBD(Object v){if(v==null)return BigDecimal.ZERO;String s=v.toString().trim();if(s.isEmpty())return BigDecimal.ZERO;try{return new BigDecimal(s);}catch(Exception e){return BigDecimal.ZERO;}}
    private BigDecimal parseBDnull(Object v){if(v==null)return null;String s=v.toString().trim();if(s.isEmpty())return null;try{return new BigDecimal(s);}catch(Exception e){return null;}}
}
