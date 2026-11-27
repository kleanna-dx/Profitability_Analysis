package com.company.module.rollingplanningsimulation.support;

import java.math.BigDecimal;
import java.math.MathContext;
import java.util.*;

/**
 * HL 생산량 환산 공통 규칙 (자재 마스터 · 생산계획 · 전력비/에너지비 공통)
 * <ul>
 *   <li>호기명 → 호기코드: ① HL 호기 마스터 코드·이름 ② 사용자 지정 별칭 (가공 3~6호기 → RP3~RP6, 생리대 5·6호기 → SN5·SN6)</li>
 *   <li>기저귀 라인은 전력비·에너지비 대상이 아님 → 계산에서 제외</li>
 *   <li>1EA 중량(kg) = 순중량(기본단위 1개당) × 중량단위 환산 ÷ (기본단위 1개에 든 EA 수)</li>
 * </ul>
 */
public final class HlConversion {
    private HlConversion() {}

    private static final MathContext MC = MathContext.DECIMAL64;

    /** 사용자 지정 호기명 별칭 — norm(호기명) → 호기코드 */
    public static final Map<String, String> MACHINE_ALIAS;
    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("가공3", "RP3");
        m.put("가공4", "RP4");
        m.put("가공5", "RP5");
        m.put("가공6", "RP6");
        m.put("생리대5", "SN5");
        m.put("생리대6", "SN6");
        MACHINE_ALIAS = Collections.unmodifiableMap(m);
    }

    /** 전력비·에너지비 계산에서 빼는 라인 (이름에 포함) */
    public static final String EXCLUDED_KEYWORD = "기저귀";

    /** 공백·'호기' 제거, 소문자 — 예: "가공 3호기" → "가공3" */
    public static String norm(String v) {
        return v == null ? "" : v.replaceAll("\\s+", "").replace("호기", "").toLowerCase(Locale.ROOT);
    }

    public static boolean excluded(String machineName) {
        return machineName != null && norm(machineName).contains(EXCLUDED_KEYWORD);
    }

    /** HL 호기 마스터 [{code, name}] → norm(코드·이름) → 호기코드 */
    public static Map<String, String> unitByNorm(List<Map<String, String>> master) {
        Map<String, String> m = new HashMap<>();
        if (master == null) return m;
        for (Map<String, String> u : master) {
            String code = u.get("code");
            if (code == null || code.isBlank()) continue;
            m.putIfAbsent(norm(code), code);
            String nm = u.get("name");
            if (nm != null && !nm.isBlank()) m.putIfAbsent(norm(nm), code);
        }
        m.remove("");
        return m;
    }

    /** 호기명 → 호기코드. 호기 마스터 우선, 없으면 별칭, 둘 다 없으면 null */
    public static String resolveMachine(String name, Map<String, String> unitByNorm) {
        String n = norm(name);
        if (n.isEmpty()) return null;
        String u = unitByNorm == null ? null : unitByNorm.get(n);
        if (u != null) return u;
        String a = MACHINE_ALIAS.get(n);
        if (a != null) return a;
        // 별칭 대상 코드를 직접 적은 경우 (RP3 · SN5 …)
        for (String code : MACHINE_ALIAS.values()) if (norm(code).equals(n)) return code;
        return null;
    }

    /** 단위 환산 한 칸: 환산수량 환산단위 = 기본수량 기본단위 (예: 30 EA = 1 BAG) */
    public record Conv(BigDecimal convQty, String convUnit, BigDecimal baseQty, String baseUnit) {}

    /** 1EA 중량 계산 결과 — kgPerEa 가 null 이면 issue 에 이유 */
    public record Weight(BigDecimal kgPerEa, BigDecimal eaPerBase, String baseUnit, String issue) {}

    static String up(String v) { return v == null ? null : (v.trim().isEmpty() ? null : v.trim().toUpperCase(Locale.ROOT)); }

    /** 중량단위 → kg 배수. 모르는 단위면 null */
    public static BigDecimal weightFactor(String unit) {
        String u = up(unit);
        if (u == null) return null;
        return switch (u) {
            case "KG", "KGM" -> BigDecimal.ONE;
            case "G", "GRM", "GR" -> new BigDecimal("0.001");
            case "T", "TO", "TON" -> new BigDecimal("1000");
            default -> null;
        };
    }

    /** 기본단위 — 환산 칸 중 처음 나오는 기본단위 */
    public static String baseUnit(List<Conv> convs) {
        if (convs == null) return null;
        for (Conv c : convs) { String b = up(c.baseUnit()); if (b != null) return b; }
        return null;
    }

    public static Weight kgPerEa(BigDecimal netWeight, String weightUnit, List<Conv> convs) {
        String base = baseUnit(convs);
        if (netWeight == null || netWeight.signum() <= 0) return new Weight(null, null, base, "순중량 없음");
        BigDecimal f = weightFactor(weightUnit);
        if (f == null) return new Weight(null, null, base, up(weightUnit) == null ? "중량단위 없음" : "모르는 중량단위: " + weightUnit);
        BigDecimal eaPerBase = null;
        if ("EA".equals(base)) eaPerBase = BigDecimal.ONE;
        else if (convs != null) {
            for (Conv c : convs) {
                if (!"EA".equals(up(c.convUnit()))) continue;
                if (c.convQty() == null || c.convQty().signum() <= 0 || c.baseQty() == null || c.baseQty().signum() <= 0) continue;
                String cb = up(c.baseUnit());
                if (base != null && cb != null && !base.equals(cb)) continue;
                eaPerBase = c.convQty().divide(c.baseQty(), MC);
                break;
            }
        }
        if (eaPerBase == null) return new Weight(null, null, base, "EA 환산 없음" + (base != null ? " (1 " + base + " = ? EA)" : ""));
        return new Weight(netWeight.multiply(f, MC).divide(eaPerBase, MC), eaPerBase, base, null);
    }

    /** 화면 표시용 — "30 EA = 1 BAG · 1 PAL = 128 BAG" (환산단위 = 기본단위인 칸은 생략) */
    public static String convText(List<Conv> convs) {
        List<String> out = new ArrayList<>();
        if (convs != null) for (Conv c : convs) {
            String cu = up(c.convUnit()), bu = up(c.baseUnit());
            if (cu == null || bu == null || c.convQty() == null || c.baseQty() == null || cu.equals(bu)) continue;
            out.add(plain(c.convQty()) + " " + cu + " = " + plain(c.baseQty()) + " " + bu);
        }
        return String.join(" · ", out);
    }

    static String plain(BigDecimal v) { return v.stripTrailingZeros().toPlainString(); }

    /** JDBC 행(CONV_QTY1·CONV_UNIT1·BASE_QTY1·BASE_UNIT1 … 2 · 5) → 환산 칸 */
    public static List<Conv> convsFromRow(Map<String, Object> r) {
        List<Conv> out = new ArrayList<>();
        for (String n : List.of("1", "2", "5"))
            out.add(new Conv(bd(r.get("CONV_QTY" + n)), s(r.get("CONV_UNIT" + n)), bd(r.get("BASE_QTY" + n)), s(r.get("BASE_UNIT" + n))));
        return out;
    }

    public static BigDecimal bd(Object o) {
        if (o == null) return null;
        if (o instanceof BigDecimal b) return b;
        String t = o.toString().replace(",", "").trim();
        if (t.isEmpty()) return null;
        try { return new BigDecimal(t); } catch (NumberFormatException e) { return null; }
    }

    static String s(Object o) { return o == null ? null : o.toString(); }
}
