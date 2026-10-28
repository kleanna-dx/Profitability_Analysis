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

    /**
     * 구간단가 조회.
     * - year + month : 해당 월 구간단가. 해당 월이 없으면 연간 공통(MONTH=0)으로 대체
     * - year 만      : 해당 연도 전체(월별 포함)
     * - 없음          : 사업부 전체
     */
    @GetMapping public ResponseEntity<ApiResponse<List<SteamPriceInterval>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year,
            @RequestParam(required=false) Integer month) {
        if (year != null && month != null && month > 0) {
            String yr = String.valueOf(year);
            List<SteamPriceInterval> monthly = repo.findByContractYearAndMonthAndDivisionOrderByIntervalSeqAsc(yr, month, division);
            if (monthly.isEmpty()) {
                monthly = repo.findByContractYearAndMonthAndDivisionOrderByIntervalSeqAsc(yr, 0, division);
            }
            return ResponseEntity.ok(ApiResponse.success(monthly));
        }
        if (year != null) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByContractYearAndDivisionOrderByMonthAscIntervalSeqAsc(String.valueOf(year), division)));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByContractYearAscIntervalSeqAsc(division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamPriceInterval>> save(@RequestBody Map<String,Object> body) {
        SteamPriceInterval e = SteamPriceInterval.builder()
            .contractYear(body.get("contractYear")!=null?body.get("contractYear").toString().trim():null)
            .month(parseI(body.get("month"),0))
            .boilerCode((String)body.get("boilerCode"))
            .intervalSeq(parseI(body.get("intervalSeq"),0))
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
    private int parseI(Object v,int def){if(v==null)return def;try{return (int)Double.parseDouble(v.toString().trim());}catch(Exception e){return def;}}
}
