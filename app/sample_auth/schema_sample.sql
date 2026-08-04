-- ==============================================================================
-- MCQuote SQLite DB 로그인 사용자(users) 테이블 마이그레이션 샘플 스키마
-- ==============================================================================
-- [설명]
-- 로그인 기능을 적용할 때 SQLite 데이터베이스에 아래 'users' 테이블을 추가합니다.
-- 비밀번호는 절대로 평문(Plaintext)으로 저장하지 않으며, bcryptjs 라이브러리로 해싱된
-- 문자열(password_hash)을 저장합니다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,       -- 로그인 ID (예: admin, john_doe)
    password_hash TEXT NOT NULL,         -- bcrypt로 암호화된 비밀번호 해시
    name TEXT NOT NULL,                  -- 사용자 이름 (예: 홍길동)
    role TEXT DEFAULT 'user',            -- 권한 ('admin': 관리자, 'user': 일반 영업/견적 작성자)
    email TEXT,                          -- 이메일 (선택)
    available INTEGER DEFAULT 1,         -- 계정 활성화 상태 (1: 활성, 0: 차단/비활성)
    create_timestamp INTEGER,            -- 계정 생성 시각 (Date.now())
    del_timestamp INTEGER                -- 계정 삭제/비활성화 시각
);

-- 초기 관리자 계정 테스트용 시드 데이터 (선택)
-- 비밀번호: 'admin1234'를 bcrypt로 해싱한 샘플 문자열: '$2a$10$wE8wYyT.8q... (실제 생성 시 bcrypt.hashSync로 생성)'
-- INSERT INTO users (username, password_hash, name, role, create_timestamp) 
-- VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '관리자', 'admin', 1700000000000);
