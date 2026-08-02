import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import path from "path";

async function importPartnerContacts() {
    const dbPath = path.resolve("./appdata.db");
    const excelPath = path.resolve("./public/담당자.xlsx");
    const outputExcelPath = path.resolve("./public/담당자_미입력목록.xlsx");

    console.log(`[Import Script] Connecting to database: ${dbPath}`);
    const db = new Database(dbPath);

    // 1. partners 테이블 사전 로딩 (이름 -> id 매핑)
    const partnerRows = db.prepare("SELECT id, name FROM partners").all() as Array<{ id: number; name: string }>;
    const partnerMap = new Map<string, number>();
    partnerRows.forEach((p) => {
        if (p.name) partnerMap.set(p.name.trim(), p.id);
    });

    console.log(`[Import Script] Loaded ${partnerMap.size} partners from DB.`);

    // 2. partner_contacts 기존 담당자 목록 사전 로딩 (partner_id + name 중복 체크용 및 전체 name 체크용)
    const existingContactRows = db.prepare("SELECT partner_id, name FROM partner_contacts").all() as Array<{ partner_id: number; name: string }>;
    const existingContactSet = new Set<string>();
    const existingNamesSet = new Set<string>();

    existingContactRows.forEach((c) => {
        if (c.name) {
            existingNamesSet.add(c.name.trim());
            existingContactSet.add(`${c.partner_id}_${c.name.trim()}`);
        }
    });

    console.log(`[Import Script] Loaded ${existingContactRows.length} existing contacts from DB.`);

    // 3. 엑셀 파일 로딩
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);
    const worksheet = workbook.worksheets[0];

    const headers: string[] = [];
    worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value?.toString().trim() || "";
    });

    const insertStmt = db.prepare(`
        INSERT INTO partner_contacts (partner_id, name, position, job_type, email, phone)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    let successCount = 0;
    let skipCount = 0;

    const skippedRows: Array<{
        rowNum: number;
        partner: string;
        contact: string;
        position: string;
        jobType: string;
        email: string;
        phone: string;
        reason: string;
    }> = [];

    // DB 트랜잭션 수행
    const runImport = db.transaction(() => {
        for (let i = 2; i <= worksheet.rowCount; i++) {
            const row = worksheet.getRow(i);
            const rowData: Record<string, string> = {};
            row.eachCell((cell, colNumber) => {
                const header = headers[colNumber];
                if (header) {
                    rowData[header] = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : "";
                }
            });

            const partnerName = rowData["파트너"] || "";
            const contactName = rowData["담당자"] || "";
            const position = rowData["직급"] || "";
            const jobType = rowData["구분"] || "";
            const email = rowData["이메일"] || "";
            const phone = rowData["전화번호"] || "";

            // 비어있는 행 무시
            if (!partnerName && !contactName) continue;

            if (!partnerName || !contactName) {
                skipCount++;
                skippedRows.push({
                    rowNum: i,
                    partner: partnerName,
                    contact: contactName,
                    position,
                    jobType,
                    email,
                    phone,
                    reason: "파트너명 또는 담당자명 필수값 누락",
                });
                continue;
            }

            // 1) partners 테이블에 파트너사명이 존재하는지 확인
            const partnerId = partnerMap.get(partnerName);
            if (!partnerId) {
                skipCount++;
                skippedRows.push({
                    rowNum: i,
                    partner: partnerName,
                    contact: contactName,
                    position,
                    jobType,
                    email,
                    phone,
                    reason: `파트너사 미등록 ('${partnerName}' 파트너사 DB 부재)`,
                });
                continue;
            }

            // 2) partner_contacts 테이블에 담당자가 이미 존재하는지 확인
            const isExactMatch = existingContactSet.has(`${partnerId}_${contactName}`);
            const isNameExists = existingNamesSet.has(contactName);

            if (isExactMatch || isNameExists) {
                skipCount++;
                skippedRows.push({
                    rowNum: i,
                    partner: partnerName,
                    contact: contactName,
                    position,
                    jobType,
                    email,
                    phone,
                    reason: `담당자 이미 존재 ('${contactName}' DB 중복)`,
                });
                continue;
            }

            // DB에 새로 등록
            insertStmt.run(partnerId, contactName, position, jobType, email, phone);

            // 로컬 Set에 추가하여 동일 엑셀 내 중복 방지
            existingContactSet.add(`${partnerId}_${contactName}`);
            existingNamesSet.add(contactName);
            successCount++;
        }
    });

    runImport();

    console.log(`\n==============================================`);
    console.log(`🎉 [Import Completed Summary]`);
    console.log(`- 성공적으로 DB 입력 완료: ${successCount} 건`);
    console.log(`- 미입력 (스킵): ${skipCount} 건`);
    console.log(`==============================================\n`);

    // 4. 미입력 결과 엑셀 파일 생성
    if (skippedRows.length > 0) {
        const outWorkbook = new ExcelJS.Workbook();
        const outSheet = outWorkbook.addWorksheet("미입력목록");

        outSheet.addRow(["원본행번호", "파트너", "담당자", "직급", "구분", "이메일", "전화번호", "미입력 사유"]);

        // 헤더 스타일링
        const headerRow = outSheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4F81BD" },
        };

        skippedRows.forEach((r) => {
            outSheet.addRow([
                r.rowNum,
                r.partner,
                r.contact,
                r.position,
                r.jobType,
                r.email,
                r.phone,
                r.reason,
            ]);
        });

        // 컬럼 너비 자동 설정
        outSheet.columns.forEach((col) => {
            col.width = 18;
        });
        outSheet.getColumn(8).width = 40; // 미입력 사유 컬럼은 넓게

        await outWorkbook.xlsx.writeFile(outputExcelPath);
        console.log(`📄 [미입력 목록 엑셀 생성] ${outputExcelPath} 저장 완료!`);
    } else {
        console.log(`✨ 모든 담당자가 성공적으로 입력되었습니다! (미입력 엑셀 생성 생략)`);
    }
}

importPartnerContacts().catch((err) => {
    console.error("Import error:", err);
});
