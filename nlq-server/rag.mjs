/**
 * RAG Module - 메타데이터 검색 증강 생성 (Retrieval-Augmented Generation)
 * 
 * 핵심 설계 원칙 6: "RAG는 row 데이터 검색이 아니라 메타데이터 검색에 사용한다"
 * 
 * 구조:
 *  1. 메타데이터(스키마/온톨로지/메트릭/코드매핑/피드백/조인/규칙)를 청크 단위로 임베딩
 *  2. 사용자 질문을 임베딩하여 관련 메타데이터 청크를 코사인 유사도로 검색
 *  3. 검색된 메타데이터만 시스템 프롬프트에 주입 (전체 덤프 대신)
 */

import OpenAI from 'openai';

// ============================================================
// OpenAI Embedding Client
// ============================================================
const embeddingClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// ============================================================
// 임베딩 생성
// ============================================================
async function createEmbedding(text) {
  const resp = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return resp.data[0].embedding;
}

// 배치 임베딩 (최대 2048개)
async function createEmbeddingBatch(texts) {
  if (texts.length === 0) return [];
  const resp = await embeddingClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return resp.data.map(d => d.embedding);
}

// ============================================================
// 코사인 유사도 계산
// ============================================================
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================
// RAG 인덱스 빌더 - 메타데이터를 청크로 분할하여 임베딩
// ============================================================

/**
 * 전체 메타데이터를 RAG 인덱스로 빌드
 * @param {mysql2.Pool} pool - DB 커넥션 풀
 */
