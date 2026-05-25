import Database from "better-sqlite3";

// const db = new Database(":memory:");
const db = new Database("appdata.db");

// 외래키(Foreign Key) 제약 조건을 활성화합니다. (SQLite는 기본적으로 꺼져있으므로 필수입니다)
db.pragma("foreign_keys = ON");

// 1. AM 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS ams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- 이름
    position TEXT, -- 직책
    job_type TEXT, -- 직종
    email TEXT, -- 이메일
    phone TEXT, -- 연락처
    assigned_clients TEXT -- 담당 고객사들 (JSON 배열 텍스트로 저장)
  );
`);

// 2. 파트너 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, -- 이름
    grade TEXT -- 등급
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

// 4. 제품 테이블 생성 (제품코드를 고유 식별자로 사용)
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    code TEXT PRIMARY KEY, -- 제품코드 (고유값)
    description TEXT,
    lpd REAL, -- LP 달러(가격, 소수점이 있을 수 있으므로 REAL 사용)
    lpw REAL -- LP 원화
  );
`);

// 프로젝트(견적관리)를 위한 quotes 테이블 생성
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
    products TEXT, -- 제품 정보 (JSON 배열 문자열로 저장)
    created_at INTEGER, -- 기입날짜 (Unix timestamp 등)
    updated_at INTEGER, -- 마지막수정날짜 (Unix timestamp 등)
    am_id INTEGER, -- AM 테이블 연결 id
    contract_type TEXT, -- 계약방식
    deal_flow TEXT, -- dealflow
    expected_quarter TEXT, -- 예상 분기
    stage INTEGER, -- 단계
    note TEXT, -- 비고
    
    -- 외래키(Foreign Key) 지정으로 데이터 무결성을 보장합니다.
    FOREIGN KEY (partner_id) REFERENCES partners(id),
    FOREIGN KEY (partner_contact_id) REFERENCES partner_contacts(id),
    FOREIGN KEY (am_id) REFERENCES ams(id)
  );
`);

// 데이터가 없으면 초기 샘플 데이터를 넣습니다.
db.transaction(() => {
    const amCount = db.prepare("SELECT COUNT(*) AS count FROM ams").get() as {
        count: number;
    };
    if (amCount.count === 0) {
        const insert = db.prepare(
            "INSERT INTO ams (name, position, job_type, email, phone) VALUES (?, ?, ?, ?, ?)",
        );
        insert.run(
            "테스트AM",
            "차장",
            "영업",
            "st.te@example.com",
            "010-1111-2222",
        );
    }

    const partnerCount = db
        .prepare("SELECT COUNT(*) AS count FROM partners")
        .get() as { count: number };
    if (partnerCount.count === 0) {
        const insert = db.prepare(
            "INSERT INTO partners (name, grade) VALUES (?, ?)",
        );
        insert.run("테스트파트너", "pinacle");
    }

    const partnerContactCount = db
        .prepare("SELECT COUNT(*) AS count FROM partner_contacts")
        .get() as { count: number };
    if (partnerContactCount.count === 0) {
        const insert = db.prepare(
            "INSERT INTO partner_contacts (partner_id, name, position, email, phone) VALUES (?, ?, ?, ?, ?)",
        );
        insert.run(
            1,
            "테스트파트너담당자",
            "과장",
            "st.te@example.com",
            "010-3333-4444",
        );
    }

    const productCount = db
        .prepare("SELECT COUNT(*) AS count FROM products")
        .get() as { count: number };
    if (productCount.count === 0) {
        const insert = db.prepare(
            "INSERT INTO products (code, description, lpd, lpw) VALUES (?, ?, ?, ?)",
        );
        insert.run("VCF-CLD-TEST", "test license", 1000, 3000000);
    }

    const quoteCount = db
        .prepare("SELECT COUNT(*) AS count FROM quotes")
        .get() as { count: number };
    if (quoteCount.count === 0) {
        const insert = db.prepare(`
            INSERT INTO quotes (
                client_company, client_contact_name, client_contact_email, client_contact_phone,
                partner_id, partner_contact_id, project_name, products,
                created_at, updated_at, am_id, contract_type, deal_flow, expected_quarter, stage, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        // JSON 형식으로 들어갈 제품 목록 데이터 생성
        const sampleProducts = JSON.stringify([
            {
                제품코드: "VCF-CLD-TEST",
                수량: 100,
                기간: 1,
                달러원가: 1000,
                DC달러: 50,
                달러net: 500,
                환율: 1500,
                원화net: 750000,
                DC원화: 50,
                소비자가: 3000000,
                PPC: 15000,
                공급가: 1500000,
                마진: 750000,
                년차: 1,
                재견적: 0,
            },
            {
                제품코드: "VCF-CLD-TEST",
                수량: 100,
                기간: 3,
                달러원가: 3000,
                DC달러: 50,
                달러net: 1500,
                환율: 1500,
                원화net: 2250000,
                DC원화: 50,
                소비자가: 9000000,
                PPC: 15000,
                공급가: 4500000,
                마진: 2250000,
                년차: 1,
                재견적: 0,
            },
        ]);

        const dealflow = JSON.stringify(["파트너사", "고객사"]);
        const note = JSON.stringify(["nutanix 비딩"]);
        // Unix 타임스탬프 (밀리초 단위의 정수)
        const now = Date.now();

        insert.run(
            "테스트고객사",
            "테스트고객사담당자",
            "st.te@example.com",
            "010-55555-6666",
            1,
            1,
            "차세대인프라",
            sampleProducts, // JSON.stringify()로 변환된 문자열
            now, // created_at
            now, // updated_at
            1,
            "일반경쟁",
            dealflow,
            "FY26Q3",
            2,
            note,
        );
    }
})();

export default db;
