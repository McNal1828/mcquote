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
                    requestData.projectCode || '',                                               // M열: Project Code
                    requestData.stage,                                                           // N열: Stage
                    requestData.netdollar,                                                       // O열: Net Dollar
                    requestData.price,                                                           // P열: 금액 (Price)
                    requestData.margin,                                                          // Q열: 마진 (Margin)
                    `=Q${nextRow}/P${nextRow}`,                                                  // R열: 마진율 수식 (Q열 마진 / P열 금액)
                    requestData.note || '',                                                      // S열: 대표비고
                    '',                                                                          // T열: 빈 값
                    ''                                                                           // U열: 빈 값
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
            const targetNote = requestData.note;
            const values = sheet.getDataRange().getValues();
            let updatedCount = 0;

            // D열(3번 인덱스)의 ID 기준 탐색 및 N열(Stage), S열(대표비고) 업데이트
            for (let i = 1; i < values.length; i++) {
                if (String(values[i][3]) === targetId) {
                    if (targetStage !== undefined && targetStage !== null) {
                        sheet.getRange(i + 1, 14).setValue(targetStage); // N열 Stage
                    }
                    if (targetNote !== undefined && targetNote !== null) {
                        sheet.getRange(i + 1, 19).setValue(targetNote); // S열 대표비고
                    }
                    updatedCount++;
                }
            }

            if (updatedCount > 0) {
                return responseJSON({
                    status: 'success',
                    message: `${updatedCount}개의 행 정보가 업데이트되었습니다.`
                });
            } else {
                return responseJSON({
                    status: 'fail',
                    message: '해당 ID를 찾을 수 없습니다.'
                });
            }
        }

        // 4. 일괄 배치 처리 (action: "batch")
        if (action === 'batch') {
            const lock = LockService.getScriptLock();
            try {
                // 동시 실행 데이터 꼬임 방지를 위해 30초 대기 락 획득
                lock.waitLock(30000);

                const values = sheet.getDataRange().getValues();

                // ① 일괄 삭제 (deleteIds)
                if (requestData.deleteIds && requestData.deleteIds.length > 0) {
                    const deleteSet = new Set(requestData.deleteIds.map(String));
                    // 행이 당겨지는 것을 고려해 뒤에서부터 루프 돌며 삭제
                    for (let i = values.length - 1; i >= 1; i--) {
                        if (deleteSet.has(String(values[i][3]))) { // D열의 ID 비교
                            sheet.deleteRow(i + 1);
                        }
                    }
                }

                // ② 일괄 영업 단계, 수치 및 비고 수정 (updateRows)
                if (requestData.updateRows && requestData.updateRows.length > 0) {
                    const updateMap = {};
                    requestData.updateRows.forEach(row => {
                        updateMap[String(row.id)] = row;
                    });

                    for (let i = 1; i < values.length; i++) {
                        const targetIdStr = String(values[i][3]);
                        const updateData = updateMap[targetIdStr];
                        if (updateData !== undefined) {
                            const rowIdx = i + 1;
                            if (updateData.year !== undefined && updateData.year !== null) {
                                sheet.getRange(rowIdx, 1).setValue(updateData.year); // A열: 매출년
                            }
                            if (updateData.month !== undefined && updateData.month !== null) {
                                sheet.getRange(rowIdx, 2).setValue(updateData.month); // B열: 매출월
                                sheet.getRange(rowIdx, 3).setFormula(`="Q" & CHOOSE(B${rowIdx}, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4)`); // C열: 분기 수식
                            }
                            if (updateData.projectCode !== undefined && updateData.projectCode !== null) {
                                sheet.getRange(rowIdx, 13).setValue(updateData.projectCode); // M열 Project Code 수정
                            }
                            if (updateData.stage !== undefined && updateData.stage !== null) {
                                sheet.getRange(rowIdx, 14).setValue(updateData.stage); // N열 Stage 수정
                            }
                            if (updateData.netdollar !== undefined && updateData.netdollar !== null) {
                                sheet.getRange(rowIdx, 15).setValue(updateData.netdollar); // O열 Net Dollar ($) 수정
                            }
                            if (updateData.price !== undefined && updateData.price !== null) {
                                sheet.getRange(rowIdx, 16).setValue(updateData.price); // P열 공급가 (₩) 수정
                            }
                            if (updateData.margin !== undefined && updateData.margin !== null) {
                                sheet.getRange(rowIdx, 17).setValue(updateData.margin); // Q열 마진 (₩) 수정
                            }
                            if (updateData.price !== undefined || updateData.margin !== undefined) {
                                sheet.getRange(rowIdx, 18).setFormula(`=Q${rowIdx}/P${rowIdx}`); // R열 마진율 수식 갱신
                            }
                            if (updateData.note !== undefined && updateData.note !== null) {
                                sheet.getRange(rowIdx, 19).setValue(updateData.note); // S열 대표비고 수정
                            }
                        }
                    }
                }

                // ③ 일괄 추가 (addRows)
                if (requestData.addRows && requestData.addRows.length > 0) {
                    requestData.addRows.forEach((rowPayload) => {
                        const nextRow = sheet.getLastRow() + 1;
                        const newRow = [
                            rowPayload.year,
                            rowPayload.month,
                            `="Q" & CHOOSE(B${nextRow}, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4)`, // C열 분기 수식
                            rowPayload.id,
                            '',
                            rowPayload.vendor,
                            'SDI사업본부',
                            rowPayload.dist,
                            rowPayload.am,
                            rowPayload.partner,
                            rowPayload.contact,
                            rowPayload.account,
                            rowPayload.projectCode || '', // M열 Project Code
                            rowPayload.stage, // N열 Stage
                            rowPayload.netdollar,
                            rowPayload.price,
                            rowPayload.margin,
                            `=Q${nextRow}/P${nextRow}`, // R열 마진율 수식
                            rowPayload.note || '', // S열 대표비고
                            ''
                        ];

                        sheet.appendRow(newRow);

                        // 스타일 서식 상속 복사
                        if (nextRow > 2) {
                            const numCols = newRow.length;
                            const sourceRange = sheet.getRange(nextRow - 1, 1, 1, numCols);
                            const targetRange = sheet.getRange(nextRow, 1, 1, numCols);
                            sourceRange.copyTo(targetRange, { formatOnly: true });
                        }
                    });
                }

                // 구글 스프레드시트 반영 즉시 강제 기입
                SpreadsheetApp.flush();

                return responseJSON({
                    status: 'success',
                    message: '배치 작업이 성공적으로 수행되었습니다.'
                });
            } finally {
                lock.releaseLock(); // 반드시 락 반환
            }
        }

        return responseJSON({
            status: 'fail',
            message: '유효하지 않은 action입니다. ("add", "delete", "update" 또는 "batch" 입력 필요)'
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