async function buildRagIndex(pool) {
  console.log('[RAG] 메타데이터 인덱스 빌드 시작...');
  
  // 기존 인덱스 삭제 (전체 리빌드)
  await pool.query('DELETE FROM rag_embeddings');
  
  const chunks = [];

  // 1. 스키마 청크 — 컬럼별로 1개씩
  //    [2026-08-25] metadata 에 table_name 을 명시적으로 담아 searchRelevantMeta 에서
  //    tableWhitelist 로 필터할 수 있게 함 (제조원가 세부업무영역 격리용).
  const schemaColumns = await getSchemaColumns(pool);
  for (const col of schemaColumns) {
    const text = `컬럼: ${col.column_name} (${col.data_type}) - ${col.description}. 테이블: ${col.table_name}`;
    chunks.push({
      type: 'schema',
      sourceId: null,
      text,
      metadata: {
        column_name: col.column_name,
        data_type: col.data_type,
        description: col.description,
        table_name: col.table_name,
      },
    });
  }

  // 2. 온톨로지 청크 — 컬럼 + 동의어 포함 (domain_code + table_name 포함)
  //    ★ is_active=1 인 컬럼만 RAG 인덱스에 포함 → 비활성 컬럼은 NLQ에 노출되지 않음
  //    [2026-08-25] 청크 텍스트와 metadata 양쪽에 table_name 명시.
  //      LLM 프롬프트에도 "테이블:xxx" 라벨이 노출되어야 컬럼 소속 테이블을 정확히 판단.
  const [ontRows] = await pool.query(
    `SELECT c.id, c.column_name, c.table_name, c.description, c.data_type, c.domain_code,
            GROUP_CONCAT(s.synonym_text SEPARATOR ', ') AS synonyms
     FROM ontology_column c
     LEFT JOIN ontology_synonym s ON s.column_id = c.id
     WHERE c.is_active = 1
     GROUP BY c.id`
  );
  for (const o of ontRows) {
    let text = `온톨로지 컬럼: ${o.column_name} - ${o.description || ''} [도메인:${o.domain_code || 'ALL'}][테이블:${o.table_name || '-'}]`;
    if (o.synonyms) text += `. 동의어: ${o.synonyms}`;
    chunks.push({
      type: 'ontology',
      sourceId: o.id,
      text,
      metadata: {
        column_name: o.column_name,
        description: o.description,
        synonyms: o.synonyms,
        domain_code: o.domain_code,
        table_name: o.table_name,
      },
    });
  }

  // 3. 메트릭 청크 — 지표 + 수식 + 동의어 (domain_code 포함)
  // [2026-06-30] 청크 텍스트와 metadata의 SQL 표현식을 정확히 생성:
  //   - row-level (formula에 SUM/AVG 등 집계 함수 없음): SUM(formula)로 감쌈
  //   - column-level (formula에 이미 집계 함수 포함): formula 그대로
  //   - aggregation 값이 CALC 가 아니어도, formula가 row-level이면 SUM(formula)로 명확히 표기
  //   → 이렇게 해야 LLM이 "CALC(...)" 같은 무의미한 표기를 보지 않고, 바로 사용 가능한 SQL 표현식을 받음
  const [metRows] = await pool.query(
    `SELECT m.id, m.metric_code, m.aggregation, m.formula, m.description, m.domain_code,
            GROUP_CONCAT(s.synonym_text SEPARATOR ', ') AS synonyms
     FROM metric m
     LEFT JOIN metric_synonym s ON s.metric_id = m.id
     GROUP BY m.id`
  );
  for (const m of metRows) {
    const formula = (m.formula || '').trim();
    const aggUpper = (m.aggregation || '').toUpperCase();
    const hasAggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
    let sqlExpr;
    let level; // 'row-level' | 'column-level'
    if (hasAggInside) {
      sqlExpr = formula;
      level = 'column-level';
    } else if (aggUpper === 'CALC') {
      // CALC + row-level → 전체를 SUM()으로 감싸 사용
      sqlExpr = `SUM(${formula})`;
      level = 'row-level';
    } else if (['SUM','AVG','COUNT','MAX','MIN'].includes(aggUpper)) {
      sqlExpr = `${aggUpper}(${formula})`;
      level = 'row-level';
    } else {
      sqlExpr = formula;
      level = hasAggInside ? 'column-level' : 'row-level';
    }
    let text = `지표: ${m.description || m.metric_code} = ${sqlExpr} [${level}, 도메인:${m.domain_code || 'ALL'}]`;
    text += `. 원본 산식(학습관리 등록값): ${formula}`;
    if (m.synonyms) text += `. 동의어: ${m.synonyms}`;
    chunks.push({
      type: 'metric',
      sourceId: m.id,
      text,
      metadata: {
        metric_code: m.metric_code,
        aggregation: m.aggregation,
        formula: m.formula,
        sql_expr: sqlExpr,
        level,
        description: m.description,
        domain_code: m.domain_code
      },
    });
  }

  // 4. 코드매핑 청크 — 컬럼별로 그룹핑하여 1개 청크
  const [cmRows] = await pool.query(
    `SELECT column_name, GROUP_CONCAT(CONCAT(code_value, '=', display_name) ORDER BY code_value SEPARATOR ', ') AS mappings
     FROM code_mapping WHERE is_active = 1 GROUP BY column_name`
  );
  for (const cm of cmRows) {
    const text = `코드매핑: ${cm.column_name} 값 목록 - ${cm.mappings}`;
    chunks.push({
      type: 'code_mapping',
      sourceId: null,
      text,
      metadata: { column_name: cm.column_name, mappings: cm.mappings },
    });
  }

  // 5. SQL 피드백 청크 — 질문-SQL 쌍
  const [fbRows] = await pool.query(
    `SELECT id, query_text, corrected_sql, feedback_type FROM sql_feedback WHERE is_active = 1`
  );
  for (const fb of fbRows) {
    const text = `검증된 SQL 예시 [${fb.feedback_type}]: 질문="${fb.query_text}" → SQL: ${fb.corrected_sql}`;
    chunks.push({
      type: 'feedback',
      sourceId: fb.id,
      text,
      metadata: { query_text: fb.query_text, corrected_sql: fb.corrected_sql, feedback_type: fb.feedback_type },
    });
  }

  // 6. 조인 조건 청크
  const [joinRows] = await pool.query('SELECT * FROM join_condition');
  for (const j of joinRows) {
    const text = `조인조건: ${j.left_table}.${j.left_column} ${j.join_type} JOIN ${j.right_table}.${j.right_column} (${j.operator}). ${j.description || ''}`;
    chunks.push({
      type: 'join_condition',
      sourceId: j.id,
      text,
      metadata: { left_table: j.left_table, left_column: j.left_column, right_table: j.right_table, right_column: j.right_column },
    });
  }

  // 7. 핵심 규칙 청크
  const rules = [
    'FORMAT() 별칭으로 ORDER BY하면 문자열 정렬이 됨. ORDER BY에는 반드시 SUM(ZAMT...) 같은 원본 집계식을 사용해야 함.',
    '이 테이블에는 _NM(명칭) 컬럼이 없음. 코드값 명칭은 CASE WHEN으로 표시해야 함.',
    'PROFIT_CTR은 10자리 선행0 포함 형태. 예: 0000002000=제지사업부, 0000001000=생활용품사업부.',
    '금액은 FORMAT(SUM(...), 0)으로 천단위 콤마 표시. 비율은 ROUND(..., 1) 소수점 1자리.',
    '브랜드 컬럼은 ZBRAND1(브랜드1), ZBRAND2(브랜드2).',
    '자재명은 MATERIAL_DESC 컬럼 사용. MATERIAL_NM은 없음.',
    '수량단위 컬럼은 ZUNITBOX, ZUNITBAG, ZUNITKGEA. ZBOXUNIT/ZBAGUNIT/ZUNIT은 없음.',
    '수량 컬럼 사용 규칙: "판매수량", "수량"이라고만 하면 BOX 기준(ZQTYBOX)만 사용. BAG수량(ZQTYBAG), EA수량(ZQTYKGEA)은 사용자가 "BAG수량", "EA수량", "모든 수량"처럼 명시적으로 요청할 때만 포함. 절대로 질문에 없는 수량 단위를 추가하지 않는다.',
    '컬럼 최소화 원칙: 사용자가 질문에서 언급한 항목만 SELECT에 포함한다. 관련 있어 보여도 질문에 없는 컬럼은 추가 금지. 예: "브랜드별 판매수량 합계"이면 브랜드와 BOX수량 합계만 출력.',
    '컬럼 별칭(alias) 작성 규칙: 별칭에 단위를 괄호로 명시한다. 예: 판매수량 합계(BOX), 총매출 합계(원), 영업이익률(%), 평균단가(원/BOX). 집계 함수 사용 시 "합계", "평균", "최대" 등을 별칭에 포함.',
    '날짜/기간 필터링: ZYEAR, ZMONTH, FISC_YEAR, FISC_PERIOD, YEAR, MONTH 컬럼은 존재하지 않는다! 절대 사용 금지! 연도/월 필터는 CALMONTH(VARCHAR, YYYYMM 형식) 사용. 예: "2024년 5월" → WHERE CALMONTH = \'202405\'. 연도만 필터: LEFT(CALMONTH,4) = \'2024\'. 일자 필터는 CALDAY(VARCHAR, YYYYMMDD 형식) 사용. 현재 데이터는 CALMONTH=\'202405\' (2024년 5월) 한 달치만 존재.',
  ];
  for (let i = 0; i < rules.length; i++) {
    chunks.push({
      type: 'rule',
      sourceId: i + 1,
      text: `SQL 생성 규칙: ${rules[i]}`,
      metadata: { rule_index: i + 1 },
    });
  }

  console.log(`[RAG] 총 ${chunks.length}개 청크 임베딩 시작...`);

  // 배치 임베딩 (20개씩)
  const BATCH_SIZE = 20;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);
    const embeddings = await createEmbeddingBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      await pool.query(
        `INSERT INTO rag_embeddings (chunk_type, source_id, chunk_text, embedding, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [
          batch[j].type,
          batch[j].sourceId,
          batch[j].text,
          JSON.stringify(embeddings[j]),
          JSON.stringify(batch[j].metadata),
        ]
      );
    }
    console.log(`[RAG] 임베딩 진행: ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }

  console.log(`[RAG] ✅ 인덱스 빌드 완료: ${chunks.length}개 청크`);
  return chunks.length;
}

