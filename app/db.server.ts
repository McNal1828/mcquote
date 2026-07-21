import Database from "better-sqlite3";

const db = new Database("appdata.db");

// 외래키(Foreign Key) 제약 조건을 활성화합니다. (SQLite는 기본적으로 꺼져있으므로 필수입니다)
db.pragma("foreign_keys = ON");

// WAL 모드를 끄고 SQLite의 기본 모드(DELETE)로 되돌립니다.
db.pragma("journal_mode = DELETE");

// 1. AM 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS ams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- 이름
    position TEXT, -- 직책
    job_type TEXT, -- 직종
    email TEXT, -- 이메일
    phone TEXT, -- 연락처
    assigned_clients TEXT, -- 담당 고객사들 (JSON 배열 텍스트로 저장)
    vendor TEXT -- 벤더
  );
`);

// 2. 파트너 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- 이름
    grade TEXT, -- 등급
    vendor TEXT, -- 벤더 (Broadcom, Omnissa 쉼표 구분 복수 저장)
    available INTEGER DEFAULT 1 -- 사용 가능 여부 (1: 사용중, 0: 삭제됨)
  );
`);

// 2-2. 환율 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS exchange_rate (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate REAL NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

// 3. 파트너 담당자 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS partner_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER, -- 파트너사 테이블과 연결되는 외래키
    name TEXT, -- 이름
    position TEXT, -- 직책
    job_type TEXT, -- 직종
    email TEXT, -- 이메일
    phone TEXT, -- 연락처
    FOREIGN KEY (partner_id) REFERENCES partners(id)
  );
`);

// 4. 총판 담당자 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS dist_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- 이름
    position TEXT -- 직책
  );
`);

// 5. 제품 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, -- 제품코드 (고유 식별자)
    description TEXT,
    lpd REAL, -- LP 달러
    lpw REAL, -- LP 원화
    vendor TEXT, -- 벤더
    available INTEGER DEFAULT 1 -- 사용 가능 여부 (1: 가능, 0: 불가능/삭제됨)
  );
`);

// 6. 프로젝트(견적관리)를 위한 quotes 테이블 생성
db.exec(` 
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    client_company TEXT, -- 고객사
    client_contact_name TEXT, -- 고객사 담당자명
    client_contact_email TEXT, -- 고객사 담당자 이메일
    client_contact_phone TEXT, -- 고객사 담당자 전화번호
    
    partner_id INTEGER, -- 파트너 테이블 연결 id
    partner_contact_id INTEGER, -- 파트너 담당자 테이블 연결 id
    
    project_name TEXT, -- 사업명
    quote_type INTEGER, -- 계산 기준 (0: PPC, 1: DC/마진)
    created_at INTEGER, -- 기입날짜 (Unix timestamp)
    updated_at INTEGER, -- 마지막수정날짜 (Unix timestamp)
    am_id INTEGER, -- AM 테이블 연결 id
    dist_contact_id INTEGER, -- 총판 담당자 테이블 연결 id
    contract_type TEXT, -- 계약방식
    deal_flow TEXT, -- dealflow
    stage INTEGER DEFAULT 10, -- 단계 (기본값: 10%)
    note TEXT, -- 비고
    is_ordered INTEGER DEFAULT 0, -- 주문 여부
    is_lost INTEGER DEFAULT 0, -- 실주 여부
    products_history TEXT, -- 이력 관리
    
    FOREIGN KEY (partner_id) REFERENCES partners(id),
    FOREIGN KEY (partner_contact_id) REFERENCES partner_contacts(id),
    FOREIGN KEY (am_id) REFERENCES ams(id),
    FOREIGN KEY (dist_contact_id) REFERENCES dist_contacts(id)
  );
`);

// 7. 견적 내 제품 그룹(탭) 정보 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS quote_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    name TEXT NOT NULL, -- 그룹 이름 (예: '원가표1')
    uuid TEXT UNIQUE NOT NULL, -- 클라이언트 식별용 UUID
    "default" INTEGER DEFAULT 0, -- 기본 여부 (1: 기본, 0: 일반)
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  );
`);

// 8. 각 그룹에 속한 견적 라인(품목) 상세 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS quote_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    line_number INTEGER NOT NULL, -- 정렬 순서
    product_id INTEGER, -- 제품 테이블 연결 id
    description TEXT, -- 제품 상세 설명
    lpd REAL DEFAULT 0,
    lpw REAL DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    period INTEGER DEFAULT 1,
    dc_usd REAL DEFAULT 0,
    exchange_rate REAL DEFAULT 0,
    dc_krw REAL DEFAULT 0,
    supply_price REAL DEFAULT 0,
    margin REAL DEFAULT 0,
    margin_rate REAL DEFAULT 0,
    year INTEGER DEFAULT 1, -- 매출년 (기존 년차)
    krw_ppc REAL DEFAULT 0,
    month INTEGER DEFAULT 1, -- 매출월 (1~12)
    stage INTEGER DEFAULT 10, -- 라인별 단계 (기본값: 10%)
    FOREIGN KEY (group_id) REFERENCES quote_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL
  );
`);

// 9. 견적 다중 벤더 매핑 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS quote_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    vendor TEXT NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  );
`);

// 인덱스 생성
db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_groups_quote_id ON quote_groups(quote_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_lines_group_id ON quote_lines(group_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_lines_product_id ON quote_lines(product_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_vendors_quote_id ON quote_vendors(quote_id);`);

export default db;
