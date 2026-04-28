package com.company.module.profit.service;

import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.request.OntologyColumnSaveRequest;
import com.company.module.profit.dto.response.FieldListResponse;
import com.company.module.profit.dto.response.OntologyColumnResponse;
import com.company.module.profit.entity.OntologyColumn;
import com.company.module.profit.entity.OntologySynonym;
import com.company.module.profit.repository.OntologyColumnRepository;
import com.company.module.profit.repository.OntologySynonymRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OntologyService {

    private final OntologyColumnRepository ontologyColumnRepository;
    private final OntologySynonymRepository ontologySynonymRepository;

    /* ───────── 조회 ───────── */

    public Page<OntologyColumnResponse> getList(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<OntologyColumn> result;

        if (keyword != null && !keyword.isBlank()) {
            result = ontologyColumnRepository.searchByKeyword(keyword.trim(), pageable);
        } else {
            result = ontologyColumnRepository.findByIsActiveTrueOrderBySortOrderAsc(pageable);
        }
        return result.map(OntologyColumnResponse::from);
    }

    public OntologyColumnResponse getById(Long id) {
        OntologyColumn entity = findColumnOrThrow(id);
        return OntologyColumnResponse.from(entity);
    }

    public List<String> getDistinctTableNames() {
        return ontologyColumnRepository.findDistinctTableNames();
    }

    public List<String> getDistinctColumnGroups() {
        return ontologyColumnRepository.findDistinctColumnGroups();
    }

    public List<OntologyColumnResponse> getByTableName(String tableName) {
        return ontologyColumnRepository.findByTableNameWithSynonyms(tableName)
                .stream()
                .map(OntologyColumnResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 비주얼 쿼리 빌더용 필드 목록 조회
     * - 컬럼 그룹별로 필드를 분류하여 반환
     */
    public FieldListResponse getFieldList() {
        List<OntologyColumn> columns = ontologyColumnRepository.findAllWithSynonyms();

        // 컬럼 그룹별 분류
        Map<String, List<OntologyColumn>> grouped = columns.stream()
                .collect(Collectors.groupingBy(
                        c -> c.getColumnGroup() != null ? c.getColumnGroup() : "기타"
                ));

        List<FieldListResponse.FieldGroup> fieldGroups = grouped.entrySet().stream()
                .map(entry -> FieldListResponse.FieldGroup.builder()
                        .groupName(entry.getKey())
                        .fieldCount(entry.getValue().size())
                        .fields(entry.getValue().stream()
                                .map(col -> FieldListResponse.FieldItem.builder()
                                        .ontologyColumnId(col.getOntologyColumnId())
                                        .columnName(col.getColumnName())
                                        .displayName(col.getColumnDescription() != null
                                                ? col.getColumnDescription()
                                                : col.getColumnName())
                                        .tableName(col.getTableName())
                                        .dataType(col.getDataType())
                                        .columnGroup(col.getColumnGroup())
                                        .build())
                                .collect(Collectors.toList()))
                        .build())
                .collect(Collectors.toList());

        return FieldListResponse.builder()
                .fieldGroups(fieldGroups)
                .metricFields(List.of()) // MetricService에서 별도 조합
                .build();
    }

    /* ───────── 생성 ───────── */

    @Transactional
    public OntologyColumnResponse save(OntologyColumnSaveRequest request, String currentUser) {
        OntologyColumn column = OntologyColumn.builder()
                .columnName(request.getColumnName())
                .tableName(request.getTableName())
                .columnDescription(request.getColumnDescription())
                .dataType(request.getDataType())
                .columnGroup(request.getColumnGroup())
                .sortOrder(request.getSortOrder())
                .isActive(request.getIsActive())
                .createdBy(currentUser)
                .build();

        // 동의어 추가
        if (request.getSynonyms() != null) {
            for (OntologyColumnSaveRequest.SynonymRequest synReq : request.getSynonyms()) {
                OntologySynonym synonym = OntologySynonym.builder()
                        .synonymText(synReq.getSynonymText())
                        .synonymSource(synReq.getSynonymSource())
                        .isActive(synReq.getIsActive())
                        .build();
                column.addSynonym(synonym);
            }
        }

        OntologyColumn saved = ontologyColumnRepository.save(column);
        return OntologyColumnResponse.from(saved);
    }

    /* ───────── 수정 ───────── */

    @Transactional
    public OntologyColumnResponse update(Long id, OntologyColumnSaveRequest request, String currentUser) {
        OntologyColumn column = findColumnOrThrow(id);

        column.update(
                request.getColumnName(),
                request.getTableName(),
                request.getColumnDescription(),
                request.getDataType(),
                request.getColumnGroup(),
                request.getSortOrder(),
                request.getIsActive(),
                currentUser
        );

        // 기존 동의어 제거 후 새로 추가
        column.getSynonyms().clear();
        if (request.getSynonyms() != null) {
            for (OntologyColumnSaveRequest.SynonymRequest synReq : request.getSynonyms()) {
                OntologySynonym synonym = OntologySynonym.builder()
                        .synonymText(synReq.getSynonymText())
                        .synonymSource(synReq.getSynonymSource())
                        .isActive(synReq.getIsActive())
                        .build();
                column.addSynonym(synonym);
            }
        }

        return OntologyColumnResponse.from(column);
    }

    /* ───────── 삭제 ───────── */

    @Transactional
    public void delete(Long id) {
        OntologyColumn column = findColumnOrThrow(id);
        ontologyColumnRepository.delete(column);
    }

    /* ───────── 동의어 개별 추가 ───────── */

    @Transactional
    public OntologyColumnResponse addSynonym(Long columnId, String synonymText, String source) {
        OntologyColumn column = findColumnOrThrow(columnId);
        OntologySynonym synonym = OntologySynonym.builder()
                .synonymText(synonymText)
                .synonymSource(source)
                .isActive(true)
                .build();
        column.addSynonym(synonym);
        return OntologyColumnResponse.from(column);
    }

    @Transactional
    public void removeSynonym(Long synonymId) {
        OntologySynonym synonym = ontologySynonymRepository.findById(synonymId)
                .orElseThrow(() -> new EntityNotFoundException("동의어를 찾을 수 없습니다. ID: " + synonymId));
        ontologySynonymRepository.delete(synonym);
    }

    /* ───────── 내부 헬퍼 ───────── */

    private OntologyColumn findColumnOrThrow(Long id) {
        return ontologyColumnRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Ontology 컬럼을 찾을 수 없습니다. ID: " + id));
    }
}