// 스키마 컬럼 정보 (DB 코멘트에서 추출)
//
// [2026-08-25] 다중 테이블 지원 — 원래 bw_profitability_data 한 테이블만 하드코딩되어
//   sys_aimd_cot015 / sys_aimd_cot043 (제조원가 세부업무영역) 은 RAG schema 청크가
//   생성되지 않아 NLQ 가 "알 수 없는 용어" 로 refuse 하는 버그가 있었음.
//
//   해결: ontology_column 에 등록된 모든 distinct table_name 을 대상으로 스키마 조회.
//         이러면 신규 업무영역 테이블을 추가할 때 학습관리 화면에서 컬럼 등록만 하면
//         자동으로 스키마 청크가 인덱스에 포함됨(하드코딩 유지보수 불필요).
//
//   Fallback: 온톨로지가 비어있는 초기 상태에서도 최소 bw_profitability_data 는 인덱싱.
async function getSchemaColumns(pool) {
  // 1) 온톨로지에 등록된 대상 테이블 목록 수집 (신규 업무영역 자동 감지)
  const [tblRows] = await pool.query(
    `SELECT DISTINCT table_name
       FROM ontology_column
      WHERE is_active = 1
        AND table_name IS NOT NULL
        AND table_name <> ''`
  );
  const targetTables = tblRows.map(r => r.table_name);
  // 2) Fallback — 온톨로지가 비어있으면 기존 동작 유지
  if (targetTables.length === 0) {
    targetTables.push('bw_profitability_data');
  }
  // 3) 존재하지 않는 테이블은 warn 후 스킵 (INFORMATION_SCHEMA IN 절 안전 처리)
  const [existRows] = await pool.query(
    `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'company_board'
        AND TABLE_NAME IN (?)`,
    [targetTables]
  );
  const existingSet = new Set(existRows.map(r => r.TABLE_NAME));
  const missing = targetTables.filter(t => !existingSet.has(t));
  if (missing.length > 0) {
    console.warn(`[RAG] 스키마 인덱싱 대상 중 존재하지 않는 테이블 스킵: ${missing.join(', ')}`);
  }
  const finalTables = targetTables.filter(t => existingSet.has(t));
  if (finalTables.length === 0) {
    console.warn('[RAG] 인덱싱 가능한 스키마 테이블이 없음 — schema 청크 0건');
    return [];
  }
  // 4) 실제 스키마 조회
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type,
            COLUMN_COMMENT AS description, TABLE_NAME AS table_name
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'company_board'
        AND TABLE_NAME IN (?)
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [finalTables]
  );
  console.log(`[RAG] 스키마 인덱싱 대상 테이블 (${finalTables.length}개): ${finalTables.join(', ')} → 컬럼 ${rows.length}개`);
  return rows;
}

