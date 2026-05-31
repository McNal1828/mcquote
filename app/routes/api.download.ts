import ExcelJS from "exceljs";
import path from "path";
import type { Route } from "./+types/api.download";

// 브라우저가 이 URL로 POST 요청을 보낼 때 실행됩니다.
export async function action({ request }: Route.ActionArgs) {
    // 클라이언트에서 보낸 제품 목록 데이터를 받습니다.
    const { products } = await request.json();

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

        // 삽입된 새 행일 경우, 3행(템플릿)의 서식을 그대로 복사합니다.
        if (idx > 0) {
            row.height = templateRow.height;
            templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = row.getCell(colNumber);
                newCell.style = cell.style;
            });
        }

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
}
