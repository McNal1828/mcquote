import ExcelJS from "exceljs";
import db from "../db.server";
import type { Route } from "./+types/api.home.download";

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);

    // 1. home.tsx와 동일한 필터링 및 정렬 조건 구성
    const sortKey = url.searchParams.get("sortKey") || "updated_at";
    const sortDir = url.searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

    const conditions: string[] = [];
    const params: any[] = [];

    const addSearch = (key: string, dbCol: string) => {
        const val = url.searchParams.get(key);
        if (val) {
            conditions.push(`${dbCol} LIKE ?`);
            params.push(`%${val}%`);
        }
    };

    addSearch("client_company", "q.client_company");
    addSearch("partner_company", "p.name");
    addSearch("partner_contact_name", "pc.name");
    addSearch("project_name", "q.project_name");
    addSearch("dist_contact_name", "dc.name");

    const isOrdered = url.searchParams.get("is_ordered") ?? "0";
    if (isOrdered !== "all") {
        conditions.push("q.is_ordered = ?");
        params.push(parseInt(isOrdered, 10));
    }

    const isLost = url.searchParams.get("is_lost") ?? "0";
    if (isLost !== "all") {
        conditions.push("q.is_lost = ?");
        params.push(parseInt(isLost, 10));
    }

    const createdYear = url.searchParams.get("created_year");
    if (createdYear) {
        conditions.push(
            "STRFTIME('%Y', q.created_at / 1000, 'unixepoch', 'localtime') = ?",
        );
        params.push(createdYear);
    }

    const createdMonth = url.searchParams.get("created_month");
    if (createdMonth) {
        conditions.push(
            "STRFTIME('%m', q.created_at / 1000, 'unixepoch', 'localtime') = ?",
        );
        params.push(createdMonth.padStart(2, "0"));
    }

    const vendor = url.searchParams.get("vendor");
    if (vendor) {
        conditions.push("q.vendor = ?");
        params.push(vendor);
    }

    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sortMap: Record<string, string> = {
        client_company: "q.client_company",
        partner_company: "p.name",
        partner_contact_name: "pc.name",
        dist_contact_name: "dc.name",
        project_name: "q.project_name",
        created_at: "q.created_at",
        updated_at: "q.updated_at",
    };
    const dbSortKey = sortMap[sortKey] || "q.updated_at";

    // 2. DB에서 조건에 맞는 전체 데이터 조회 (페이지네이션 없이 전부)
    const stmt = db.prepare(`
        SELECT 
            p.name as partner_company,
            pc.name as partner_contact_name,
            q.client_company,
            q.project_name,
            dc.name as dist_contact_name,
            q.vendor,
            a.name as am_name,
            q.created_at,
            q.updated_at,
            q.is_ordered,
            q.is_lost,
            q.products
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        LEFT JOIN ams a ON q.am_id = a.id
        ${whereClause}
        ORDER BY ${dbSortKey} ${sortDir}
    `);

    const rawQuotes = stmt.all(...params) as any[];

    // 3. 엑셀 워크북 및 워크시트 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("견적 목록");

    // 엑셀 헤더(1행) 설정
    worksheet.columns = [
        { header: "파트너사", key: "partner", width: 20 },
        { header: "파트너사 담당자 이름", key: "partner_contact", width: 22 },
        { header: "고객사", key: "client", width: 20 },
        { header: "사업명", key: "project", width: 35 },
        { header: "벤더", key: "vendor", width: 15 },
        { header: "벤더 담당자", key: "am_name", width: 18 },
        { header: "총판 담당자 이름", key: "dist_contact", width: 20 },
        { header: "견적날짜", key: "created_at", width: 15 },
        { header: "마지막 수정날짜", key: "updated_at", width: 15 },
        { header: "오더여부", key: "is_ordered", width: 12 },
        { header: "실주여부", key: "is_lost", width: 12 },
        { header: "제품상세", key: "products_info", width: 50 },
    ];

    // 헤더 스타일링 (볼드 및 배경색)
    worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFE5E7EB" }, // 연한 회색
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    // 4. 데이터 기입
    rawQuotes.forEach((row) => {
        // 제품 상세 JSON 파싱 및 포맷팅 (리스트 형식 텍스트화)
        let productsText = "";
        try {
            const productsArray = JSON.parse(row.products || "[]");
            productsText = productsArray
                .map((p: any) => {
                    const code = p.제품코드 || "-";
                    const qty = p.수량 || 0;
                    const period = p.기간 || 0;
                    const supply = Number(p.공급가) || 0;
                    return `• ${code} / ${qty}ea / ${period}Y / ₩${supply.toLocaleString()}`;
                })
                .join("\n");
        } catch (e) {
            productsText = "제품 정보 없음";
        }

        const addedRow = worksheet.addRow({
            partner: row.partner_company || "",
            partner_contact: row.partner_contact_name || "",
            client: row.client_company || "",
            project: row.project_name || "",
            vendor: row.vendor || "",
            am_name: row.am_name || "",
            dist_contact: row.dist_contact_name || "",
            created_at: new Date(row.created_at).toLocaleDateString("ko-KR"),
            updated_at: new Date(row.updated_at).toLocaleDateString("ko-KR"),
            is_ordered: row.is_ordered === 1 ? "오더 완료" : "-",
            is_lost: row.is_lost === 1 ? "실주" : "-",
            products_info: productsText,
        });

        // 행 내의 각 셀 세로 중앙 정렬 처리, '제품상세' 셀은 줄바꿈(wrapText) 적용
        addedRow.eachCell((cell, colNumber) => {
            if (colNumber === 12) {
                // 제품상세 컬럼
                cell.alignment = { vertical: "middle", wrapText: true };
            } else {
                cell.alignment = { vertical: "middle", horizontal: "center" };
            }
        });
    });

    // 5. 다운로드용 파일 반환 처리
    const buffer = await workbook.xlsx.writeBuffer();

    // 오늘 날짜를 파일명에 포함 (예: 견적목록_20241015.xlsx)
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `견적목록_${nowStr}.xlsx`;
    const encodedFilename = encodeURIComponent(filename);

    return new Response(buffer, {
        headers: {
            "Content-Type":
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
        },
    });
}