// ============================================================
// RAG 검색 - 질문과 관련된 메타데이터 청크 검색
// ============================================================

/**
 * 사용자 질문을 임베딩하여 관련 메타데이터를 검색
 * @param {mysql2.Pool} pool - DB 커넥션 풀
 * @param {string} query - 사용자 질문
 * @param {Object} options - 검색 옵션
 * @returns {Object} 검색 결과 (카테고리별 분류)
 */
async function searchRelevantMeta(pool, query, options = {}) {
  const {
    topK = 20,              // 전체 반환 수
    minScore = 0.25,        // 최소 유사도 임계값
    schemaTopK = 10,        // 스키마 관련 최대
    metricTopK = 5,         // 메트릭 관련 최대
    feedbackTopK = 5,       // 피드백 관련 최대
    codeMappingTopK = 5,    // 코드매핑 관련 최대
    ruleTopK = 3,           // 규칙 관련 최대
    domainCode = null,      // 도메인 필터 (ontology/metric 청크에 적용)
    tableWhitelist = null,  // [2026-08-25] 업무영역 탭 필터: 허용 테이블 목록 (ontology/schema 청크에 적용)
  } = options;

  // 1. 질문 임베딩
  const queryEmbedding = await createEmbedding(query);

  // 2. DB에서 모든 활성 청크 로드
  const [allChunks] = await pool.query(
    `SELECT id, chunk_type, source_id, chunk_text, embedding, metadata 
     FROM rag_embeddings WHERE is_active = 1`
  );

  if (allChunks.length === 0) {
    console.warn('[RAG] 인덱스가 비어있습니다. buildRagIndex()를 먼저 실행하세요.');
    return { schema: [], ontology: [], metric: [], code_mapping: [], feedback: [], join_condition: [], rule: [] };
  }

  // 3. 코사인 유사도 계산 및 정렬 (도메인 필터링 포함)
  const scored = allChunks.map(chunk => {
    const vec = JSON.parse(chunk.embedding);
    const score = cosineSimilarity(queryEmbedding, vec);
    const meta = chunk.metadata ? JSON.parse(chunk.metadata) : {};
    return {
      id: chunk.id,
      type: chunk.chunk_type,
      sourceId: chunk.source_id,
      text: chunk.chunk_text,
      score,
      metadata: meta,
    };
  }).filter(c => {
    if (c.score < minScore) return false;
    // ★ 도메인 필터: ontology/metric 청크는 해당 도메인만 허용
    if (domainCode && (c.type === 'ontology' || c.type === 'metric')) {
      const chunkDomain = c.metadata?.domain_code;
      if (chunkDomain && chunkDomain !== domainCode) return false;
    }
    // ★ [2026-08-25] 테이블 화이트리스트 필터: ontology/schema 청크는 허용 테이블만
    //    (업무영역 탭 강제 필터가 적용되었을 때 다른 테이블 컬럼이 LLM 컨텍스트에 섞이는 것을 방지)
    if (tableWhitelist && Array.isArray(tableWhitelist) && tableWhitelist.length > 0) {
      if (c.type === 'ontology' || c.type === 'schema') {
        const chunkTable = c.metadata?.table_name;
        // 메타데이터에 table_name이 있으면 화이트리스트와 대조 (없는 청크는 통과)
        if (chunkTable && !tableWhitelist.includes(chunkTable)) return false;
      }
    }
    return true;
  }).sort((a, b) => b.score - a.score);

  // 4. 카테고리별 Top-K 분류
  //
  // [2026-08-25] tableWhitelist 를 result 에 담아 프롬프트 렌더링 단계로 전달.
  //   원래 예시 SQL 이 `FROM bw_profitability_data` 로 하드코딩되어 있어
  //   제조원가 세부업무영역 탭에서 잘못된 테이블로 SQL 이 유도되던 버그 방지.
  const result = {
    schema: [],
    ontology: [],
    metric: [],
    code_mapping: [],
    feedback: [],
    join_condition: [],
    rule: [],
    _tableWhitelist: (tableWhitelist && Array.isArray(tableWhitelist) && tableWhitelist.length > 0)
      ? [...tableWhitelist] : null,
  };

  const limits = {
    schema: schemaTopK,
    ontology: schemaTopK,
    metric: metricTopK,
    code_mapping: codeMappingTopK,
    feedback: feedbackTopK,
    join_condition: 3,
    rule: ruleTopK,
  };

  let total = 0;
  for (const item of scored) {
    if (total >= topK) break;
    const cat = item.type;
    if (result[cat] && result[cat].length < (limits[cat] || 5)) {
      result[cat].push(item);
      total++;
    }
  }

  console.log(`[RAG] 검색 결과: schema=${result.schema.length}, ontology=${result.ontology.length}, metric=${result.metric.length}, code_mapping=${result.code_mapping.length}, feedback=${result.feedback.length}, rule=${result.rule.length}`);

  // ============================================================
  // 5. 원가/비용 항목 그룹 첨부 (결정적)
  //   - 사용자 질문에 "원가항목/원가 항목/원가" 또는 "비용항목/비용 항목/비용"
  //     키워드가 있으면 해당 그룹의 활성 컬럼 목록을 첨부.
  //   - RAG topK 유사도 검색이 그룹의 일부 컬럼만 뽑아오는 문제를 방지.
  // ============================================================
  try {
    const detection = _detectTypesInQuery(query);
    if (detection.isGroupQuery) {
      const placeholders = detection.types.map(() => '?').join(',');
      const params = [...detection.types];
      let sql = `SELECT type, column_name, description, table_name
                 FROM ontology_column
                 WHERE type IN (${placeholders})
                   AND is_active = 1`;
      if (domainCode) {
        sql += ` AND domain_code = ?`;
        params.push(domainCode);
      }
      // [2026-08-25] 테이블 화이트리스트: 강제 필터 활성 시 다른 테이블 컬럼 배제
      if (tableWhitelist && Array.isArray(tableWhitelist) && tableWhitelist.length > 0) {
        const tPh = tableWhitelist.map(() => '?').join(',');
        sql += ` AND table_name IN (${tPh})`;
        params.push(...tableWhitelist);
      }
      sql += ` ORDER BY type, column_name`;
      const [typeRows] = await pool.query(sql, params);
      result.type_groups = {};
      for (const r of typeRows) {
        if (!result.type_groups[r.type]) result.type_groups[r.type] = [];
        result.type_groups[r.type].push({
          column_name: r.column_name,
          description: r.description || '',
        });
      }
      // 매칭된 텍스트 정보도 첨부 (server.mjs 에서 동의어 매칭 가드에 활용)
      result.type_matched_spans = detection.matchedSpans;
      console.log(`[RAG] 원가/비용 포괄 표현 감지: [${detection.matchedSpans.map(s => s.matchedText).join(', ')}] → 그룹 ${detection.types.join(',')} (${typeRows.length}개 컬럼)`);
    }
  } catch (e) {
    console.warn('[RAG] 원가/비용 그룹 조회 실패 (무시):', e.message);
  }

  return result;
}

