import fs from "fs";
import path from "path";

// 📂 프로젝트 루트의 'logs' 폴더 경로 정의
const LOGS_DIR = path.join(process.cwd(), "logs");
const LOG_FILE_PATH = path.join(LOGS_DIR, "server.log");

// logs 폴더가 없으면 자동 생성
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * 포맷팅된 로그 메시지를 콘솔 및 파일에 기록합니다.
 */
function writeLog(level: "INFO" | "WARN" | "ERROR", message: string) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;

    // 1. 개발/운영 서버 표준 출력(Stdout/Stderr) 기록
    if (level === "ERROR") {
        console.error(logLine.trim());
    } else if (level === "WARN") {
        console.warn(logLine.trim());
    } else {
        console.log(logLine.trim());
    }

    // 2. logs/server.log 물리 파일에 누적 기록
    try {
        fs.appendFileSync(LOG_FILE_PATH, logLine, "utf8");
    } catch (err) {
        console.error("Failed to write log to file:", err);
    }
}

export const logger = {
    info: (msg: string) => writeLog("INFO", msg),
    warn: (msg: string) => writeLog("WARN", msg),
    error: (msg: string) => writeLog("ERROR", msg),
};
