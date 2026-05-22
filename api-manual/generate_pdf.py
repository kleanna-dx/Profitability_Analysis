#!/usr/bin/env python3
"""
Profitability Analysis - User Management API Manual PDF Generator
"""
import os
from fpdf import FPDF

# Paths
IMAGES_DIR = os.path.join(os.path.dirname(__file__), 'images')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), 'Profitability_Analysis_User_API_Manual.pdf')

# Fonts
FONT_REGULAR = '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
FONT_BOLD = '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'
FONT_CODE = '/usr/share/fonts/truetype/nanum/NanumGothicCoding.ttf'
FONT_CODE_BOLD = '/usr/share/fonts/truetype/nanum/NanumGothicCodingBold.ttf'

# Colors
BLUE = (41, 98, 255)
DARK_BLUE = (25, 60, 160)
LIGHT_BLUE = (230, 240, 255)
WHITE = (255, 255, 255)
BLACK = (30, 30, 30)
GRAY = (100, 100, 100)
LIGHT_GRAY = (245, 245, 245)
TABLE_HEADER_BG = (41, 98, 255)
TABLE_ROW_ALT = (248, 250, 255)
GREEN = (34, 139, 34)
RED = (220, 50, 50)
ORANGE = (255, 140, 0)
YELLOW_BG = (255, 250, 230)
METHOD_POST = (73, 160, 73)
METHOD_PUT = (230, 150, 30)
METHOD_DELETE = (220, 60, 60)
METHOD_GET = (41, 98, 255)


