/**
 * csv11.csv → bw_profitability_data 스트림 적재 스크립트
 * - readline 스트림으로 한 줄씩 읽어 메모리 최소화
 * - 200행씩 배치 INSERT
 * - 기존 데이터 전체 삭제 후 INSERT
 */
import fs from 'fs';
import readline from 'readline';
import mysql from 'mysql2/promise';

const CSV_PATH = '/home/user/uploaded_files/csv11.csv';
const BATCH_SIZE = 200;

function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

async function main() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'company', password: 'company1234!',
    database: 'company_board', charset: 'utf8mb4',
    waitForConnections: true, connectionLimit: 5,
  });

  console.log('[적재] csv11.csv → bw_profitability_data 시작');
  console.time('[적재] 전체 소요시간');

  // 1행: 주석, 2행: 컬럼명 읽기
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let csvCols = [];       // CSV 2행 영문 컬럼명
  let colIndexMap = [];   // { csvIdx, dbCol } 매핑
  let colList = '';
  let singlePlaceholder = '';

  // DB 컬럼 목록 조회
  const [dbColsRaw] = await pool.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA='company_board' AND TABLE_NAME='bw_profitability_data'
    AND COLUMN_NAME != 'SEQ'
    ORDER BY ORDINAL_POSITION
  `);
  const dbColSet = new Set(dbColsRaw.map(r => r.COLUMN_NAME));
  console.log(`[적재] DB 컬럼: ${dbColSet.size}개 (SEQ 제외)`);

  // 기존 데이터 삭제
  const [countBefore] = await pool.query('SELECT COUNT(*) AS cnt FROM bw_profitability_data');
  const oldCount = Number(countBefore[0].cnt);
  if (oldCount > 0) {
    console.log(`[적재] 기존 데이터 ${oldCount.toLocaleString()}행 삭제 중...`);
    await pool.query('DELETE FROM bw_profitability_data');
    await pool.query('ALTER TABLE bw_profitability_data AUTO_INCREMENT = 1');
    console.log(`[적재] 기존 데이터 삭제 완료`);
  }

  const conn = await pool.getConnection();
  let inserted = 0;
  let errors = 0;
  let currentBatch = [];
  let totalDataRows = 0;

  async function flushBatch() {
    if (currentBatch.length === 0) return;
    const valuePlaceholders = currentBatch.map(() => singlePlaceholder).join(',');
    const flatValues = currentBatch.flat();
    const sql = `INSERT INTO bw_profitability_data (${colList}) VALUES ${valuePlaceholders}`;
    try {
      await conn.query(sql, flatValues);
      inserted += currentBatch.length;
    } catch (batchErr) {
      // 배치 실패 → 개별 INSERT 폴백
      for (const rowVals of currentBatch) {
        try {
          await conn.query(`INSERT INTO bw_profitability_data (${colList}) VALUES ${singlePlaceholder}`, rowVals);
          inserted++;
        } catch (rowErr) {
          errors++;
          if (errors <= 10) console.error(`  [오류] 행 ${totalDataRows}: ${rowErr.message.substring(0, 150)}`);
        }
      }
    }
    currentBatch = [];
  }

  await new Promise((resolve, reject) => {
    rl.on('line', async (line) => {
      lineNum++;

      if (lineNum === 1) return;  // 1행: 한글 주석 스킵

      if (lineNum === 2) {
        // 2행: 영문 컬럼명 → DB 매핑
        csvCols = parseCSVLine(line);
        for (let i = 0; i < csvCols.length; i++) {
          const col = csvCols[i].trim();
          if (col && dbColSet.has(col)) {
            colIndexMap.push({ csvIdx: i, dbCol: col });
          }
        }
        colList = colIndexMap.map(m => '`' + m.dbCol + '`').join(', ');
        singlePlaceholder = '(' + colIndexMap.map(() => '?').join(',') + ')';
        console.log(`[적재] CSV 컬럼 ${csvCols.length}개 중 ${colIndexMap.length}개 DB 매핑`);
        console.log('[적재] 데이터 적재 시작...');
        console.time('[적재] INSERT 소요시간');
        return;
      }

      // 3행~: 데이터
      const trimmed = line.trim();
      if (!trimmed) return;

      const fields = parseCSVLine(line);

      // 빈 행 필터링
      const hasValue = colIndexMap.some(m => {
        const v = fields[m.csvIdx];
        return v !== undefined && v !== null && v.trim() !== '';
      });
      if (!hasValue) return;

      totalDataRows++;

      const rowValues = colIndexMap.map(m => {
        const v = fields[m.csvIdx];
        if (v === undefined || v === null || v === '') return null;
        return v;
      });
      currentBatch.push(rowValues);

      if (currentBatch.length >= BATCH_SIZE) {
        rl.pause();
        await flushBatch();
        if (totalDataRows % 10000 < BATCH_SIZE) {
          console.log(`  [진행] ${totalDataRows.toLocaleString()}행 읽음 / ${inserted.toLocaleString()}행 INSERT 성공`);
        }
        rl.resume();
      }
    });

    rl.on('close', async () => {
      try {
        await flushBatch();  // 남은 배치 처리
        resolve();
      } catch (e) { reject(e); }
    });

    rl.on('error', reject);
  });

  console.timeEnd('[적재] INSERT 소요시간');
  conn.release();

  // 최종 행수 확인
  const [countAfter] = await pool.query('SELECT COUNT(*) AS cnt FROM bw_profitability_data');
  const finalCount = Number(countAfter[0].cnt);

  console.log('');
  console.log('=== 적재 결과 ===');
  console.log(`  기존 데이터: ${oldCount.toLocaleString()}행 삭제`);
  console.log(`  CSV 데이터행: ${totalDataRows.toLocaleString()}행`);
  console.log(`  INSERT 성공: ${inserted.toLocaleString()}행`);
  console.log(`  INSERT 실패: ${errors}건`);
  console.log(`  DB 총 행수: ${finalCount.toLocaleString()}행`);
  console.timeEnd('[적재] 전체 소요시간');

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('[적재] 치명적 오류:', err);
  process.exit(1);
});
