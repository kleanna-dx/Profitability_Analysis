package com.company.module.rollingplanningsimulation.support;

import com.company.module.rollingplanningsimulation.entity.BaseAuditEntity;
import jakarta.persistence.Column;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 공통 저장/삭제 규칙
 * <ul>
 *   <li>등록(upsert): UK 가 같은 행이 있으면 덮어쓴다(삭제된 행이면 되살린 뒤 덮어씀). 없으면 신규 등록.
 *       → 처음 생성자/생성일자는 유지, 수정자/수정일자 기록</li>
 *   <li>수정(updateById): 지정 행만 수정. 바꾼 키가 다른 살아있는 행과 겹치면 오류(남의 데이터 덮어쓰기 방지)</li>
 *   <li>삭제(softDelete): 행은 남기고 DELETED_YN='Y' + 삭제자/삭제일자 기록</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class AuditSupport {

    private final JdbcTemplate jdbcTemplate;

    @PersistenceContext
    private EntityManager em;

    private static final Map<Class<?>, Meta> META = new ConcurrentHashMap<>();

    /** UK 기준 등록/덮어쓰기. ukFields 가 없으면 항상 신규 등록 */
    @Transactional
    public <T extends BaseAuditEntity, ID> T upsert(JpaRepository<T, ID> repo, T incoming, String... ukFields) {
        if (ukFields == null || ukFields.length == 0) { incoming.restoreDeleted(); return repo.save(incoming); }
        Meta m = meta(incoming.getClass());
        Object existingId = findIdByUk(m, incoming, ukFields, null);
        if (existingId == null) { incoming.restoreDeleted(); return repo.save(incoming); }

        // 삭제된 행이면 되살림
        jdbcTemplate.update("UPDATE " + m.table + " SET DELETED_YN='N', DELETED_BY=NULL, DELETED_AT=NULL WHERE "
                + m.idCol + " = ? AND DELETED_YN = 'Y'", existingId);
        @SuppressWarnings("unchecked")
        T existing = repo.findById((ID) castId(m, existingId))
                .orElseThrow(() -> new IllegalStateException("덮어쓸 데이터를 찾지 못했습니다: " + existingId));
        existing.restoreDeleted();
        copyFields(m, incoming, existing);
        existing.markUpserted();
        return repo.save(existing);
    }

    /** 지정 행 수정. 바꾼 키가 다른 살아있는 행과 겹치면 오류 */
    @Transactional
    public <T extends BaseAuditEntity, ID> T updateById(JpaRepository<T, ID> repo, ID id, T incoming, String... ukFields) {
        T existing = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        Meta m = meta(incoming.getClass());
        if (ukFields != null && ukFields.length > 0) {
            Object otherId = findIdByUk(m, incoming, ukFields, id);
            if (otherId != null) {
                String deletedYn = jdbcTemplate.queryForObject(
                        "SELECT DELETED_YN FROM " + m.table + " WHERE " + m.idCol + " = ?", String.class, otherId);
                if (!"Y".equals(deletedYn)) {
                    throw new IllegalStateException("같은 기준(" + String.join(", ", ukFields)
                            + ")의 데이터가 이미 있습니다. 그 행을 수정하거나 먼저 삭제하세요.");
                }
                // 이미 삭제된 행이 키를 잡고 있으면 정리
                jdbcTemplate.update("DELETE FROM " + m.table + " WHERE " + m.idCol + " = ?", otherId);
            }
        }
        copyFields(m, incoming, existing);
        return repo.save(existing);
    }

    /**
     * 이미 불러온 행을 직접 고친 뒤(부분 수정) 저장하기 전에 호출.
     * 바뀐 키가 다른 살아있는 행과 겹치면 오류, 삭제된 행과 겹치면 그 행을 정리한다.
     */
    @Transactional
    public void assertUkFree(BaseAuditEntity entity, Object id, String... ukFields) {
        if (ukFields == null || ukFields.length == 0) return;
        Meta m = meta(entity.getClass());
        Object otherId = findIdByUk(m, entity, ukFields, id);
        if (otherId == null) return;
        String deletedYn = jdbcTemplate.queryForObject(
                "SELECT DELETED_YN FROM " + m.table + " WHERE " + m.idCol + " = ?", String.class, otherId);
        if (!"Y".equals(deletedYn)) {
            throw new IllegalStateException("같은 기준(" + String.join(", ", ukFields)
                    + ")의 데이터가 이미 있습니다. 그 행을 수정하거나 먼저 삭제하세요.");
        }
        jdbcTemplate.update("DELETE FROM " + m.table + " WHERE " + m.idCol + " = ?", otherId);
    }

    /** 소프트 삭제 */
    @Transactional
    public <T extends BaseAuditEntity, ID> void softDelete(JpaRepository<T, ID> repo, ID id) {
        T e = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("데이터를 찾을 수 없습니다: " + id));
        e.softDelete(CurrentUser.get());
        repo.save(e);
    }

    // ---------------------------------------------------------------- 내부

    private Object findIdByUk(Meta m, Object incoming, String[] ukFields, Object excludeId) {
        em.flush(); // 같은 트랜잭션의 JPA 변경분을 먼저 반영해야 JDBC 조회가 정확함
        StringBuilder sql = new StringBuilder("SELECT ").append(m.idCol).append(" FROM ").append(m.table).append(" WHERE ");
        List<Object> args = new ArrayList<>();
        for (int i = 0; i < ukFields.length; i++) {
            Field f = m.field(ukFields[i]);
            if (i > 0) sql.append(" AND ");
            sql.append(column(f)).append(" <=> ?");
            args.add(read(f, incoming));
        }
        if (excludeId != null) {
            sql.append(" AND ").append(m.idCol).append(" <> ?");
            args.add(excludeId);
        }
        sql.append(" ORDER BY CASE WHEN DELETED_YN = 'N' THEN 0 ELSE 1 END LIMIT 1");
        List<Object> ids = jdbcTemplate.query(sql.toString(), (rs, n) -> rs.getObject(1), args.toArray());
        return ids.isEmpty() ? null : ids.get(0);
    }

    private Object castId(Meta m, Object raw) {
        Class<?> t = m.idField.getType();
        if (t == Long.class || t == long.class) return ((Number) raw).longValue();
        if (t == Integer.class || t == int.class) return ((Number) raw).intValue();
        return raw.toString();
    }

    private void copyFields(Meta m, Object from, Object to) {
        for (Field f : m.copyFields) {
            try {
                f.set(to, f.get(from));
            } catch (IllegalAccessException e) {
                throw new IllegalStateException("필드 복사 실패: " + f.getName(), e);
            }
        }
    }

    private static Object read(Field f, Object o) {
        try {
            return f.get(o);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException("필드 읽기 실패: " + f.getName(), e);
        }
    }

    private static String column(Field f) {
        Column c = f.getAnnotation(Column.class);
        if (c == null || c.name().isEmpty()) throw new IllegalStateException("@Column(name) 없음: " + f.getName());
        return c.name();
    }

    private static Meta meta(Class<?> cls) {
        return META.computeIfAbsent(cls, Meta::new);
    }

    private static final class Meta {
        final String table;
        final Field idField;
        final String idCol;
        final List<Field> copyFields = new ArrayList<>();
        final Map<String, Field> byName = new ConcurrentHashMap<>();

        Meta(Class<?> cls) {
            Table t = cls.getAnnotation(Table.class);
            if (t == null) throw new IllegalStateException("@Table 없음: " + cls.getName());
            this.table = t.name();
            Field id = null;
            for (Field f : cls.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers()) || Modifier.isFinal(f.getModifiers())) continue;
                f.setAccessible(true);
                byName.put(f.getName(), f);
                if (f.isAnnotationPresent(Id.class)) { id = f; continue; }
                if (f.isAnnotationPresent(Transient.class)) continue;
                copyFields.add(f);
            }
            if (id == null) throw new IllegalStateException("@Id 없음: " + cls.getName());
            this.idField = id;
            this.idCol = column(id);
        }

        Field field(String name) {
            Field f = byName.get(name);
            if (f == null) throw new IllegalStateException("필드 없음: " + name);
            return f;
        }
    }
}