class APIPdf(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'A4')
        self.add_font('NanumGothic', '', FONT_REGULAR)
        self.add_font('NanumGothic', 'B', FONT_BOLD)
        self.add_font('NanumCode', '', FONT_CODE)
        self.add_font('NanumCode', 'B', FONT_CODE_BOLD)
        self.set_auto_page_break(True, margin=20)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font('NanumGothic', 'B', 8)
        self.set_text_color(*GRAY)
        self.cell(0, 6, 'Profitability Analysis - User Management API Manual', align='L')
        self.cell(0, 6, f'Page {self.page_no()}', align='R', new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*BLUE)
        self.set_line_width(0.3)
        self.line(10, 12, 200, 12)
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font('NanumGothic', '', 7)
        self.set_text_color(*GRAY)
        self.cell(0, 10, 'Confidential - Kleannara DX', align='C')

    def cover_page(self):
        self.add_page()
        # Blue gradient band
        for i in range(80):
            r = int(25 + (41 - 25) * i / 80)
            g = int(40 + (98 - 40) * i / 80)
            b = int(120 + (255 - 120) * i / 80)
            self.set_fill_color(r, g, b)
            self.rect(0, 50 + i * 0.8, 210, 0.9, 'F')

        self.set_y(60)
        self.set_font('NanumGothic', 'B', 28)
        self.set_text_color(*WHITE)
        self.cell(0, 15, 'User Management API', align='C', new_x="LMARGIN", new_y="NEXT")
        self.set_font('NanumGothic', 'B', 22)
        self.cell(0, 12, 'Manual', align='C', new_x="LMARGIN", new_y="NEXT")

        self.ln(8)
        self.set_font('NanumGothic', '', 13)
        self.cell(0, 10, 'Profitability Analysis System', align='C', new_x="LMARGIN", new_y="NEXT")

        self.set_y(145)
        self.set_text_color(*BLACK)
        self.set_font('NanumGothic', '', 11)
        info = [
            ('Version', 'v1.0'),
            ('Date', '2026-05-21'),
            ('Author', 'Kleannara DX Team'),
            ('Audience', 'Groupware Integration Team'),
        ]
        for label, val in info:
            self.set_font('NanumGothic', 'B', 11)
            self.cell(60, 9, label, align='R')
            self.set_font('NanumGothic', '', 11)
            self.cell(10, 9, ':')
            self.cell(0, 9, val, new_x="LMARGIN", new_y="NEXT")

    def section_title(self, num, title):
        self.ln(4)
        self.set_fill_color(*BLUE)
        self.set_text_color(*WHITE)
        self.set_font('NanumGothic', 'B', 15)
        self.cell(0, 11, f'  {num}. {title}', fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        self.set_text_color(*BLACK)

    def sub_title(self, text):
        self.ln(2)
        self.set_font('NanumGothic', 'B', 12)
        self.set_text_color(*DARK_BLUE)
        self.cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(*BLACK)
        self.ln(1)

    def body_text(self, text):
        self.set_font('NanumGothic', '', 10)
        self.set_text_color(*BLACK)
        self.multi_cell(0, 6, text)
        self.ln(1)

    def code_block(self, text):
        self.set_fill_color(40, 44, 52)
        self.set_text_color(220, 220, 220)
        self.set_font('NanumCode', '', 9)
        x = self.get_x()
        y = self.get_y()
        lines = text.strip().split('\n')
        h = len(lines) * 5.2 + 6
        if y + h > 275:
            self.add_page()
            y = self.get_y()
        self.rect(10, y, 190, h, 'F')
        self.set_xy(13, y + 3)
        for line in lines:
            self.cell(0, 5.2, line, new_x="LMARGIN", new_y="NEXT")
            self.set_x(13)
        self.set_y(y + h + 2)
        self.set_text_color(*BLACK)

    def method_badge(self, method, url):
        colors = {
            'GET': METHOD_GET,
            'POST': METHOD_POST,
            'PUT': METHOD_PUT,
            'DELETE': METHOD_DELETE,
        }
        color = colors.get(method, BLUE)
        self.set_fill_color(*color)
        self.set_text_color(*WHITE)
        self.set_font('NanumCode', 'B', 11)
        w = self.get_string_width(f' {method} ') + 6
        self.cell(w, 8, f' {method} ', fill=True)
        self.set_text_color(*BLACK)
        self.set_font('NanumCode', '', 10)
        self.cell(0, 8, f'  {url}', new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def table(self, headers, rows, col_widths=None):
        if col_widths is None:
            col_widths = [190 / len(headers)] * len(headers)

        # Check if table fits, otherwise add page
        needed = 8 + len(rows) * 7
        if self.get_y() + needed > 270:
            self.add_page()

        # Header
        self.set_fill_color(*TABLE_HEADER_BG)
        self.set_text_color(*WHITE)
        self.set_font('NanumGothic', 'B', 9)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 8, f' {h}', border=1, fill=True)
        self.ln()

        # Rows
        self.set_text_color(*BLACK)
        self.set_font('NanumGothic', '', 9)
        for idx, row in enumerate(rows):
            if idx % 2 == 1:
                self.set_fill_color(*TABLE_ROW_ALT)
            else:
                self.set_fill_color(*WHITE)
            for i, cell in enumerate(row):
                self.cell(col_widths[i], 7, f' {cell}', border=1, fill=True)
            self.ln()
        self.ln(2)

    def note_box(self, text, color=BLUE):
        y = self.get_y()
        if y + 15 > 270:
            self.add_page()
            y = self.get_y()
        self.set_fill_color(color[0], color[1], color[2])
        self.rect(10, y, 3, 14, 'F')
        self.set_fill_color(245, 248, 255)
        self.rect(13, y, 187, 14, 'F')
        self.set_xy(16, y + 2)
        self.set_font('NanumGothic', '', 9)
        self.set_text_color(60, 60, 60)
        self.multi_cell(180, 5, text)
        self.set_y(y + 16)
        self.set_text_color(*BLACK)

    def add_image_safe(self, path, w=170):
        if self.get_y() + 80 > 270:
            self.add_page()
        x = (210 - w) / 2
        self.image(path, x=x, w=w)
        self.ln(3)


def build_pdf():
    pdf = APIPdf()

    # ==================== COVER ====================
    pdf.cover_page()

    # ==================== TOC ====================
    pdf.add_page()
    pdf.section_title('', 'Table of Contents')
    pdf.ln(3)
    toc = [
        ('1', 'Overview (개요)', '3'),
        ('2', 'Authentication (인증)', '3'),
        ('3', 'API Endpoint Summary (API 목록)', '4'),
        ('4', 'API 1: Get All Users (전체 사용자 조회)', '5'),
        ('5', 'API 2: Get Single User (개별 사용자 조회)', '7'),
        ('6', 'API 3: Bulk Create Users (대량 사용자 생성)', '9'),
        ('7', 'API 4: Bulk Update Users (대량 사용자 수정)', '11'),
        ('8', 'API 5: Bulk Delete Users (대량 사용자 비활성화)', '13'),
        ('9', 'Common Response Codes (공통 응답 코드)', '15'),
        ('10', 'Data Model (데이터 모델)', '15'),
    ]
    for num, title, page in toc:
        pdf.set_font('NanumGothic', 'B' if num else '', 11)
        pdf.cell(15, 8, num)
        pdf.cell(145, 8, title)
        pdf.set_font('NanumGothic', '', 11)
        pdf.cell(20, 8, page, align='R', new_x="LMARGIN", new_y="NEXT")

    # ==================== 1. OVERVIEW ====================
    pdf.add_page()
    pdf.section_title('1', 'Overview (개요)')
    pdf.body_text(
        'Profitability Analysis 시스템의 사용자 관리 API입니다.\n'
        '그룹웨어 시스템에서 사용자 정보를 동기화하기 위한 CRUD API를 제공합니다.\n'
        '모든 API는 RESTful 방식으로 설계되었으며, JSON 형식으로 데이터를 주고받습니다.'
    )

    pdf.sub_title('Base URL')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai')

    pdf.sub_title('API Endpoints')
    pdf.code_block(
        'GET    /api/users          # 전체 사용자 조회\n'
        'GET    /api/users/:userId  # 개별 사용자 조회\n'
        'POST   /api/users/bulk     # 대량 사용자 생성\n'
        'PUT    /api/users/bulk     # 대량 사용자 수정\n'
        'DELETE /api/users/bulk     # 대량 사용자 비활성화'
    )
    pdf.note_box(
        'NOTE: 생성(POST), 수정(PUT), 삭제(DELETE) 3개 API는 동일한 URL(/api/users/bulk)을 사용합니다.\n'
        'HTTP Method(POST/PUT/DELETE)로 구분하므로, 반드시 올바른 Method를 사용해 주세요.'
    )

    # ==================== 2. AUTHENTICATION ====================
    pdf.section_title('2', 'Authentication (인증)')
    pdf.body_text(
        '모든 사용자 관리 API는 API Key 인증이 필요합니다.\n'
        'HTTP 요청 헤더에 아래와 같이 API Key를 포함해야 합니다.'
    )
    pdf.sub_title('Required Headers')
    pdf.table(
        ['Header', 'Value', 'Description'],
        [
            ['Content-Type', 'application/json', '요청 데이터 형식'],
            ['X-API-KEY', 'gw-kleannara-2026-secure-api-key', 'API 인증 키'],
        ],
        [45, 80, 65]
    )
    pdf.note_box('API Key가 없거나 잘못된 경우 401 Unauthorized 에러가 반환됩니다.')

    pdf.sub_title('인증 실패 응답 예시')
    pdf.code_block(
        '{\n'
        '    "success": false,\n'
        '    "error": "API Key가 유효하지 않습니다.",\n'
        '    "code": "INVALID_API_KEY"\n'
        '}'
    )

    # ==================== 3. API SUMMARY ====================
    pdf.add_page()
    pdf.section_title('3', 'API Endpoint Summary (API 목록)')
    pdf.ln(2)
    pdf.table(
        ['#', 'Method', 'URL', 'Description'],
        [
            ['1', 'GET', '/api/users', '전체 사용자 조회 (페이지네이션, 필터)'],
            ['2', 'GET', '/api/users/:userId', '개별 사용자 조회'],
            ['3', 'POST', '/api/users/bulk', '대량 사용자 생성 (등록)'],
            ['4', 'PUT', '/api/users/bulk', '대량 사용자 수정'],
            ['5', 'DELETE', '/api/users/bulk', '대량 사용자 비활성화 (삭제)'],
        ],
        [10, 20, 70, 90]
    )

    pdf.ln(2)
    pdf.sub_title('URL 구분 요약')
    pdf.body_text(
        '- 조회: /api/users (GET) 또는 /api/users/:userId (GET)\n'
        '- 생성/수정/삭제: /api/users/bulk (POST / PUT / DELETE)\n'
        '\n'
        '동일 URL, 다른 HTTP Method:'
    )
    pdf.table(
        ['HTTP Method', 'URL', 'Action'],
        [
            ['POST', '/api/users/bulk', '생성 (Create)'],
            ['PUT', '/api/users/bulk', '수정 (Update)'],
            ['DELETE', '/api/users/bulk', '비활성화 (Soft Delete)'],
        ],
        [35, 80, 75]
    )

    # ==================== 4. GET ALL USERS ====================
    pdf.add_page()
    pdf.section_title('4', 'API 1: Get All Users (전체 사용자 조회)')
    pdf.method_badge('GET', '/api/users')

    pdf.sub_title('Full URL')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai/api/users?page=1&limit=500')

    pdf.sub_title('Query Parameters')
    pdf.table(
        ['Parameter', 'Type', 'Default', 'Description'],
        [
            ['page', 'number', '1', '페이지 번호 (1부터)'],
            ['limit', 'number', '50', '페이지당 건수 (최소 1, 최대 500)'],
            ['is_active', 'number', '-', '활성 상태 필터 (1=활성, 0=비활성)'],
            ['role', 'string', '-', '권한 필터 (admin, user, viewer)'],
            ['department', 'string', '-', '부서 필터 (정확 일치)'],
            ['search', 'string', '-', '검색 (user_id, name, email 부분 일치)'],
        ],
        [30, 20, 20, 120]
    )

    # Screenshot: Query Parameters table
    pdf.sub_title('Query Parameters 참고')
    pdf.add_image_safe(os.path.join(IMAGES_DIR, 'img1_query_params.png'), w=150)

    pdf.sub_title('Response Body')
    pdf.code_block(
        '{\n'
        '    "success": true,\n'
        '    "data": [\n'
        '        {\n'
        '            "id": 1,\n'
        '            "user_id": "admin",\n'
        '            "name": "관리자",\n'
        '            "email": null,\n'
        '            "department": null,\n'
        '            "phone": null,\n'
        '            "position": null,\n'
        '            "role": "admin",\n'
        '            "is_active": 1,\n'
        '            "sso_yn": 0,\n'
        '            "created_at": "2026-05-20T07:09:57.000Z",\n'
        '            "updated_at": "2026-05-20T08:24:32.000Z"\n'
        '        },\n'
        '        ...\n'
        '    ],\n'
        '    "pagination": {\n'
        '        "page": 1,\n'
        '        "limit": 500,\n'
        '        "totalCount": 8,\n'
        '        "totalPages": 1\n'
        '    }\n'
        '}'
    )

    # Screenshot: GET all users
    pdf.sub_title('Postman Request Example (전체 사용자 조회)')
    pdf.add_image_safe(os.path.join(IMAGES_DIR, 'img2_get_all_users.png'), w=160)

    # ==================== 5. GET SINGLE USER ====================
    pdf.add_page()
    pdf.section_title('5', 'API 2: Get Single User (개별 사용자 조회)')
    pdf.method_badge('GET', '/api/users/:userId')

    pdf.sub_title('Full URL Example')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai/api/users/djseo')

    pdf.sub_title('Path Parameter')
    pdf.table(
        ['Parameter', 'Type', 'Required', 'Description'],
        [
            ['userId', 'string', 'Yes', '조회할 사용자 ID (예: djseo, admin)'],
        ],
        [30, 20, 20, 120]
    )

    pdf.sub_title('Response Body (Success)')
    pdf.code_block(
        '{\n'
        '    "success": true,\n'
        '    "data": {\n'
        '        "id": 3,\n'
        '        "user_id": "djseo",\n'
        '        "name": "서동준",\n'
        '        "email": "djseo@kleannara.com",\n'
        '        "department": "경영기획팀",\n'
        '        "phone": "010-1234-5678",\n'
        '        "position": "차장",\n'
        '        "role": "user",\n'
        '        "is_active": 1,\n'
        '        "sso_yn": 1,\n'
        '        "created_at": "2026-05-20T07:18:04.000Z",\n'
        '        "updated_at": "2026-05-20T07:18:20.000Z"\n'
        '    }\n'
        '}'
    )

    pdf.sub_title('Response Body (Not Found)')
    pdf.code_block(
        '{\n'
        '    "success": false,\n'
        '    "error": "사용자를 찾을 수 없습니다.",\n'
        '    "userId": "unknown_user"\n'
        '}'
    )

    # Screenshot: GET single user
    pdf.sub_title('Postman Request Example (개별 사용자 조회)')
    pdf.add_image_safe(os.path.join(IMAGES_DIR, 'img3_get_single_user.png'), w=160)

    # ==================== 6. POST BULK CREATE ====================
    pdf.add_page()
    pdf.section_title('6', 'API 3: Bulk Create Users (대량 사용자 생성)')
    pdf.method_badge('POST', '/api/users/bulk')

    pdf.sub_title('Full URL')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai/api/users/bulk')

    pdf.sub_title('Request Body')
    pdf.table(
        ['Field', 'Type', 'Required', 'Description'],
        [
            ['users', 'array', 'Yes', '생성할 사용자 목록 (배열)'],
            ['users[].userId', 'string', 'Yes', '사용자 ID (로그인 아이디)'],
            ['users[].name', 'string', 'Yes', '사용자 이름'],
            ['users[].password', 'string', 'Yes', '비밀번호'],
            ['users[].email', 'string', 'No', '이메일'],
            ['users[].department', 'string', 'No', '부서'],
            ['users[].phone', 'string', 'No', '연락처'],
            ['users[].position', 'string', 'No', '직급'],
            ['users[].role', 'string', 'No', '권한 (admin/user/viewer, 기본: user)'],
            ['users[].sso_yn', 'number', 'No', 'SSO 연동 여부 (0/1, 기본: 0)'],
        ],
        [38, 18, 18, 116]
    )

    pdf.sub_title('Request Body Example')
    pdf.code_block(
        '{\n'
        '    "users": [\n'
        '        {\n'
        '            "userId": "testuser1",\n'
        '            "name": "테스트유저1",\n'
        '            "password": "test1234!",\n'
        '            "department": "개발팀",\n'
        '            "position": "사원",\n'
        '            "role": "user"\n'
        '        },\n'
        '        {\n'
        '            "userId": "testuser2",\n'
        '            "name": "테스트유저2",\n'
        '            "password": "test1234!",\n'
        '            "department": "기획팀",\n'
        '            "email": "test2@kleannara.com",\n'
        '            "role": "viewer"\n'
        '        }\n'
        '    ]\n'
        '}'
    )

    pdf.sub_title('Response Body')
    pdf.code_block(
        '{\n'
        '    "success": true,\n'
        '    "totalCount": 2,\n'
        '    "successCount": 2,\n'
        '    "failCount": 0,\n'
        '    "results": [\n'
        '        { "userId": "testuser1", "status": "success", "message": "created" },\n'
        '        { "userId": "testuser2", "status": "success", "message": "created" }\n'
        '    ]\n'
        '}'
    )

    pdf.note_box(
        'NOTE: 이미 비활성화된(is_active=0) 동일 userId가 존재하면 자동으로 재활성화(reactivated)됩니다.\n'
        '이미 활성화된 동일 userId가 존재하면 실패(already exists)로 처리됩니다.'
    )

    # ==================== 7. PUT BULK UPDATE ====================
    pdf.add_page()
    pdf.section_title('7', 'API 4: Bulk Update Users (대량 사용자 수정)')
    pdf.method_badge('PUT', '/api/users/bulk')

    pdf.sub_title('Full URL')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai/api/users/bulk')

    pdf.sub_title('Request Body')
    pdf.table(
        ['Field', 'Type', 'Required', 'Description'],
        [
            ['users', 'array', 'Yes', '수정할 사용자 목록 (배열)'],
            ['users[].userId', 'string', 'Yes', '수정 대상 사용자 ID (필수)'],
            ['users[].name', 'string', 'No', '변경할 이름'],
            ['users[].password', 'string', 'No', '변경할 비밀번호'],
            ['users[].email', 'string', 'No', '변경할 이메일'],
            ['users[].department', 'string', 'No', '변경할 부서'],
            ['users[].phone', 'string', 'No', '변경할 연락처'],
            ['users[].position', 'string', 'No', '변경할 직급'],
            ['users[].role', 'string', 'No', '변경할 권한 (admin/user/viewer)'],
            ['users[].is_active', 'number', 'No', '활성 상태 변경 (1=활성, 0=비활성)'],
            ['users[].sso_yn', 'number', 'No', 'SSO 연동 여부 변경 (0/1)'],
        ],
        [38, 18, 18, 116]
    )

    pdf.note_box(
        'NOTE: userId는 수정 대상을 식별하는 필수 키이며, 나머지 필드는 변경하고 싶은 항목만 전달하면 됩니다.\n'
        '전달하지 않은 필드는 기존 값이 유지됩니다.'
    )

    pdf.sub_title('Request Body Example')
    pdf.code_block(
        '{\n'
        '    "users": [\n'
        '        {\n'
        '            "userId": "jswon",\n'
        '            "name": "원쏜"\n'
        '        },\n'
        '        {\n'
        '            "userId": "djseo",\n'
        '            "name": "서대진"\n'
        '        }\n'
        '    ]\n'
        '}'
    )

    pdf.sub_title('Response Body')
    pdf.code_block(
        '{\n'
        '    "success": true,\n'
        '    "totalCount": 2,\n'
        '    "successCount": 2,\n'
        '    "failCount": 0,\n'
        '    "results": [\n'
        '        { "userId": "jswon", "status": "success", "message": "updated" },\n'
        '        { "userId": "djseo", "status": "success", "message": "updated" }\n'
        '    ]\n'
        '}'
    )

    # Screenshot: PUT update
    pdf.sub_title('Postman Request Example (사용자 수정)')
    pdf.add_image_safe(os.path.join(IMAGES_DIR, 'img4_put_update.png'), w=160)

    # ==================== 8. DELETE BULK ====================
    pdf.add_page()
    pdf.section_title('8', 'API 5: Bulk Delete Users (대량 사용자 비활성화)')
    pdf.method_badge('DELETE', '/api/users/bulk')

    pdf.sub_title('Full URL')
    pdf.code_block('https://3000-i4uffs666lw2u0w31ha6d-b9b802c4.sandbox.novita.ai/api/users/bulk')

    pdf.note_box(
        'IMPORTANT: 이 API는 실제 데이터를 삭제하지 않습니다. (Soft Delete)\n'
        'is_active 값을 1 -> 0 으로 변경하여 비활성화합니다.\n'
        '비활성화된 사용자는 로그인이 불가하며, PUT API로 is_active: 1 설정 시 복구 가능합니다.',
    )

    pdf.sub_title('Request Body')
    pdf.table(
        ['Field', 'Type', 'Required', 'Description'],
        [
            ['userIds', 'array', 'Yes', '비활성화할 사용자 ID 목록 (문자열 배열)'],
        ],
        [30, 20, 20, 120]
    )

    pdf.sub_title('Request Body Example')
    pdf.code_block(
        '{\n'
        '    "userIds": ["testuser1"]\n'
        '}'
    )

    pdf.sub_title('Response Body')
    pdf.code_block(
        '{\n'
        '    "success": true,\n'
        '    "totalCount": 1,\n'
        '    "successCount": 1,\n'
        '    "failCount": 0,\n'
        '    "results": [\n'
        '        { "userId": "testuser1", "status": "success", "message": "deactivated" }\n'
        '    ]\n'
        '}'
    )

    # Screenshot: DELETE
    pdf.sub_title('Postman Request Example (사용자 비활성화)')
    pdf.add_image_safe(os.path.join(IMAGES_DIR, 'img5_delete.png'), w=160)

    pdf.ln(4)
    pdf.sub_title('비활성화 후 복구 방법')
    pdf.body_text('PUT /api/users/bulk 으로 is_active: 1 을 전달하면 복구됩니다:')
    pdf.code_block(
        'PUT /api/users/bulk\n'
        '{\n'
        '    "users": [\n'
        '        { "userId": "testuser1", "is_active": 1 }\n'
        '    ]\n'
        '}'
    )

    # ==================== 9. RESPONSE CODES ====================
    pdf.add_page()
    pdf.section_title('9', 'Common Response Codes (공통 응답 코드)')
    pdf.table(
        ['HTTP Code', 'Status', 'Description'],
        [
            ['200', 'OK', '요청 성공'],
            ['400', 'Bad Request', '잘못된 요청 (필수 필드 누락 등)'],
            ['401', 'Unauthorized', 'API Key 인증 실패'],
            ['404', 'Not Found', '사용자를 찾을 수 없음'],
            ['500', 'Internal Server Error', '서버 내부 오류'],
        ],
        [30, 40, 120]
    )

    pdf.sub_title('공통 에러 응답 형식')
    pdf.code_block(
        '{\n'
        '    "success": false,\n'
        '    "error": "에러 메시지 (한국어)",\n'
        '    "code": "ERROR_CODE"           // 일부 에러에만 포함\n'
        '}'
    )

    # ==================== 10. DATA MODEL ====================
    pdf.section_title('10', 'Data Model (데이터 모델)')
    pdf.sub_title('Users Table Schema')
    pdf.table(
        ['Column', 'Type', 'Nullable', 'Description'],
        [
            ['id', 'INT (AUTO)', 'No', '자동 증가 PK'],
            ['user_id', 'VARCHAR(50)', 'No', '로그인 아이디 (UNIQUE)'],
            ['password', 'VARCHAR(255)', 'Yes', '비밀번호 (SSO 유저는 NULL)'],
            ['name', 'VARCHAR(100)', 'No', '사용자 이름'],
            ['email', 'VARCHAR(150)', 'Yes', '이메일'],
            ['department', 'VARCHAR(100)', 'Yes', '부서'],
            ['phone', 'VARCHAR(20)', 'Yes', '연락처'],
            ['position', 'VARCHAR(50)', 'Yes', '직급'],
            ['role', 'ENUM', 'No', 'admin / user / viewer (기본: user)'],
            ['is_active', 'TINYINT', 'No', '1=활성, 0=비활성 (기본: 1)'],
            ['sso_yn', 'TINYINT', 'No', '1=SSO, 0=일반 (기본: 0)'],
            ['created_at', 'DATETIME', 'No', '생성 시각 (자동)'],
            ['updated_at', 'DATETIME', 'No', '수정 시각 (자동)'],
        ],
        [32, 35, 20, 103]
    )

    # ==================== OUTPUT ====================
    pdf.output(OUTPUT_PATH)
    print(f'PDF generated: {OUTPUT_PATH}')
    print(f'File size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB')


if __name__ == '__main__':
    build_pdf()
