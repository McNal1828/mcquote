// 나만의 비밀 키 설정
const SECRET_API_KEY = "dptmeldkdltkdjqqnqlalfqjsgh";

function doPost(e) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const requestData = JSON.parse(e.postData.contents);

        // 🔒 [보안 검증]
        if (!requestData.apiKey || requestData.apiKey !== SECRET_API_KEY) {
            return responseJSON({
                status: 'error',
                message: '권한이 없습니다: 유효하지 않은 API 키입니다.'
            });
        }

        // 🎯 [시트 지정]
        const targetSheetName = requestData.sheetName || 'TestPipeline';
        const sheet = ss.getSheetByName(targetSheetName);

        if (!sheet) {
            return responseJSON({
                status: 'error',
                message: `'${targetSheetName}' 이름의 시트를 찾을 수 없습니다.`
            });
        }

        const action = requestData.action;

        // 1. 데이터 추가 (action: "add")
        if (action === 'add') {
            const lock = LockService.getScriptLock();
            try {
                // 동시 다발적인 추가 요청 시 데이터 꼬임 및 서식 유실을 막기 위해 락 대기 (최대 30초)
                lock.waitLock(30000);

                const nextRow = sheet.getLastRow() + 1; // 다음에 추가될 행 번호 (락 획득 후 실시간 취득)
                const newRow = [
                    requestData.year,                                                            // A열: 연도
                    requestData.month,                                                           // B열: 월
                    `="Q" & CHOOSE(B${nextRow}, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4)`,            // C열: 분기 수식
                    requestData.id,                                                              // D열: ID
                    '',                                                                          // E열: 빈 값
                    requestData.vendor,                                                          // F열: Vendor
                    'SDI사업본부',                                                                // G열: 사업본부
                    requestData.dist,                                                            // H열: Dist
                    requestData.am,                                                              // I열: AM
                    requestData.partner,                                                         // J열: Partner
                    requestData.contact,                                                         // K열: Contact
                    requestData.account,                                                         // L열: Account
                    '',                                                                          // M열: 빈 값
                    requestData.stage,                                                           // N열: Stage
                    requestData.netdollar,                                                       // O열: Net Dollar
                    requestData.price,                                                           // P열: 금액 (Price)
                    requestData.margin,                                                          // Q열: 마진 (Margin)
                    `=Q${nextRow}/P${nextRow}`,                                                  // R열: 마진율 수식 (Q열 마진 / P열 금액)
                    '',                                                                          // S열
                    ''                                                                           // T열
                ];

                // ① 행 데이터 추가
                sheet.appendRow(newRow);

                // ✨ ② [서식 자동 적용] 이전 행의 테두리 및 서식을 새로 추가된 행으로 복사
                if (nextRow > 2) { // 1행(헤더), 2행(첫 데이터) 이후부터 서식 복사 수행
                    const numCols = newRow.length;
                    const sourceRange = sheet.getRange(nextRow - 1, 1, 1, numCols); // 바로 위 데이터 행
                    const targetRange = sheet.getRange(nextRow, 1, 1, numCols);     // 새로 추가된 행

                    // 데이터와 수식은 유지하고 '서식(스타일)'만 복사
                    sourceRange.copyTo(targetRange, { formatOnly: true });
                }

                // 변경 데이터 스프레드시트에 즉각 커밋
                SpreadsheetApp.flush();

                return responseJSON({
                    status: 'success',
                    message: `'${targetSheetName}' 시트에 데이터가 성공적으로 추가되었습니다.`,
                    addedData: newRow
                });
            } finally {
                lock.releaseLock(); // 반드시 락 해제
            }
        }

        // 2. 데이터 삭제 (action: "delete")
        if (action === 'delete') {
            const targetId = String(requestData.id);
            const values = sheet.getDataRange().getValues();
            let deletedCount = 0;

            // D열(3번 인덱스)의 ID 기준 탐색 및 삭제
            for (let i = values.length - 1; i >= 1; i--) {
                if (String(values[i][3]) === targetId) {
                    sheet.deleteRow(i + 1);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                return responseJSON({
                    status: 'success',
                    message: `${deletedCount}개의 행이 삭제되었습니다.`
                });
            } else {
                return responseJSON({
                    status: 'fail',
                    message: '해당 ID를 찾을 수 없습니다.'
                });
            }
        }

        // 3. 데이터 수정 (action: "update")
        if (action === 'update') {
            const targetId = String(requestData.id);
            const targetStage = requestData.stage;
            const values = sheet.getDataRange().getValues();
            let updatedCount = 0;

            // D열(3번 인덱스)의 ID 기준 탐색 및 N열(14번째 열, 13번 인덱스)의 Stage 값 업데이트
            for (let i = 1; i < values.length; i++) {
                if (String(values[i][3]) === targetId) {
                    sheet.getRange(i + 1, 14).setValue(targetStage);
                    updatedCount++;
                }
            }

            if (updatedCount > 0) {
                return responseJSON({
                    status: 'success',
                    message: `${updatedCount}개의 행의 Stage가 업데이트되었습니다.`
                });
            } else {
                return responseJSON({
                    status: 'fail',
                    message: '해당 ID를 찾을 수 없습니다.'
                });
            }
        }

        return responseJSON({
            status: 'fail',
            message: '유효하지 않은 action입니다. ("add", "delete" 또는 "update" 입력 필요)'
        });

    } catch (error) {
        return responseJSON({
            status: 'error',
            message: error.toString()
        });
    }
}

function doGet(e) {
    return responseJSON({
        status: 'success',
        message: 'Google Apps Script 웹앱이 정상적으로 동작 중입니다.'
    });
}

function responseJSON(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}