// ============================================================
// 사용자 질문에서 "원가/비용 포괄 표현" 감지
// 반환: { types: ['원가'|'비용'...], isGroupQuery: bool, matchedSpans: [{start,end,matchedText,type}] }
//
// ★ 핵심 원칙: "포괄 표현" 만 감지, "특정 지표명" 은 제외
//   포괄 표현 (감지 O): '원가', '원가 항목', '원가항목', '원가 중', '원가에서',
//                        '원가 관련', '원가성', '원가별', '원가 컬럼', '원가 TOP',
//                        '원가와/원가는/원가의/원가을...' (조사 붙은 경우)
//   특정 지표명 (감지 X): '매출원가', '매출원가(제품)', '상품원가', '제조원가',
//                          '기타매출원가', '원가율' 등
//                          → matchSynonymsDirectly() 에서 개별 지표로 처리됨
//
// ★ 판정 규칙:
//   1. '원가'/'비용' 앞에 한글이 있으면 지표명으로 간주 → 제외 (예: 매출원가, 상품원가)
//   2. '원가'/'비용' 뒤에:
//      - 포괄 접미사 (항목/중/에서/관련/성/별/컬럼/전체/TOP) → 포괄 표현
//      - 조사 (와/과/및/이/가/은/는/을/를/의/도/만/라/랑) → 포괄 표현
//      - 공백/문장끝 (한글이 아닌 것) → 포괄 표현
//      - 다른 한글 (예: '원가율', '원가계정') → 지표명으로 간주, 제외
// ============================================================
function _detectTypesInQuery(query) {
  if (!query || typeof query !== 'string') {
    return { types: [], isGroupQuery: false, matchedSpans: [] };
  }
  const types = new Set();
  const matchedSpans = [];

  // 포괄 접미사 (원가/비용 바로 뒤에 오면 포괄 판정)
  const GENERIC_SUFFIX = '(?:\\s*(?:항목|항목별|중|에서|관련|성|별|컬럼|전체)|\\s*TOP)';
  // 조사 (원가/비용 바로 뒤에 붙으면 포괄 판정)
  const JOSA = '(?:와|과|및|이|가|은|는|을|를|의|도|만|라|랑)';

  const patterns = {
    // (?<![가-힣])원가 : 앞에 한글 없어야 함 → 매출원가/상품원가/제조원가 배제
    // 뒤: 포괄접미사 | 조사 | 한글아님(공백/구두점/문장끝)
    '원가': new RegExp(`(?<![가-힣])원가(?:${GENERIC_SUFFIX}|${JOSA}|(?![가-힣]))`, 'g'),
    '비용': new RegExp(`(?<![가-힣])비용(?:${GENERIC_SUFFIX}|${JOSA}|(?![가-힣]))`, 'g'),
  };

  for (const [type, re] of Object.entries(patterns)) {
    let m;
    while ((m = re.exec(query)) !== null) {
      matchedSpans.push({ start: m.index, end: m.index + m[0].length, matchedText: m[0], type });
      types.add(type);
    }
  }

  return { types: [...types], isGroupQuery: types.size > 0, matchedSpans };
}

