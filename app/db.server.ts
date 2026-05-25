import Database from "better-sqlite3";

// 메모리 기반 SQLite 데이터베이스를 생성합니다.
// 실제 파일로 저장하려면 ':memory:' 대신 'app.db' 처럼 파일 경로를 입력하세요.
// const db = new Database(":memory:");
const db = new Database("appdata.db");

// 테스트용 users 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    role TEXT
  );
`);

// 데이터가 없으면 초기 샘플 데이터를 넣습니다.
const stmt = db.prepare("SELECT COUNT(*) AS count FROM users");
const result = stmt.get() as { count: number };

if (result.count === 0) {
    const insert = db.prepare("INSERT INTO users (name, role) VALUES (?, ?)");
    insert.run("Alice", "Admin");
    insert.run("Bob", "User");
    insert.run("Charlie", "Guest");
}

export default db;
