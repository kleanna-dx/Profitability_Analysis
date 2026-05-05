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
// OpenAI Embedding Client (GSK_TOKEN 사용)
// ============================================================
const embeddingClient = new OpenAI({
  apiKey: process.env.GSK_TOKEN || process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1',
});

const EMBEDDING_MODEL = 'text-embedding-3-small';
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
  const schemaColumns = await getSchemaColumns(pool);
  for (const col of schemaColumns) {
    const text = `컬럼: ${col.column_name} (${col.data_type}) - ${col.description}. 테이블: ${col.table_name}`;
    chunks.push({
      type: 'schema',
      sourceId: null,
      text,
      metadata: { column_name: col.column_name, data_type: col.data_type, description: col.description },
    });
  }

  // 2. 온톨로지 청크 — 컬럼 + 동의어 포함
  const [ontRows] = await pool.query(
    `SELECT c.id, c.column_name, c.table_name, c.description, c.data_type,
            GROUP_CONCAT(s.synonym_text SEPARATOR ', ') AS synonyms
     FROM ontology_column c
     LEFT JOIN ontology_synonym s ON s.column_id = c.id
     GROUP BY c.id`
  );
  for (const o of ontRows) {
    let text = `온톨로지 컬럼: ${o.column_name} - ${o.description || ''}`;
    if (o.synonyms) text += `. 동의어: ${o.synonyms}`;
    chunks.push({
      type: 'ontology',
      sourceId: o.id,
      text,
      metadata: { column_name: o.column_name, description: o.description, synonyms: o.synonyms },
    });
  }

  // 3. 메트릭 청크 — 지표 + 수식 + 동의어
  const [metRows] = await pool.query(
    `SELECT m.id, m.metric_code, m.aggregation, m.formula, m.description,
            GROUP_CONCAT(s.synonym_text SEPARATOR ', ') AS synonyms
     FROM metric m
     LEFT JOIN metric_synonym s ON s.metric_id = m.id
     GROUP BY m.id`
  );
  for (const m of metRows) {
    let text = `지표: ${m.description || m.metric_code} = ${m.aggregation}(${m.formula})`;
    if (m.synonyms) text += `. 동의어: ${m.synonyms}`;
    chunks.push({
      type: 'metric',
      sourceId: m.id,
      text,
      metadata: { metric_code: m.metric_code, aggregation: m.aggregation, formula: m.formula, description: m.description },
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
async function getSchemaColumns(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS data_type, 
            COLUMN_COMMENT AS description, TABLE_NAME AS table_name
     FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = 'company_board' AND TABLE_NAME = 'bw_profitability_data'
     ORDER BY ORDINAL_POSITION`
  );
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

  // 3. 코사인 유사도 계산 및 정렬
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
  }).filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  // 4. 카테고리별 Top-K 분류
  const result = {
    schema: [],
    ontology: [],
    metric: [],
    code_mapping: [],
    feedback: [],
    join_condition: [],
    rule: [],
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

  return result;
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
  if (ragResult.metric.length > 0) {
    ctx += '\n[관련 계산 지표]\n';
    for (const m of ragResult.metric) {
      ctx += `- ${m.metadata.description || m.metadata.metric_code} = ${m.metadata.aggregation}(${m.metadata.formula})\n`;
    }
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
  await pool.query(
    `DELETE FROM rag_embeddings WHERE chunk_type = ? AND source_id = ?`,
    [chunkType, sourceId]
  );
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
};