// ============================================================
// RAG 결과 → 프롬프트 텍스트 변환
// ============================================================

/**
 * RAG 검색 결과를 시스템 프롬프트에 주입할 텍스트로 변환
 * @param {Object} ragResult - searchRelevantMeta() 결과
 * @returns {string} 프롬프트에 주입할 컨텍스트 텍스트
 */
function ragResultToPromptContext(ragResult) {
  let ctx = '';

  // 관련 스키마 컬럼
  if (ragResult.schema.length > 0 || ragResult.ontology.length > 0) {
    ctx += '\n[관련 컬럼 정보]\n';
    const seen = new Set();
    for (const s of [...ragResult.schema, ...ragResult.ontology]) {
      const colName = s.metadata?.column_name;
      if (colName && !seen.has(colName)) {
        seen.add(colName);
        ctx += `- ${colName}: ${s.metadata.data_type || ''} - ${s.metadata.description || ''}\n`;
        if (s.metadata.synonyms) ctx += `  동의어: ${s.metadata.synonyms}\n`;
      }
    }
  }

  // 관련 메트릭
  // [2026-06-30] sql_expr / level 을 함께 노출하여 LLM이 row-level/column-level을 명확히 인식하도록 함
  if (ragResult.metric.length > 0) {
    ctx += '\n[관련 계산 지표]\n';
    for (const m of ragResult.metric) {
      const md = m.metadata || {};
      const name = md.description || md.metric_code;
      const formula = md.formula || '';
      // sql_expr이 metadata에 있으면 그대로 사용, 없으면 (구 인덱스 호환) row-level 가정으로 SUM(formula) 생성
      let sqlExpr = md.sql_expr;
      let level = md.level;
      if (!sqlExpr) {
        const hasAggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
        if (hasAggInside) { sqlExpr = formula; level = level || 'column-level'; }
        else { sqlExpr = `SUM(${formula})`; level = level || 'row-level'; }
      }
      ctx += `- ${name} (${md.metric_code || '?'}) [${level || 'row-level'}]\n`;
      ctx += `    원본 산식: ${formula}\n`;
      ctx += `    SQL 표현식: ${sqlExpr}\n`;
    }
    ctx += `  ※ row-level 산식은 위 "SQL 표현식"을 그대로 사용하세요 (전체를 SUM()으로 감싼 형태). 컬럼별 SUM 분배 금지.\n`;
  }

  // 원가/비용 항목 그룹 (사용자 질문에 "원가항목/비용항목" 등 포괄 표현이 감지된 경우만)
  if (ragResult.type_groups && Object.keys(ragResult.type_groups).length > 0) {
    const detectedSpans = (ragResult.type_matched_spans || []).map(s => `"${s.matchedText}"`).join(', ');
    ctx += `\n[★ 원가/비용 그룹 라우팅 — 포괄 표현 감지됨]\n`;
    ctx += `사용자 질의에서 다음 포괄 표현이 감지되었습니다: ${detectedSpans || '(감지된 표현 없음)'}\n`;
    ctx += `이 질의는 특정 지표(매출원가/상품원가/제조원가 등) 조회가 아니라 "구분값별 컬럼 묶음 비교" 요청입니다.\n`;
    ctx += `아래 그룹에 속한 컬럼들만 UNION ALL 로 SUM 하여 항목명(설명) 기준으로 비교하세요.\n`;
    ctx += `\n🚫 이 그룹 조회 시 다음 금지사항을 반드시 지키세요:\n`;
    ctx += `  - 위 그룹 컬럼 이외의 지표성 컬럼(예: ZAMT034 "매출원가 계", ZAMT005 "매출원가(제품)" 등)을 SELECT 에 섞지 마세요.\n`;
    ctx += `  - [관련 컬럼 정보] 섹션에 "매출원가" 같은 항목이 보여도, 사용자가 "원가/비용 + 포괄 표현" 으로\n`;
    ctx += `    질문했으므로 그것은 우선순위가 낮습니다. 반드시 아래 그룹만 사용하세요.\n`;
    ctx += `  - 결과 '항목명' 컬럼에는 컬럼코드(ZAMT049)가 아니라 설명(description, 예: "소모품비") 을 사용하세요.\n`;

    for (const [ct, cols] of Object.entries(ragResult.type_groups)) {
      if (!Array.isArray(cols) || cols.length === 0) continue;
      ctx += `\n[${ct} 항목 그룹 — 대상 컬럼 목록 (${cols.length}개)]\n`;
      for (const c of cols) {
        // 방어적: column_name/description 이 null/undefined 여도 안전
        const cn = (c && c.column_name) ? String(c.column_name) : '(unknown)';
        const desc = (c && c.description != null && String(c.description).trim() !== '')
          ? String(c.description)
          : cn; // 설명이 없으면 컬럼코드로 fallback (요구사항 6번)
        ctx += `- ${cn}: ${desc}\n`;
      }
    }

    // [2026-08-25] 예시 SQL 의 테이블명을 tableWhitelist 우선으로 동적 결정.
    //   원래 'bw_profitability_data' 하드코딩 → 제조원가 탭에서도 이 예시 때문에
    //   LLM 이 잘못된 테이블로 SQL 을 생성하던 문제를 예방.
    //   fallback: whitelist 가 없으면 기존 동작 유지(bw_profitability_data).
    const exampleTable = (ragResult._tableWhitelist && ragResult._tableWhitelist.length > 0)
      ? ragResult._tableWhitelist[0]
      : 'bw_profitability_data';
    ctx += `\n📝 예시 SQL 구조 (그룹 조회):\n`;
    ctx += `  SELECT '<설명1 또는 컬럼코드>' AS 항목명, SUM(COALESCE(<컬럼1>, 0)) AS 금액\n`;
    ctx += `    FROM ${exampleTable} WHERE <필터>\n`;
    ctx += `  UNION ALL\n`;
    ctx += `  SELECT '<설명2 또는 컬럼코드>' AS 항목명, SUM(COALESCE(<컬럼2>, 0)) AS 금액\n`;
    ctx += `    FROM ${exampleTable} WHERE <필터>\n`;
    ctx += `  ...\n`;
    ctx += `  ORDER BY 금액 DESC LIMIT N;\n`;
    ctx += `\n  ⚠️ 각 컬럼은 NULL 이 포함될 수 있으므로 반드시 SUM(COALESCE(컬럼, 0)) 형태로 감싸세요.\n`;
    ctx += `  ⚠️ 항목명(설명)에는 위 목록의 "설명" 을 사용하고, 설명이 비어있으면 컬럼코드를 그대로 넣으세요.\n`;
    ctx += `\n💡 반대로, 사용자가 "매출원가", "상품원가", "제조원가" 같은 특정 지표명을 명시했다면\n`;
    ctx += `   이 그룹이 아니라 [관련 컬럼 정보] 또는 [관련 Metric] 섹션의 개별 지표를 사용하세요.\n`;
  }

  // 관련 코드매핑
  if (ragResult.code_mapping.length > 0) {
    ctx += '\n[관련 코드값 매핑]\n';
    for (const cm of ragResult.code_mapping) {
      ctx += `- ${cm.metadata.column_name}: ${cm.metadata.mappings}\n`;
    }
  }

  // 관련 검증 SQL (피드백)
  if (ragResult.feedback.length > 0) {
    ctx += '\n[유사 질문의 검증된 SQL 예시 - 이 패턴을 우선 참고하세요]\n';
    for (const fb of ragResult.feedback) {
      const label = fb.metadata.feedback_type === 'corrected' ? '[사용자 수정 - 최우선]' : '[검증 완료]';
      ctx += `${label} 질문: "${fb.metadata.query_text}"\nSQL: ${fb.metadata.corrected_sql}\n\n`;
    }
  }

  // 관련 조인 조건
  if (ragResult.join_condition.length > 0) {
    ctx += '\n[관련 조인 조건]\n';
    for (const j of ragResult.join_condition) {
      ctx += `- ${j.text}\n`;
    }
  }

  // 관련 규칙
  if (ragResult.rule.length > 0) {
    ctx += '\n[관련 SQL 생성 규칙]\n';
    for (const r of ragResult.rule) {
      ctx += `- ${r.text.replace('SQL 생성 규칙: ', '')}\n`;
    }
  }

  return ctx;
}

