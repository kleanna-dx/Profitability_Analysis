package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
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
    private final AuditSupport auditSupport;

    /**
     * 구간단가 조회.
     * - year + month : 해당 월 구간단가만
     * - year 만      : 해당 연도 전체(월별 포함)
     * - 없음          : 사업부 전체
     */
    @GetMapping public ResponseEntity<ApiResponse<List<SteamPriceInterval>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year,
            @RequestParam(required=false) Integer month) {
        if (year != null && month != null && month > 0) {
            String yr = String.valueOf(year);
            // 해당 월 데이터만 (월 0 기본값은 사용하지 않음)
            List<SteamPriceInterval> monthly = repo.findByContractYearAndMonthAndDivisionOrderByIntervalSeqAsc(yr, month, division);
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
        if (e.getBoilerCode() == null || e.getBoilerCode().isBlank()) throw new IllegalArgumentException("보일러를 선택하세요. (구간단가는 구간단가를 쓰는 보일러별로 등록)");
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }
    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null)); }
    private BigDecimal parseBD(Object v){if(v==null)return BigDecimal.ZERO;String s=v.toString().trim();if(s.isEmpty())return BigDecimal.ZERO;try{return new BigDecimal(s);}catch(Exception e){return BigDecimal.ZERO;}}
    private BigDecimal parseBDnull(Object v){if(v==null)return null;String s=v.toString().trim();if(s.isEmpty())return null;try{return new BigDecimal(s);}catch(Exception e){return null;}}
    private int parseI(Object v,int def){if(v==null)return def;try{return (int)Double.parseDouble(v.toString().trim());}catch(Exception e){return def;}}

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"contractYear", "month", "boilerCode", "intervalSeq", "division"};
    private SteamPriceInterval persist(SteamPriceInterval e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
