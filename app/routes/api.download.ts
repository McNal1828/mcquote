import ExcelJS from "exceljs";
import type { Route } from "./+types/api.download";

// 브라우저가 이 URL로 GET 요청을 보낼 때 실행됩니다.
// 화면(UI)을 그리는 대신, 엑셀 파일(Buffer)을 생성하여 다운로드를 유도합니다.
export async function loader({ request }: Route.LoaderArgs) {
    const workbook = new ExcelJS.Workbook();

    // 작성자, 생성일 등 속성 추가 (선택사항)
    workbook.creator = "React Router App";
    workbook.created = new Date();

    // 새로운 워크시트 생성
    const worksheet = workbook.addWorksheet("샘플 데이터");

    // 컬럼(열) 정의 및 스타일 설정
    worksheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "이름", key: "name", width: 30 },
        { header: "권한", key: "role", width: 20 },
    ];

    // 데이터(행) 추가
    worksheet.addRow({ id: 1, name: "Alice", role: "Admin" });
    worksheet.addRow({ id: 2, name: "Bob", role: "User" });
    worksheet.addRow({ id: 3, name: "Charlie", role: "Guest" });

    // 엑셀 파일을 메모리 버퍼로 변환
    const buffer = await workbook.xlsx.writeBuffer();

    // 클라이언트가 파일로 인식하고 다운로드 창을 띄우도록 HTTP 헤더 설정
    return new Response(buffer, {
        headers: {
            "Content-Type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": 'attachment; filename="sample_data.xlsx"',
        },
    });
}
