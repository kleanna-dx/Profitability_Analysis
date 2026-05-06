#!/usr/bin/env python3
"""
PPT Report CLI - Node.js에서 child_process로 호출하는 래퍼
사용법:
  python3 report_cli.py months                    → 사용 가능한 월 목록 (JSON)
  python3 report_cli.py preview <calmonth>        → 미리보기 데이터 (JSON)
  python3 report_cli.py generate <calmonth> [prompt] [attachment_path] → PPT 생성 (stdout binary)
  python3 report_cli.py upload-preview <filepath>  → 첨부파일 미리보기 (JSON)
"""
import sys
import json
import decimal
import os

# 현재 디렉토리를 모듈 경로에 추가
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

# .env 파일에서 환경변수 로드 (dotenv 없이 직접 파싱)
def _load_env():
    env_path = os.path.join(script_dir, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, val = line.partition('=')
                key, val = key.strip(), val.strip()
                if not os.environ.get(key):  # 기존 환경변수가 없을 때만 설정
                    os.environ[key] = val

_load_env()

from report_generator import (
    fetch_report_data, get_available_months,
    generate_ppt, generate_ppt_with_prompt,
    _dec, _fmt
)


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super().default(obj)


def cmd_months():
    """사용 가능한 월 목록"""
    months = get_available_months()
    result = []
    for m in months:
        cm = m['CALMONTH']
        result.append({
            "calmonth": cm,
            "label": f"{cm[:4]}년 {int(cm[4:])}월",
            "count": m['cnt']
        })
    print(json.dumps({"months": result}, cls=DecimalEncoder, ensure_ascii=False))


def cmd_preview(calmonth):
    """미리보기 데이터"""
    data = fetch_report_data(calmonth)

    def to_json(obj):
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        if isinstance(obj, dict):
            return {k: to_json(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [to_json(i) for i in obj]
        return obj

    preview = {
        "calmonth": calmonth,
        "total_rows": data['total_rows'],
        "total": to_json(data['total']),
        "by_division": to_json(data['by_division']),
        "by_plant": to_json(data['by_plant']),
        "by_channel": to_json(data['by_channel']),
        "top_products": to_json(data['top_products'][:5]),
        "prev_month": to_json(data['prev_month']),
    }
    print(json.dumps({"success": True, "data": preview}, cls=DecimalEncoder, ensure_ascii=False))


def cmd_generate(calmonth, prompt='', attachment_path=''):
    """PPT 생성 → stdout으로 바이너리 출력"""
    attachment_info = None
    if attachment_path and os.path.exists(attachment_path):
        ext = attachment_path.rsplit('.', 1)[-1].lower()
        attachment_info = {
            "path": attachment_path,
            "original_name": os.path.basename(attachment_path),
            "ext": ext,
        }

    if prompt or attachment_info:
        ppt_buffer = generate_ppt_with_prompt(calmonth, prompt=prompt, attachment_info=attachment_info)
    else:
        ppt_buffer = generate_ppt(calmonth)

    # 바이너리를 stdout으로 출력
    sys.stdout.buffer.write(ppt_buffer.read())
    sys.stdout.buffer.flush()


def cmd_upload_preview(filepath):
    """첨부파일 미리보기"""
    if not os.path.exists(filepath):
        print(json.dumps({"error": "파일을 찾을 수 없습니다."}, ensure_ascii=False))
        return

    ext = filepath.rsplit('.', 1)[-1].lower()
    filename = os.path.basename(filepath)
    result = {"filename": filename, "ext": ext, "type": "unknown"}

    if ext in ('png', 'jpg', 'jpeg', 'gif', 'bmp'):
        import base64
        with open(filepath, 'rb') as f:
            data = f.read()
        b64 = base64.b64encode(data).decode('utf-8')
        mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
        result["type"] = "image"
        result["data_url"] = f"data:{mime};base64,{b64}"
        result["size"] = len(data)

    elif ext in ('xlsx', 'xls'):
        import pandas as pd
        try:
            df = pd.read_excel(filepath, engine='openpyxl' if ext == 'xlsx' else 'xlrd')
            result["type"] = "excel"
            result["columns"] = list(df.columns)
            result["row_count"] = len(df)
            result["rows"] = []
            for _, row in df.head(10).iterrows():
                r = {}
                for col in df.columns:
                    v = row[col]
                    if pd.isna(v):
                        r[str(col)] = None
                    elif isinstance(v, (int, float)):
                        r[str(col)] = v
                    else:
                        r[str(col)] = str(v)
                result["rows"].append(r)
        except Exception as e:
            result["type"] = "excel_error"
            result["error"] = str(e)

    elif ext == 'csv':
        import pandas as pd
        try:
            df = pd.read_csv(filepath)
            result["type"] = "csv"
            result["columns"] = list(df.columns)
            result["row_count"] = len(df)
            result["rows"] = []
            for _, row in df.head(10).iterrows():
                r = {}
                for col in df.columns:
                    v = row[col]
                    if pd.isna(v):
                        r[str(col)] = None
                    elif isinstance(v, (int, float)):
                        r[str(col)] = v
                    else:
                        r[str(col)] = str(v)
                result["rows"].append(r)
        except Exception as e:
            result["type"] = "csv_error"
            result["error"] = str(e)

    elif ext == 'pdf':
        result["type"] = "pdf"
        result["size"] = os.path.getsize(filepath)

    print(json.dumps({"success": True, "preview": result}, cls=DecimalEncoder, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "명령어가 필요합니다: months, preview, generate, upload-preview"}, ensure_ascii=False))
        sys.exit(1)

    cmd = sys.argv[1]

    try:
        if cmd == 'months':
            cmd_months()
        elif cmd == 'preview':
            if len(sys.argv) < 3:
                print(json.dumps({"error": "calmonth 파라미터가 필요합니다."}, ensure_ascii=False))
                sys.exit(1)
            cmd_preview(sys.argv[2])
        elif cmd == 'generate':
            if len(sys.argv) < 3:
                print(json.dumps({"error": "calmonth 파라미터가 필요합니다."}, ensure_ascii=False))
                sys.exit(1)
            calmonth = sys.argv[2]
            prompt = sys.argv[3] if len(sys.argv) > 3 else ''
            attachment = sys.argv[4] if len(sys.argv) > 4 else ''
            cmd_generate(calmonth, prompt, attachment)
        elif cmd == 'upload-preview':
            if len(sys.argv) < 3:
                print(json.dumps({"error": "filepath 파라미터가 필요합니다."}, ensure_ascii=False))
                sys.exit(1)
            cmd_upload_preview(sys.argv[2])
        else:
            print(json.dumps({"error": f"알 수 없는 명령: {cmd}"}, ensure_ascii=False))
            sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
