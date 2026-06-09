import ExcelJS from "exceljs";
import path from "path";
import type { Route } from "./+types/api.download";

// 브라우저가 이 URL로 POST 요청을 보낼 때 실행됩니다.
export async function action({ request }: Route.ActionArgs) {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");

    // 클라이언트에서 보낸 제품 목록 데이터를 받습니다.
    const {
        products,
        partnerCompany,
        partnerName,
        clientCompany,
        projectName,
    } = await request.json();

    if (type === "cost") {
        const workbook = new ExcelJS.Workbook();

        // public 폴더 내의 cost.xlsx 템플릿 파일을 읽어옵니다.
        const filePath = path.join(process.cwd(), "public", "cost.xlsx");
        await workbook.xlsx.readFile(filePath);

        const worksheet = workbook.worksheets[0];

        // 1. 제품 개수만큼 3행 밑에 빈 행을 삽입합니다. (기존 4행의 합산 수식은 자연스럽게 아래로 밀려납니다.)
        if (products && products.length > 1) {
            const emptyRows = Array(products.length - 1).fill([]);
            worksheet.spliceRows(4, 0, ...emptyRows);
        }

        const templateRow = worksheet.getRow(3);

        // 2. 각 제품 데이터를 해당 행에 기입합니다.
        products.forEach((prod: any, idx: number) => {
            const rowIndex = 3 + idx;
            const row = worksheet.getRow(rowIndex);

            // 첫 번째 행(템플릿 행)을 포함하여 모든 행에 서식과 Arial 폰트를 강제 적용합니다.
            row.height = templateRow.height;
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = row.getCell(colNumber);

                // 기존 스타일을 안전하게 복사
                const newStyle: any = {
                    alignment: cell.style.alignment
                        ? { ...cell.style.alignment }
                        : undefined,
                    border: cell.style.border
                        ? { ...cell.style.border }
                        : undefined,
                    fill: cell.style.fill ? { ...cell.style.fill } : undefined,
                    numFmt: cell.style.numFmt,
                };

                // 폰트를 명시적으로 Arial로 고정하여 엑셀 기본 폰트(나눔고딕)로 풀리는 것을 방지
                if (cell.style.font) {
                    newStyle.font = {
                        ...cell.style.font,
                        name: "Arial",
                    };
                } else {
                    newStyle.font = { name: "Arial" };
                }

                newCell.style = newStyle;
            });

            // B ~ P 열에 데이터 입력
            row.getCell(2).value = prod.제품코드 || ""; // B
            row.getCell(3).value = Number(prod.수량) || 0; // C
            row.getCell(4).value = Number(prod.기간) || 0; // D
            row.getCell(5).value = Number(prod.lpd) || 0; // E

            const dcDollar = Number(prod.DC달러) || 0;
            row.getCell(7).value = dcDollar / 100; // G (DC달러 %)

            const exchangeRate = Number(prod.환율) || 0;
            row.getCell(8).value = exchangeRate; // H (환율)

            const dcWon = Number(prod.DC원화) || 0;
            row.getCell(12).value = dcWon / 100; // L (DC원화 %)

            const lpw = Number(prod.lpw) || 0;
            row.getCell(13).value = lpw; // M (lpw)

            // 계산이 필요한 셀들은 엑셀 수식(formula)으로 삽입합니다.
            row.getCell(6).value = {
                formula: `E${rowIndex}*C${rowIndex}*D${rowIndex}`,
            }; // F: 달러원가 = lpd * 수량 * 기간
            row.getCell(9).value = { formula: `E${rowIndex}*(1-G${rowIndex})` }; // I: 달러PPC = lpd * (1 - DC달러%)
            row.getCell(10).value = {
                formula: `I${rowIndex}*C${rowIndex}*D${rowIndex}`,
            }; // J: 달러net = 달러PPC * 수량 * 기간
            row.getCell(11).value = { formula: `J${rowIndex}*H${rowIndex}` }; // K: 원화net = 달러net * 환율
            // 엑셀에서 ROUND(수식, -3)은 1,000 단위로 반올림합니다.
            row.getCell(14).value = {
                formula: `ROUND(M${rowIndex}*C${rowIndex}*D${rowIndex}*(1-L${rowIndex}), -3)`,
            }; // N: 공급가 = lpw * 수량 * 기간 * (1 - DC원화%)
            row.getCell(15).value = { formula: `N${rowIndex}-K${rowIndex}` }; // O: 마진 = 공급가 - 원화net
            row.getCell(16).value = {
                formula: `IF(N${rowIndex}=0, 0, O${rowIndex}/N${rowIndex})`,
            }; // P: 마진% = 마진 / 공급가

            row.commit();
        });

        // 3. 밀려난 기존 합산 행(SUM) 수식을 업데이트합니다.
        const totalRowIndex = 3 + products.length;
        const totalRow = worksheet.getRow(totalRowIndex);
        const sumColumns = [6, 10, 11, 14, 15]; // F(6), J(10), K(11), N(14), O(15)
        const endRow = totalRowIndex - 1;

        sumColumns.forEach((colNum) => {
            const colLetter = String.fromCharCode(64 + colNum);
            totalRow.getCell(colNum).value = {
                formula: `SUM(${colLetter}3:${colLetter}${endRow})`,
            };
        });
        totalRow.commit();

        const buffer = await workbook.xlsx.writeBuffer();

        return new Response(buffer, {
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": 'attachment; filename="cost.xlsx"',
            },
        });
    } else if (type === "quote") {
        const workbook = new ExcelJS.Workbook();

        // public 폴더 내의 quote.xlsx 템플릿 파일을 읽어옵니다.
        const filePath = path.join(process.cwd(), "public", "quote.xlsx");
        await workbook.xlsx.readFile(filePath);

        const worksheet = workbook.worksheets[0];

        // --- 기존 열 너비(Column Width) 백업 ---
        // ExcelJS에서 행 삽입 시 간혹 열 너비가 초기화되는 버그가 있어 미리 저장합니다.
        const originalColWidths: (number | undefined)[] = [];
        for (let i = 1; i <= 17; i++) {
            originalColWidths[i] = worksheet.getColumn(i).width;
        }

        // --- 엑셀 보기 설정(눈금선 숨김) 강제 유지 ---
        if (worksheet.views && worksheet.views.length > 0) {
            worksheet.views.forEach((v) => {
                v.showGridLines = false;
            });
        } else {
            worksheet.views = [{ showGridLines: false }];
        }

        // --- 인쇄 설정 (여백, 가로 가운데 맞춤, 바닥글) ---
        // ExcelJS는 여백을 인치(inch) 단위로 받기 때문에, 요청하신 cm 값을 2.54로 나누어 적용합니다.
        if (!worksheet.pageSetup) worksheet.pageSetup = {};
        worksheet.pageSetup.margins = {
            top: 2.6 / 2.54,
            header: 1.3 / 2.54,
            left: 1.1 / 2.54,
            right: 1.1 / 2.54,
            bottom: 0.6 / 2.54,
            footer: 1.3 / 2.54,
        };
        worksheet.pageSetup.horizontalCentered = true; // 가로 가운데 맞춤

        worksheet.pageSetup.fitToPage = true; // 자동 맞춤 활성화
        worksheet.pageSetup.fitToWidth = 1; // 너비 1페이지에 맞춤
        worksheet.pageSetup.fitToHeight = 1; // 높이 1페이지에 맞춤

        if (!worksheet.headerFooter) worksheet.headerFooter = {};
        // &C: 가운데 정렬, &"Arial,Regular"&7: Arial 폰트 7사이즈 적용, \n: 줄바꿈
        worksheet.headerFooter.oddFooter =
            '&C&"Arial,Regular"&7For further information, please contact the person at the number above.\nThank you for the opportunity';
        worksheet.headerFooter.scaleWithDoc = true; // 바닥글 문서에 맞게 배율 조정(L)

        // C9 셀에 오늘 날짜를 정적 값으로 입력합니다. (단축키 Ctrl + ; 로 넣는 것과 동일)
        // 서버 타임존에 의한 시간 변동(오전 3시 등)을 막기 위해 UTC 기준 자정으로 Date 객체를 생성합니다.
        const now = new Date();
        const kstDateString = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(now); // "YYYY-MM-DD" 형태

        const [yyyy, mm, dd] = kstDateString.split("-").map(Number);

        const c9 = worksheet.getCell("C9");
        // UTC 자정으로 생성하여 엑셀에서 시간 오차 없이 정확한 고정 날짜로 인식하게 합니다.
        c9.value = new Date(Date.UTC(yyyy, mm - 1, dd));

        // C10 셀에 C9 날짜 기준 +7일의 날짜를 정적 값으로 입력합니다.
        const c10 = worksheet.getCell("C10");
        c10.value = new Date(Date.UTC(yyyy, mm - 1, dd + 7));

        // 1. 20번째 행을 기준으로 제품 개수만큼 아래로 빈 행을 삽입합니다.
        let shift = 0;
        if (products && products.length > 1) {
            shift = products.length - 1;
            const emptyRows = Array(shift).fill([]);
            worksheet.spliceRows(21, 0, ...emptyRows);
        }

        // --- 인쇄 영역(Print Area) 고정 및 확장 ---
        if (!worksheet.pageSetup) worksheet.pageSetup = {};
        // 명명된 범위(Named Range) 에러가 발생하지 않도록 $ 기호를 제거한 포맷으로 할당합니다.
        worksheet.pageSetup.printArea = `A1:J${48 + shift}`;

        const templateRow = worksheet.getRow(20);

        // 2. 제품 데이터를 해당 행에 기입합니다.
        products.forEach((prod: any, idx: number) => {
            const rowIndex = 20 + idx;
            const row = worksheet.getRow(rowIndex);

            // 첫 번째 행(템플릿 행)을 포함하여 모든 행에 서식과 Arial 폰트를 강제 적용합니다.
            row.height = templateRow.height;
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = row.getCell(colNumber);

                // 기존 스타일을 안전하게 복사
                const newStyle: any = {
                    alignment: cell.style.alignment
                        ? { ...cell.style.alignment }
                        : undefined,
                    border: cell.style.border
                        ? { ...cell.style.border }
                        : undefined,
                    fill: cell.style.fill ? { ...cell.style.fill } : undefined,
                    numFmt: cell.style.numFmt,
                };

                // 폰트를 명시적으로 Arial로 고정하여 엑셀 기본 폰트(나눔고딕)로 풀리는 것을 방지
                if (cell.style.font) {
                    newStyle.font = {
                        ...cell.style.font,
                        name: "Arial",
                    };
                } else {
                    newStyle.font = { name: "Arial" };
                }

                newCell.style = newStyle;
            });

            // 알려주신 규칙대로 각 열(A~K)에 값 및 수식을 삽입합니다.
            row.getCell(1).value = idx + 1; // A: 순차적 숫자
            row.getCell(2).value = "Term License"; // B: 고정 문구
            row.getCell(3).value = prod.제품코드 || ""; // C: 제품코드
            row.getCell(4).value = prod.제품설명 || ""; // D: 제품설명
            row.getCell(5).value = Number(prod.수량) || 0; // E: 수량
            row.getCell(6).value = Number(prod.기간) || 0; // F: 기간

            const lpw = Number(prod.lpw) || 0;
            row.getCell(7).value = { formula: `${lpw}*F${rowIndex}` }; // G: lpw * F열
            row.getCell(8).value = { formula: `G${rowIndex}*E${rowIndex}` }; // H: G열 * E열

            const dcWon = Number(prod.DC원화) || 0;
            row.getCell(11).value = dcWon / 100; // K: DC원화 (%) - (I열 수식을 위해 먼저 세팅)
            row.getCell(9).value = { formula: `G${rowIndex}*(1-K${rowIndex})` }; // I: G열에 K의 DC원화% 적용
            row.getCell(10).value = { formula: `I${rowIndex}*E${rowIndex}` }; // J: I열 * E열

            row.commit();
        });

        // 3. 행 삽입으로 인해 밀려난 하단 수식(부가세, 총합계 등)을 수동으로 업데이트합니다.
        // 특정 단일 셀을 참조하는 수식(예: I37*0.1)은 ExcelJS가 자동으로 업데이트하지 않으므로 직접 수정해야 합니다.
        if (products && products.length > 0) {
            const shiftCount = products.length - 1;
            const subtotalRowIndex = 37 + shiftCount; // 소계 (기존 37행)
            const vatRowIndex = 38 + shiftCount; // 부가세 (기존 38행)
            const totalRowIndex = 39 + shiftCount; // 총합계 (기존 39행)

            // I열(9) 부가세 및 총계 수식 업데이트
            worksheet.getRow(vatRowIndex).getCell(9).value = {
                formula: `I${subtotalRowIndex}*0.1`,
            };
            worksheet.getRow(totalRowIndex).getCell(9).value = {
                formula: `I${subtotalRowIndex}+I${vatRowIndex}`,
            };
        }

        // --- 기존 열 너비(Column Width) 복원 ---
        for (let i = 1; i <= 15; i++) {
            if (originalColWidths[i] !== undefined) {
                worksheet.getColumn(i).width = originalColWidths[i];
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();

        return new Response(buffer, {
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": 'attachment; filename="quote.xlsx"',
            },
        });
    } else {
        return new Response("유효하지 않은 다운로드 타입입니다.", {
            status: 400,
        });
    }
}
