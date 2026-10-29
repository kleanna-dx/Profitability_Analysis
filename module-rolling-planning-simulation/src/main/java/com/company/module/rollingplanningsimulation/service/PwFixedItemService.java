package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.dto.request.PwFixedItemSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwFixedItemResponse;
import com.company.module.rollingplanningsimulation.entity.PwFixedItem;
import com.company.module.rollingplanningsimulation.repository.PwFixedItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwFixedItemService {
    private final PwFixedItemRepository repository;
    private final AuditSupport auditSupport;
    public List<PwFixedItemResponse> getList(String ym, String division) {
        return repository.findByYmAndDivision(ym, division).stream().map(PwFixedItemResponse::from).toList();
    }
    @Transactional
    public PwFixedItemResponse save(PwFixedItemSaveRequest req) {
        PwFixedItem e = PwFixedItem.builder().ym(req.getYm()).division(req.getDivision()).itemCode(req.getItemCode()).build();
        e.update(req.getItemName(), req.getAmountKrw(), req.getCalcFormula(), req.getMemo());
        return PwFixedItemResponse.from(auditSupport.upsert(repository, e, "ym", "division", "itemCode"));
    }
    @Transactional
    public void delete(Long id) { auditSupport.softDelete(repository, id); }
}
