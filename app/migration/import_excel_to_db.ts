import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/**
 * 📌 [이관 작업 및 CSV status 업데이트 프로세스]
 * 1. partner_name, am_name, dist_contact_name 이 DB(appdata.db)에 모두 존재하는 행만 선택 이관합니다.
 * 2. 이미 `status` 열이 '이관완료' 로 표기된 행은 재실행 시 중복 이관을 자동으로 방지(스킵)합니다.
 * 3. 스크립트 실행 완료 후 해당 CSV 파일의 'status' 열에 바로 이관 결과가 업데이트되어 저장됩니다:
 *    - 이관 성공 시 ➔ '이관완료'
 *    - 건너뜀 발생 시 ➔ '건너뜀 (파트너사 OO DB 미등록)' 등 사유 표기
 * 4. 사용자는 동일한 CSV 파일을 엑셀에서 열어 status 열로 필터링 후, 미등록 항목을 DB에 등록하고
 *    해당 CSV 파일로 그대로 재실행하시면 남은 행만 자동으로 추가 이관됩니다.
 * 
 * 🛠️ 실행 방법:
 * npx tsx app/migration/import_excel_to_db.ts "경로/작성하신파일.csv"
 */
export const DUMMY_CONFIG = {
    PRODUCT_CODE: "SHEET_IMPORT", // 미리 등록해둘 덤미 제품 코드
};

// 한국시간 기준 2025년 1월 1일 00:00:00 KST 의 Unix Timestamp (밀리초)
const FIXED_TIMESTAMP_20250101 = 1735657200000;

// DB 연결
const dbPath = path.join(process.cwd(), "appdata.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

/**
 * CSV 파서
 */
function parseCSV(csvText: string): Record<string, string>[] {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = parseCSVLine(lines[0]);
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const rowValues = parseCSVLine(lines[i]);
        if (rowValues.length === 0) continue;

        const rowData: Record<string, string> = {};
        headers.forEach((header, idx) => {
            rowData[header.trim()] = (rowValues[idx] || "").trim();
        });
        results.push(rowData);
    }
    return results;
}

function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            values.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    values.push(current);
    return values;
}

/**
 * CSV 셀 값 이스케이프 함수
 */