// ============================================================
// 단건 임베딩 추가 (피드백/매핑 추가 시 호출)
// ============================================================
async function addToIndex(pool, chunkType, sourceId, text, metadata) {
  try {
    const embedding = await createEmbedding(text);
    await pool.query(
      `INSERT INTO rag_embeddings (chunk_type, source_id, chunk_text, embedding, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [chunkType, sourceId, text, JSON.stringify(embedding), JSON.stringify(metadata)]
    );
    console.log(`[RAG] 인덱스 추가: ${chunkType} #${sourceId}`);
    return true;
  } catch (e) {
    console.error(`[RAG] 인덱스 추가 실패:`, e.message);
    return false;
  }
}

// 특정 소스 삭제 (업데이트 시 기존 제거 후 재추가)
async function removeFromIndex(pool, chunkType, sourceId) {
  if (sourceId === null || sourceId === undefined) {
    // sourceId가 null인 경우 해당 타입 전체 삭제 (schema, code_mapping 등)
    await pool.query(
      `DELETE FROM rag_embeddings WHERE chunk_type = ? AND source_id IS NULL`,
      [chunkType]
    );
  } else {
    await pool.query(
      `DELETE FROM rag_embeddings WHERE chunk_type = ? AND source_id = ?`,
      [chunkType, sourceId]
    );
  }
}

// ============================================================
// RAG 상태 확인
// ============================================================
async function getRagStats(pool) {
  const [rows] = await pool.query(
    `SELECT chunk_type, COUNT(*) AS cnt FROM rag_embeddings WHERE is_active = 1 GROUP BY chunk_type`
  );
  const total = rows.reduce((sum, r) => sum + r.cnt, 0);
  return { total, byType: Object.fromEntries(rows.map(r => [r.chunk_type, r.cnt])) };
}

export {
  buildRagIndex,
  searchRelevantMeta,
  ragResultToPromptContext,
  addToIndex,
  removeFromIndex,
  getRagStats,
  createEmbedding,
  _detectTypesInQuery,  // server.mjs 에서 동의어 매칭 가드용
};
