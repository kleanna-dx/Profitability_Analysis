// RAG 재빌드 후 sys_aimd_cot015 청크 생성 검증 스크립트
// 사용: node scripts/verify_rag_rebuild.mjs
import mysql from 'mysql2/promise';
import { buildRagIndex } from '../rag.mjs';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'company_board',
  waitForConnections: true,
  connectionLimit: 10,
});

console.log('=== [1/3] 재빌드 전 rag_embeddings 상태 ===');
const [before] = await pool.query(`
  SELECT
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.table_name')), '(null)') AS tbl,
    chunk_type,
    COUNT(*) AS cnt
  FROM rag_embeddings
  GROUP BY tbl, chunk_type
  ORDER BY tbl, chunk_type
`);
console.table(before);

console.log('\n=== [2/3] buildRagIndex 실행 ===');
const count = await buildRagIndex(pool);
console.log(`빌드 완료: ${count} 청크`);

console.log('\n=== [3/3] 재빌드 후 rag_embeddings 상태 ===');
const [after] = await pool.query(`
  SELECT
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.table_name')), '(null)') AS tbl,
    chunk_type,
    COUNT(*) AS cnt
  FROM rag_embeddings
  GROUP BY tbl, chunk_type
  ORDER BY tbl, chunk_type
`);
console.table(after);

console.log('\n=== 핵심 검증: sys_aimd_cot015 청크 ===');
const [key] = await pool.query(`
  SELECT COUNT(*) AS cnt
  FROM rag_embeddings
  WHERE JSON_EXTRACT(metadata,'$.table_name') = 'sys_aimd_cot015'
`);
console.log(`sys_aimd_cot015 청크 수: ${key[0].cnt}`);
if (key[0].cnt > 0) {
  console.log('✅ Bug 1 수정 확인됨 — sys_aimd_cot015 청크가 정상 생성됨');
} else {
  console.log('❌ 여전히 0개 — 추가 조사 필요');
}

await pool.end();
