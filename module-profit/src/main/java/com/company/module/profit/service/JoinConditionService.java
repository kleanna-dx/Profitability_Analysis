package com.company.module.profit.service;

import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.request.JoinConditionSaveRequest;
import com.company.module.profit.dto.response.JoinConditionResponse;
import com.company.module.profit.entity.JoinCondition;
import com.company.module.profit.repository.JoinConditionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JoinConditionService {

    private final JoinConditionRepository joinConditionRepository;

    /**
     * JOIN 조건 목록 조회 (페이징 + 검색)
     */
    public Page<JoinConditionResponse> getList(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<JoinCondition> result;

        if (keyword != null && !keyword.isBlank()) {
            result = joinConditionRepository.searchByKeyword(keyword.trim(), pageable);
        } else {
            result = joinConditionRepository.findByIsActiveTrueOrderBySortOrderAsc(pageable);
        }

        return result.map(JoinConditionResponse::from);
    }

    /**
     * JOIN 조건 단건 조회
     */
    public JoinConditionResponse getById(Long id) {
        JoinCondition entity = joinConditionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("JOIN 조건을 찾을 수 없습니다. ID: " + id));
        return JoinConditionResponse.from(entity);
    }

    /**
     * JOIN 조건 저장 (생성)
     */
    @Transactional
    public JoinConditionResponse save(JoinConditionSaveRequest request, String createdBy) {
        JoinCondition joinCondition = JoinCondition.builder()
                .joinName(request.getJoinName())
                .leftColumn(request.getLeftColumn())
                .leftTable(request.getLeftTable())
                .rightColumn(request.getRightColumn())
                .rightTable(request.getRightTable())
                .joinType(request.getJoinType())
                .operator(request.getOperator())
                .sortOrder(request.getSortOrder())
                .isActive(request.getIsActive())
                .createdBy(createdBy)
                .build();

        JoinCondition saved = joinConditionRepository.save(joinCondition);
        return JoinConditionResponse.from(saved);
    }

    /**
     * JOIN 조건 수정
     */
    @Transactional
    public JoinConditionResponse update(Long id, JoinConditionSaveRequest request, String updatedBy) {
        JoinCondition joinCondition = joinConditionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("JOIN 조건을 찾을 수 없습니다. ID: " + id));

        joinCondition.update(
                request.getJoinName(),
                request.getLeftColumn(),
                request.getLeftTable(),
                request.getRightColumn(),
                request.getRightTable(),
                request.getJoinType(),
                request.getOperator(),
                request.getSortOrder(),
                request.getIsActive(),
                updatedBy
        );

        return JoinConditionResponse.from(joinCondition);
    }

    /**
     * JOIN 조건 삭제 (soft delete)
     */
    @Transactional
    public void delete(Long id, String updatedBy) {
        JoinCondition jc = joinConditionRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("JOIN 조건을 찾을 수 없습니다. ID: " + id));
        jc.update(
                jc.getJoinName(), jc.getLeftColumn(), jc.getLeftTable(),
                jc.getRightColumn(), jc.getRightTable(), jc.getJoinType(),
                jc.getOperator(), jc.getSortOrder(), false, updatedBy
        );
    }

    /**
     * 특정 테이블이 포함된 JOIN 조건 조회 (SQL 생성 시 사용)
     */
    public List<JoinConditionResponse> getByTableInvolved(String tableName) {
        return joinConditionRepository.findByTableInvolved(tableName).stream()
                .map(JoinConditionResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 두 테이블 간 JOIN 조건 조회
     */
    public List<JoinConditionResponse> getByTablePair(String table1, String table2) {
        return joinConditionRepository.findByTablePair(table1, table2).stream()
                .map(JoinConditionResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 전체 활성 JOIN 조건 조회 (RAG 인덱스 구축용)
     */
    public List<JoinConditionResponse> getAllActive() {
        return joinConditionRepository.findByIsActiveTrueOrderBySortOrderAsc().stream()
                .map(JoinConditionResponse::from)
                .collect(Collectors.toList());
    }
}