function escapeCSVValue(val: any): string {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * CSV 파일 status 업데이트 저장 함수 (원본 CSV 파일 자체에 overwrite 저장)
 */
function updateCSVFileWithStatus(targetFilePath: string, rows: Record<string, string>[]) {
    if (rows.length === 0) return;

    // 헤더 구성 (기존 헤더 순서 유지 + status 열 보장)
    const sampleKeys = Object.keys(rows[0]);
    const baseHeaders = sampleKeys.filter((k) => k !== "status");
    const finalHeaders = [...baseHeaders, "status"];

    const lines: string[] = [];
    lines.push(finalHeaders.join(","));

    for (const r of rows) {
        const lineValues = finalHeaders.map((h) => escapeCSVValue(r[h] || ""));
        lines.push(lineValues.join(","));
    }

    fs.writeFileSync(targetFilePath, lines.join("\n"), "utf-8");
    console.log(`📄 [CSV status 업데이트 저장 완료] 파일: ${targetFilePath}`);
}

/**
 * DB 검증, 선택적 삽입 및 CSV status 직접 업데이트 마이그레이션 실행 함수
 */
export function runImportFromCSV(filePath?: string) {
    const targetFile = filePath || path.join(process.cwd(), "app/migration/import_template_sample.csv");

    if (!fs.existsSync(targetFile)) {
        console.error(`❌ 파일이 존재하지 않습니다: ${targetFile}`);
        return;
    }

    // 이관용 덤미 제품 ID 획득
    const productRow = db.prepare("SELECT id FROM products WHERE code = ?").get(DUMMY_CONFIG.PRODUCT_CODE) as { id: number } | undefined;
    const productId = productRow ? productRow.id : null;

    if (!productId) {
        console.error(`❌ 덤미 제품(code: '${DUMMY_CONFIG.PRODUCT_CODE}')이 DB에 존재하지 않습니다. 먼저 제품을 등록해주세요.`);
        return;
    }

    console.log(`🚀 [검증 및 선택 이관 마이그레이션 시작] 파일: ${targetFile}`);
    console.log("📌 덤미 제품 ID:", productId);

    const fileContent = fs.readFileSync(targetFile, "utf-8");
    const rows = parseCSV(fileContent);

    let successCount = 0;
    let skippedCount = 0;
    let alreadySuccessCount = 0;

    const insertTransaction = db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];

            // 1. 이미 '이관완료' 로 표기된 행은 중복 이관 방지를 위해 자동 스킵
            if (r.status === "이관완료") {
                alreadySuccessCount++;
                continue;
            }

            const year = Number(r.year) || new Date().getFullYear();
            const month = Number(r.month) || 1;
            const clientCompany = r.client_company || "-";
            const partnerName = r.partner_name || "";
            const amName = r.am_name || "";
            const distContactName = r.dist_contact_name || "";
            const vendorName = r.vendor || "Broadcom";
            const stage = Number(r.stage) || 100;
            const dcUsd = Number(r.dc_usd) || 0;
            const supplyPrice = Number(r.supply_price) || 0;
            const margin = Number(r.margin) || 0;
            const isOrdered = stage >= 99 ? 1 : 0;

            // 🔍 DB 존재 여부 정밀 검증
            const missingReasons: string[] = [];

            let partnerId: number | null = null;
            if (!partnerName) {
                missingReasons.push("파트너사명 공란");
            } else {
                const pRow = db.prepare("SELECT id FROM partners WHERE name = ? AND available = 1").get(partnerName) as { id: number } | undefined;
                if (pRow) partnerId = pRow.id;
                else missingReasons.push(`파트너사 '${partnerName}' DB 미등록`);
            }

            let amId: number | null = null;
            if (!amName) {
                missingReasons.push("AM명 공란");
            } else {
                const aRow = db.prepare("SELECT id FROM ams WHERE name = ?").get(amName) as { id: number } | undefined;
                if (aRow) amId = aRow.id;
                else missingReasons.push(`AM '${amName}' DB 미등록`);
            }

            let distContactId: number | null = null;
            if (!distContactName) {
                missingReasons.push("총판담당자명 공란");
            } else {
                const dRow = db.prepare("SELECT id FROM dist_contacts WHERE name = ?").get(distContactName) as { id: number } | undefined;
                if (dRow) distContactId = dRow.id;
                else missingReasons.push(`총판담당자 '${distContactName}' DB 미등록`);
            }

            // ⚠️ 1개라도 미등록 항목이 존재하면 이관 건너뛰고(Skip) CSV status에 사유 적기
            if (missingReasons.length > 0) {
                skippedCount++;
                r.status = `건너뜀 (${missingReasons.join(" / ")})`;
                continue;
            }

            // ✅ DB에 모두 존재할 때만 안전하게 INSERT 실행!
            // 1. quotes 견적 마스터 레코드 생성
            const quoteResult = db.prepare(`
                INSERT INTO quotes (
                    client_company, client_contact_name, partner_id, partner_contact_id,
                    project_name, quote_type, created_at, updated_at,
                    am_id, dist_contact_id, contract_type, deal_flow, stage, note, is_ordered, is_lost
                ) VALUES (?, '시트이관', ?, NULL, '시트이관', 1, ?, ?, ?, ?, '시트이관', '[]', ?, '[]', ?, 0)
            `).run(
                clientCompany,
                partnerId,
                FIXED_TIMESTAMP_20250101,
                FIXED_TIMESTAMP_20250101,
                amId,
                distContactId,
                stage,
                isOrdered
            );

            const quoteId = Number(quoteResult.lastInsertRowid);

            // 2. quote_vendors 벤더 매핑 생성
            const vendorList = vendorName.split(",").map((v) => v.trim());
            for (const v of vendorList) {
                if (v) {
                    db.prepare("INSERT INTO quote_vendors (quote_id, vendor) VALUES (?, ?)").run(quoteId, v);
                }
            }

            // 3. quote_groups 그룹 생성
            const groupResult = db.prepare(`
                INSERT INTO quote_groups (quote_id, name, uuid, "default")
                VALUES (?, '기본그룹', ?, 1)
            `).run(quoteId, `sheet_group_${quoteId}_${FIXED_TIMESTAMP_20250101}`);

            const groupId = Number(groupResult.lastInsertRowid);

            // 4. quote_lines 제품 라인 생성
            const marginRate = supplyPrice > 0 ? (margin / supplyPrice) * 100 : 0;
            db.prepare(`
                INSERT INTO quote_lines (
                    group_id, line_number, product_id, description,
                    lpd, lpw, quantity, period, dc_usd, exchange_rate, dc_krw,
                    supply_price, margin, margin_rate, year, month, stage, krw_ppc
                ) VALUES (
                    ?, 1, ?, '구글시트 이관 품목',
                    ?, ?, 1, 1, ?, 1400, 0,
                    ?, ?, ?, ?, ?, ?, 0
                )
            `).run(
                groupId,
                productId,
                dcUsd,
                supplyPrice,
                dcUsd,
                supplyPrice,
                margin,
                marginRate,
                year,
                month,
                stage
            );

            // 성공 시 status 업데이트
            successCount++;
            r.status = "이관완료";
        }
    });

    try {
        insertTransaction();
        console.log("\n=======================================================");
        console.log(`🎉 [마이그레이션 이관 완료 리포트]`);
        console.log(`✅ 이번에 새로 이관 완료된 행: ${successCount}건`);
        if (alreadySuccessCount > 0) {
            console.log(`ℹ️ 이전 구동 시 이미 완료되어 중복 방지 스킵된 행: ${alreadySuccessCount}건`);
        }
        console.log(`⚠️ DB 미등록으로 건너뛴(스킵된) 행: ${skippedCount}건`);
        console.log("=======================================================\n");

        // 원본 CSV 파일의 status 열을 직접 업데이트하여 저장
        updateCSVFileWithStatus(targetFile, rows);

        if (skippedCount > 0) {
            console.log(`💡 '${path.basename(targetFile)}' 파일을 엑셀에서 열어 status 열을 확인해보세요.`);
        }
    } catch (err) {
        console.error("❌ 마이그레이션 실행 실패:", err);
    }
}

// 스크립트로 직접 실행 시
if (process.argv[1] && process.argv[1].endsWith("import_excel_to_db.ts")) {
    const customFilePath = process.argv[2];
    runImportFromCSV(customFilePath);
}

// 실행방법: npx tsx app/migration/import_excel_to_db.ts "경로/작성하신파일.csv"
