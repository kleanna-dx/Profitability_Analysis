package com.company.module.rollingplanningsimulation.support;

/**
 * rpsim_raw_material(SAP 원부재료 사용현황) 집계 공통 규칙 — P/L 시뮬레이터·원부재료비 탭이 같은 기준을 쓰도록 한 곳에서 관리
 *
 * <ul>
 *   <li>생산량: 자재 행마다 같은 값이 반복 → (호기, 제품레벨4)별 MAX 후 합계, kg ÷ 1000 = 톤</li>
 *   <li>재료비: 실적배부수량 × 실적단가 (출고금액은 자재 전체 금액이 제품 행마다 반복되어 사용하지 않음)</li>
 *   <li>원/부 구분: DATA_TYPE '100'=원재료(자재그룹 1*) / '101'=부재료(자재그룹 2*) — SAP 수신 시 분류</li>
 *   <li>지종: 제품레벨2명이 SC·백판지 기타면 제품레벨4 끝 3자리(평량) 300 미만=SC저평량 / 이상=SC고평량</li>
 * </ul>
 */
public final class RawMaterialSql {
    private RawMaterialSql() {}

    /** 생산량 컬럼 — 총생산량(폐품 포함). 양품 기준으로 바꾸려면 BIC_ZPRD_QTY */
    public static final String PROD_QTY_COL = "BIC_ZTPQTY";

    /** 재료비 = 실적배부수량 × 실적단가 */
    public static final String COST_EXPR = "(COALESCE(BIC_ZDTB_QTY,0) * COALESCE(BIC_ZTPRICE,0))";

    /** 지종 분류 */
    public static final String PRODUCT_EXPR =
            "CASE WHEN TRIM(PRODH2_NM) IN ('SC','백판지 기타') THEN " +
            "  CASE WHEN CAST(RIGHT(TRIM(PRODH4),3) AS UNSIGNED) < 300 THEN 'SC저평량' ELSE 'SC고평량' END " +
            "ELSE COALESCE(NULLIF(TRIM(PRODH2_NM),''),'(미분류)') END";

    /**
     * 생산계획(rpsim_production_plan) 지종명 → SAP 실적 지종명(PRODUCT_EXPR)과 같은 규칙.
     * SC·백판지 기타는 평량 300 미만=SC저평량 / 이상=SC고평량. 평량이 없으면 분류 불가로 남겨 0 처리(경고)
     */
    public static final String PLAN_PRODUCT_EXPR =
            "CASE WHEN TRIM(PRODUCT) IN ('SC','백판지 기타') THEN " +
            "  CASE WHEN COALESCE(BASIS_WEIGHT,0) <= 0 THEN CONCAT(TRIM(PRODUCT),'(평량 없음)')" +
            "       WHEN BASIS_WEIGHT < 300 THEN 'SC저평량' ELSE 'SC고평량' END " +
            "ELSE TRIM(PRODUCT) END";

    /**
     * 사업부 범위 — rpsim_raw_material 에는 사업부 컬럼이 없어 호기 마스터(rpsim_unit)로 판단.
     * 해당 사업부에 등록된 호기만 포함 (미등록이면 0건 — 다른 사업부 데이터가 섞이지 않게). 파라미터 1개: division
     * 두 테이블의 콜레이션이 달라도 비교 오류가 나지 않도록 COLLATE 지정
     */
    public static final String DIV_SCOPE =
            " AND CONVERT(BIC_ZMACHINE USING utf8mb4) COLLATE utf8mb4_general_ci IN (SELECT CONVERT(u.UNIT_CODE USING utf8mb4) COLLATE utf8mb4_general_ci" +
            "   FROM rpsim_unit u WHERE u.DIVISION = ? AND u.DELETED_YN = 'N')";
    /** 호기 조건 — 파라미터 2개: machine, machine ('ALL'이면 전체) */
    public static final String MACHINE_COND = " AND (? = 'ALL' OR BIC_ZMACHINE = ?)";

    /** YYYYMM 전월 */
    public static String prevYm(String ym) {
        int y = Integer.parseInt(ym.substring(0, 4)), m = Integer.parseInt(ym.substring(4, 6));
        return m == 1 ? (y - 1) + "12" : y + String.format("%02d", m - 1);
    }

    public static void validateYm(String ym) {
        if (ym == null || !ym.matches("\\d{6}")) throw new IllegalArgumentException("기준월(YYYYMM)을 확인하세요: " + ym);
        int m = Integer.parseInt(ym.substring(4, 6));
        if (m < 1 || m > 12) throw new IllegalArgumentException("기준월(YYYYMM)을 확인하세요: " + ym);
    }
}
