import { useState, Fragment, useEffect, useRef } from "react";
import { useFetcher, useSearchParams, Link } from "react-router";
import crypto from "crypto";
import { getFinalProducts, createEmptyProductRow, calculateReverseDCWon } from "~/utils/calculator";
import ProductTable from "~/components/ProductTable";
import type { Route } from "./+types/home";
import db from "../db.server";
import {
    Search,
    Calendar,
    Tag,
    Download,
    Building2,
    Users,
    UserCircle,
    ClipboardList,
    Package,
    FileText,
    Plus,
    Save,
    Trash2,
    X,
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
} from "lucide-react";

export const handle = {
    breadcrumb: () => "홈페이지",
};

export const links: Route.LinksFunction = () => [
    // 예: { rel: "stylesheet", href: "/styles/home-custom.css" }
];

export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return {
        // 데이터 추가/삭제 시 즉각적인 화면 반영을 위해 브라우저 캐시를 비활성화합니다.
        "Cache-Control": "no-cache, no-store, must-revalidate",
    };
}

// export function meta({}: Route.MetaArgs) {
//     return [
//         { title: "견적관리" },
//         { name: "description", content: "McNal의 견적관리 프로젝트" },
//     ];
// }

export async function action({ request }: Route.ActionArgs) {
    const data = await request.json();
    const {
        intent,
        quoteId,
        products,
        calcMode,
        notes,
        projectName,
        isOrdered,
        isLost,
        originalUpdatedAt,
        defaultGroup,
        stage,
    } = data;

    if (intent === "delete") {
        try {
            const stmt = db.prepare("DELETE FROM quotes WHERE id = ?");
            stmt.run(quoteId);
            return { success: true, intent: "delete" };
        } catch (error) {
            return { error: "삭제 중 오류가 발생했습니다." };
        }
    }

    const quote_type = calcMode === "PPC" ? 0 : 1;
    const now = Date.now();

    try {
        // 기존 products_history 조회 및 파싱
        const currentQuote = db.prepare("SELECT products_history FROM quotes WHERE id = ?").get(quoteId) as any;
        let historyList = [];
        if (currentQuote && currentQuote.products_history) {
            try {
                historyList = JSON.parse(currentQuote.products_history);
                if (!Array.isArray(historyList)) {
                    historyList = [];
                }
            } catch (e) {
                historyList = [];
            }
        }

        // 제품 변경 여부 확인 (제품의 모든 속성 변화를 감지)
        const normalizeProductsForComparison = (prods: any): any[] => {
            const list: any[] = [];
            const processItem = (p: any) => ({
                제품코드: p.제품코드 || "",
                제품설명: p.제품설명 || "",
                lpd: Number(p.lpd) || 0,
                lpw: Number(p.lpw) || 0,
                수량: Number(p.수량) || 0,
                기간: Number(p.기간) || 0,
                DC달러: Number(p.DC달러) || 0,
                환율: Number(p.환율) || 0,
                DC원화: Number(p.DC원화) || 0,
                공급가: Number(p.공급가) || 0,
                마진: Number(p.마진) || 0,
                마진율: String(p.마진율 || "0.0"),
                년차: Number(p.년차 !== undefined ? p.년차 : p.year) || 0,
                원화PPC: Number(p.원화PPC) || 0,
                매출월: Number(p.매출월 !== undefined ? p.매출월 : p.month) || 0,
                stage: Number(p.stage) || 0,
            });

            if (Array.isArray(prods)) {
                prods.forEach((p: any) => list.push(processItem(p)));
            } else if (typeof prods === "object" && prods !== null) {
                const sortedKeys = Object.keys(prods).sort();
                for (const key of sortedKeys) {
                    const groupProds = prods[key];
                    if (Array.isArray(groupProds)) {
                        groupProds.forEach((p: any) => {
                            list.push({
                                groupName: key,
                                ...processItem(p),
                            });
                        });
                    }
                }
            }
            return list;
        };

        let productsChanged = true;
        if (historyList.length > 0) {
            const lastEntry = historyList[historyList.length - 1];
            const lastTimestamp = Object.keys(lastEntry)[0];
            const lastProducts = lastEntry[lastTimestamp];
            const prevNormalized = normalizeProductsForComparison(lastProducts);
            const newNormalized = normalizeProductsForComparison(products);
            productsChanged = JSON.stringify(prevNormalized) !== JSON.stringify(newNormalized);
        }

        // 제품 변경이 있을 때만 이력 추가
        if (productsChanged) {
            historyList.push({ [now]: products });
        }
        const products_history = JSON.stringify(historyList);

        db.transaction(() => {
            const stmt = db.prepare(`
                UPDATE quotes 
                SET quote_type = ?, note = ?, project_name = ?, is_ordered = ?, is_lost = ?, updated_at = ?, products_history = ?, stage = ?
                WHERE id = ? AND updated_at = ?
            `);
            const info = stmt.run(
                quote_type,
                JSON.stringify(notes),
                projectName,
                isOrdered,
                isLost,
                now,
                products_history,
                stage !== undefined && stage !== null ? Number(stage) : 10,
                quoteId,
                originalUpdatedAt,
            );

            if (info.changes === 0) {
                throw new Error("CONCURRENCY_ERROR");
            }

            // 기존 그룹 삭제 (ON DELETE CASCADE로 lines 자동 삭제됨)
            db.prepare("DELETE FROM quote_groups WHERE quote_id = ?").run(Number(quoteId));

            const insertGroup = db.prepare(`
                INSERT INTO quote_groups (quote_id, name, uuid, "default") 
                VALUES (?, ?, ?, ?)
            `);

            const insertLine = db.prepare(`
                INSERT INTO quote_lines (
                    group_id, line_number, product_id, description, lpd, lpw, 
                    quantity, period, dc_usd, exchange_rate, dc_krw, 
                    supply_price, margin, margin_rate, year, krw_ppc,
                    month, stage
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const selectProduct = db.prepare("SELECT id FROM products WHERE code = ?");

            const groups = Array.isArray(products) ? { "원가표1": products } : products;

            for (const [groupName, prods] of Object.entries(groups)) {
                if (!Array.isArray(prods)) continue;

                const groupUuid = crypto.randomUUID();
                const isDefault = groupName === defaultGroup ? 1 : 0;
                const groupInfo = insertGroup.run(Number(quoteId), groupName, groupUuid, isDefault);
                const groupId = groupInfo.lastInsertRowid;

                prods.forEach((line: any, index: number) => {
                    const productCode = line.제품코드;
                    const productRow = selectProduct.get(productCode) as { id: number } | undefined;
                    const productId = productRow ? productRow.id : null;

                    insertLine.run(
                        groupId,
                        index + 1,
                        productId,
                        line.제품설명 || "",
                        Number(line.lpd) || 0,
                        Number(line.lpw) || 0,
                        Number(line.수량) || 1,
                        Number(line.기간) || 1,
                        Number(line.DC달러) || 0,
                        Number(line.환율) || 0,
                        Number(line.DC원화) || 0,
                        Number(line.공급가) || 0,
                        Number(line.마진) || 0,
                        parseFloat(line.마진율) || 0,
                        Number(line.년차) || 1,
                        Number(line.원화PPC) || 0,
                        Number(line.매출월) || 1,
                        Number(line.stage) || 10
                    );
                });
            }
        })();

        return { success: true, intent: "edit" };
    } catch (error: any) {
        if (error.message === "CONCURRENCY_ERROR") {
            return {
                error: "다른 사용자가 방금 이 견적을 수정했거나 삭제했습니다. 덮어쓰기를 방지하기 위해 저장이 취소되었습니다. 새로고침 후 다시 시도해주세요.",
            };
        }
        console.error("업데이트 에러:", error);
        return { error: "업데이트 중 오류가 발생했습니다." };
    }
}

// 모든 견적의 제품 데이터를 한 번의 배치 쿼리로 조회하는 함수 (N+1 최적화)
function getAllQuoteProducts(quoteIds: number[]): Record<number, Record<string, any[]>> {
    if (quoteIds.length === 0) return {};

    const placeholders = quoteIds.map(() => "?").join(",");

    // 1. 한 번의 쿼리로 모든 그룹 조회
    const groups = db.prepare(`
        SELECT id, quote_id, name, "default" 
        FROM quote_groups 
        WHERE quote_id IN (${placeholders})
    `).all(...quoteIds) as any[];

    if (groups.length === 0) {
        const empty: Record<number, Record<string, any[]>> = {};
        quoteIds.forEach(id => { empty[id] = {}; });
        return empty;
    }

    const groupIds = groups.map((g: any) => g.id);
    const groupPlaceholders = groupIds.map(() => "?").join(",");

    // 2. 한 번의 쿼리로 모든 라인 조회
    const lines = db.prepare(`
        SELECT 
            l.id as line_id,
            l.group_id,
            l.line_number,
            p.code as 제품코드,
            p.id as product_id,
            l.description as 제품설명,
            l.lpd,
            l.lpw,
            l.quantity as 수량,
            l.period as 기간,
            l.dc_usd as DC달러,
            l.exchange_rate as 환율,
            l.dc_krw as DC원화,
            l.supply_price as 공급가,
            l.margin as 마진,
            l.margin_rate as 마진율,
            l.year as 년차,
            l.krw_ppc as 원화PPC,
            l.month as 매출월,
            l.stage
        FROM quote_lines l
        LEFT JOIN products p ON l.product_id = p.id
        WHERE l.group_id IN (${groupPlaceholders})
        ORDER BY l.line_number ASC
    `).all(...groupIds) as any[];

    // 3. 그룹 ID -> 그룹 데이터 매핑
    const groupMap = new Map<number, { quote_id: number; name: string; default: number }>();
    groups.forEach((g: any) => groupMap.set(g.id, g));

    // 4. 그룹 ID -> 라인 목록 매핑
    const linesByGroup = new Map<number, any[]>();
    lines.forEach((line: any) => {
        if (!linesByGroup.has(line.group_id)) {
            linesByGroup.set(line.group_id, []);
        }
        linesByGroup.get(line.group_id)!.push(line);
    });

    // 5. 견적 ID -> { "그룹명": [...라인] } 구조로 조립
    const result: Record<number, Record<string, any[]>> = {};
    quoteIds.forEach(id => { result[id] = {}; });

    groups.forEach((group: any) => {
        const groupLines = linesByGroup.get(group.id) || [];
        const linesWithDefault = groupLines.map((line: any) => ({
            ...line,
            group_default: group.default
        }));
        result[group.quote_id][group.name] = linesWithDefault;
    });

    return result;
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = 10; // 한 페이지당 노출할 개수
    const offset = (page - 1) * pageSize;

    const sortKey = url.searchParams.get("sortKey") || "updated_at";
    const sortDir = url.searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

    // 1. URL 파라미터를 기반으로 검색(WHERE) 조건 동적 생성
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

    // 사이드바 추가 필터 (상태 및 날짜)
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
    if (vendor === "none") {
        conditions.push("1 = 0");
    } else if (vendor) {
        const selected = vendor.split(",");
        if (selected.length > 0) {
            const placeholders = selected.map(() => "?").join(",");
            conditions.push(`q.id IN (SELECT quote_id FROM quote_vendors WHERE vendor IN (${placeholders}))`);
            selected.forEach(v => params.push(v));
        }
    }

    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // 2. 전체 데이터 개수(Total) 조회 및 페이지 수 계산
    const countStmt = db.prepare(`
        SELECT COUNT(*) as total
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN ams a ON q.am_id = a.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        ${whereClause}
    `);
    const { total } = countStmt.get(...params) as { total: number };
    const totalPages = Math.ceil(total / pageSize) || 1;

    // 3. 정렬 컬럼 매핑
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

    // 4. 페이지네이션이 적용된 실제 데이터 가져오기 (공급가 합계를 서브쿼리로 효율적 처리)
    const stmt = db.prepare(`
        SELECT 
            q.id,
            q.client_company,
            q.client_contact_name,
            q.client_contact_email,
            q.client_contact_phone,
            p.name as partner_company,
            pc.name as partner_contact_name,
            pc.email as partner_contact_email,
            pc.phone as partner_contact_phone,
            dc.name as dist_contact_name,
            q.project_name,
            q.created_at,
            q.updated_at,
            q.stage,
            q.note,
            a.name as am_name,
            q.deal_flow,
            q.contract_type,
            q.quote_type,
            q.is_ordered,
            q.is_lost,
            (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = q.id) as vendor,
            (SELECT IFNULL(SUM(l.supply_price), 0)
             FROM quote_groups g
             JOIN quote_lines l ON g.id = l.group_id
             WHERE g.quote_id = q.id AND g."default" = 1) as total_supply_price
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN ams a ON q.am_id = a.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        ${whereClause}
        ORDER BY ${dbSortKey} ${sortDir}
        LIMIT ? OFFSET ?
    `);

    const rawQuotes = stmt.all(...params, pageSize, offset) as any[];

    // 배치 쿼리로 모든 견적의 제품 데이터를 한 번에 조회 (N+1 최적화)
    const quoteIds = rawQuotes.map((row: any) => row.id);
    const allProducts = getAllQuoteProducts(quoteIds);

    // 화면에 보여주기 좋게 데이터를 가공합니다.
    const quotes = rawQuotes.map((row) => {
        let noteList = [];
        let dealFlowList = [];

        // 배치로 조회된 제품 데이터 사용
        const productsObj = allProducts[row.id] || {};

        // 비고 데이터를 JSON 배열로 파싱합니다.
        try {
            noteList = JSON.parse(row.note || "[]");
        } catch (e) {
            console.error("비고 JSON 파싱 실패:", e);
        }

        // deal_flow 데이터를 JSON 배열로 파싱합니다.
        try {
            dealFlowList = JSON.parse(row.deal_flow || "[]");
        } catch (e) {
            console.error("Deal flow JSON 파싱 실패:", e);
        }

        return {
            id: row.id,
            client_company: row.client_company,
            client_contact_name: row.client_contact_name,
            client_contact_email: row.client_contact_email,
            client_contact_phone: row.client_contact_phone,
            partner_company: row.partner_company,
            partner_contact_name: row.partner_contact_name,
            partner_contact_email: row.partner_contact_email,
            partner_contact_phone: row.partner_contact_phone,
            dist_contact_name: row.dist_contact_name,
            project_name: row.project_name,
            stage: row.stage,
            totalSupplyPrice: row.total_supply_price, // SQL에서 계산된 공급가
            productsList: productsObj, // 배치로 조회된 제품 목록
            noteList,
            am_name: row.am_name,
            dealFlowList,
            contract_type: row.contract_type,
            quote_type: row.quote_type, // PPC(0) or DC/MARGIN(1)
            is_ordered: row.is_ordered,
            is_lost: row.is_lost,
            vendor: row.vendor,
            created_at: row.created_at,
            createdAtDate: new Date(row.created_at).toLocaleDateString("ko-KR"),
            updated_at: row.updated_at,
            updatedAtDate: new Date(row.updated_at).toLocaleDateString("ko-KR"),
        };
    });

    // 제품 자동완성 및 정보 불러오기를 위한 마스터 데이터
    const productsStmt = db.prepare(
        "SELECT id, code, description, lpd, lpw, vendor, available FROM products",
    );
    const masterProducts = productsStmt.all();

    return { quotes, masterProducts, pagination: { page, totalPages, total } };
}

interface GroupNameInputProps {
    value: string;
    onRename: (newName: string) => void;
}

function GroupNameInput({ value, onRename }: GroupNameInputProps) {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    return (
        <input
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => {
                if (localValue.trim() && localValue.trim() !== value) {
                    onRename(localValue.trim());
                } else {
                    setLocalValue(value);
                }
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.currentTarget.blur();
                }
            }}
            className="font-bold text-gray-800 dark:text-gray-200 text-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            placeholder="그룹 이름"
        />
    );
}

export default function Home({ loaderData }: Route.ComponentProps) {
    const fetcher = useFetcher();
    const [searchParams, setSearchParams] = useSearchParams();

    // 펼쳐진 행(Row) 상태 관리
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    // 편집 모드 상태 관리 (quoting.tsx 로직 통일)
    const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
    const [editProducts, setEditProducts] = useState<Record<string, any[]>>({});
    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN">("DC");
    const [editNotes, setEditNotes] = useState<string[]>([]);
    const [editProjectName, setEditProjectName] = useState<string>("");
    const [editIsOrdered, setEditIsOrdered] = useState<number>(0);
    const [editIsLost, setEditIsLost] = useState<number>(0);
    const [editStage, setEditStage] = useState<number>(10);
    const [editOriginalUpdatedAt, setEditOriginalUpdatedAt] = useState<
        number | null
    >(null);
    const [editDefaultGroup, setEditDefaultGroup] = useState<string>("");

    // 전체 단계와 제품라인 일괄 수정 동기화를 위한 변수 및 함수
    const prevStageValRef = useRef<number>(10);
    const updateAllProductsStage = (newStage: number) => {
        let hasHigher = false;
        for (const [groupName, prods] of Object.entries(editProducts)) {
            if (Array.isArray(prods)) {
                for (const p of prods) {
                    const pStage = p.stage !== undefined ? p.stage : 10;
                    if (pStage > newStage) {
                        hasHigher = true;
                        break;
                    }
                }
            }
            if (hasHigher) break;
        }

        if (hasHigher) {
            const confirmChange = window.confirm(
                "단계가 낮아지는 매출년도가 있습니다. 일괄 수정을 진행하시겠습니까?"
            );
            if (!confirmChange) {
                return false;
            }
        }

        setEditProducts((prev) => {
            const next = { ...prev };
            for (const groupName of Object.keys(next)) {
                const prods = next[groupName];
                if (Array.isArray(prods)) {
                    next[groupName] = prods.map((p) => ({
                        ...p,
                        stage: newStage,
                    }));
                }
            }
            return next;
        });
        return true;
    };

    // 사이드바 필터 옵션을 위한 연도, 월 데이터 생성
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) =>
        (currentYear - i).toString(),
    );
    const months = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

    // 트렌디한 Toast 알림을 위한 상태 관리
    const [toast, setToast] = useState<{
        message: string;
        type: "error" | "success";
    } | null>(null);

    // Toast 알림이 3초 뒤에 자동으로 사라지도록 처리
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // 서버 요청 완료 후 에러가 있으면 경고를, 성공했으면 편집 창을 닫도록 처리합니다.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.error) {
                setToast({ message: fetcher.data.error, type: "error" });
            } else if (fetcher.data.success) {
                if (fetcher.data.intent === "edit") {
                    setToast({
                        message: "성공적으로 저장되었습니다.",
                        type: "success",
                    });
                    setEditingQuoteId(null);
                    setEditOriginalUpdatedAt(null);
                } else if (fetcher.data.intent === "delete") {
                    setToast({
                        message: "성공적으로 삭제되었습니다.",
                        type: "success",
                    });
                }
            }
        }
    }, [fetcher.state, fetcher.data]);

    // 견적 수정 시작
    const handleEditClick = (quote: any) => {
        if (editingQuoteId !== null && editingQuoteId !== quote.id) {
            if (
                !window.confirm(
                    "수정 중인 내용이 저장되지 않았습니다. 무시하고 다른 견적을 수정하시겠습니까?",
                )
            ) {
                return;
            }
        }
        setEditingQuoteId(quote.id);
        const initialProducts = Array.isArray(quote.productsList)
            ? { "원가표1": quote.productsList }
            : quote.productsList;
        setEditProducts(JSON.parse(JSON.stringify(initialProducts))); // 깊은 복사
        setCalcMode(quote.quote_type === 0 ? "PPC" : "DC");
        setEditNotes(JSON.parse(JSON.stringify(quote.noteList)));
        setEditProjectName(quote.project_name || "");
        setEditIsOrdered(quote.is_ordered || 0);
        setEditIsLost(quote.is_lost || 0);
        setEditStage(quote.stage !== undefined && quote.stage !== null ? quote.stage : 10);
        setEditOriginalUpdatedAt(quote.updated_at);

        // Find initial default group
        let initialDefault = "";
        for (const [groupName, prods] of Object.entries(initialProducts)) {
            if (Array.isArray(prods) && prods.length > 0 && prods[0].group_default === 1) {
                initialDefault = groupName;
                break;
            }
        }
        if (!initialDefault) {
            const keys = Object.keys(initialProducts);
            if (keys.length > 0) initialDefault = keys[0];
        }
        setEditDefaultGroup(initialDefault);
    };

    // 견적 수정 취소
    const handleCancelEdit = () => {
        setEditingQuoteId(null);
        setEditProducts({});
        setEditNotes([]);
        setEditProjectName("");
        setEditIsOrdered(0);
        setEditIsLost(0);
        setEditStage(10);
        setEditOriginalUpdatedAt(null);
        setEditDefaultGroup("");
    };



    // 견적 수정 저장
    const handleSaveEdit = (quoteId: number) => {
        // [적합성 검사]
        if (!editProjectName.trim()) {
            setToast({ message: "사업명을 입력해주세요.", type: "error" });
            return;
        }

        // [제품 목록 적합성 검사]
        let hasProduct = false;
        for (const [groupName, prods] of Object.entries(editProducts)) {
            if (Array.isArray(prods)) {
                if (prods.length > 0) {
                    hasProduct = true;
                }
                for (let i = 0; i < prods.length; i++) {
                    const p = prods[i];
                    if (!p.제품코드) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 제품코드를 선택해주세요.`, type: "error" });
                        return;
                    }
                    if (p.년차 === undefined || p.년차 === null || p.년차 === "" || Number(p.년차) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 매출년(년차)을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.매출월 === undefined || p.매출월 === null || p.매출월 === "" || Number(p.매출월) < 1 || Number(p.매출월) > 12) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 매출월을 1~12 사이로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.수량 === undefined || p.수량 === null || p.수량 === "" || Number(p.수량) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 수량을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.기간 === undefined || p.기간 === null || p.기간 === "" || Number(p.기간) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 기간을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    const stageNum = Number(p.stage);
                    if (p.stage === undefined || p.stage === null || p.stage === "" || isNaN(stageNum) || stageNum < 0 || stageNum > 100) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 영업 단계를 0% ~ 100% 사이로 입력해주세요.`, type: "error" });
                        return;
                    }
                }
            }
        }

        if (!hasProduct) {
            setToast({ message: "최소 한 개 이상의 제품 항목이 필요합니다.", type: "error" });
            return;
        }

        // 저장하기 직전에 화면에 보여지는 실시간 계산값들을 배열에 완전히 덮어씌웁니다.
        const finalProducts = getFinalProducts(editProducts, calcMode);

        // 수정 저장 시에도 빈 칸으로 남겨진 비고(Notes)를 깔끔하게 걸러냅니다.
        const finalEditNotes = editNotes
            .map((n) => n.trim())
            .filter((n) => n !== "");

        fetcher.submit(
            {
                intent: "edit",
                quoteId,
                products: finalProducts,
                calcMode,
                notes: finalEditNotes,
                projectName: editProjectName,
                isOrdered: editIsOrdered,
                isLost: editIsLost,
                stage: editStage,
                originalUpdatedAt: editOriginalUpdatedAt,
                defaultGroup: editDefaultGroup,
            },
            { method: "post", encType: "application/json" },
        );
    };

    // 견적 삭제 핸들러
    const handleDeleteQuote = (quoteId: number) => {
        if (
            window.confirm(
                "정말로 이 견적 전체를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.",
            )
        ) {
            fetcher.submit(
                { intent: "delete", quoteId },
                { method: "post", encType: "application/json" },
            );
            setEditingQuoteId(null);
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.delete(quoteId);
                return newSet;
            });
        }
    };

    // 비고 수정 핸들러
    const handleAddNote = () => setEditNotes((prev) => [...prev, ""]);
    const handleRemoveNote = (index: number) =>
        setEditNotes((prev) => prev.filter((_, i) => i !== index));
    const handleNoteChange = (index: number, value: string) => {
        setEditNotes((prev) => {
            const newNotes = [...prev];
            newNotes[index] = value;
            return newNotes;
        });
    };

    // 그룹 이름 수정 핸들러
    const handleRenameGroup = (oldName: string, newName: string) => {
        if (!newName.trim()) {
            alert("그룹 이름을 입력해주세요.");
            return;
        }
        if (oldName === newName) return;
        setEditProducts((prev) => {
            const keys = Object.keys(prev);
            if (keys.includes(newName)) {
                alert("이미 존재하는 그룹 이름입니다.");
                return prev;
            }
            const next: Record<string, any[]> = {};
            for (const key of keys) {
                if (key === oldName) {
                    next[newName] = prev[oldName];
                } else {
                    next[key] = prev[key];
                }
            }
            return next;
        });
        if (editDefaultGroup === oldName) {
            setEditDefaultGroup(newName);
        }
    };

    // 그룹 추가 핸들러
    const handleAddGroup = () => {
        setEditProducts((prev) => {
            let idx = 1;
            while (`원가표${idx}` in prev) {
                idx++;
            }
            const newGroupName = `원가표${idx}`;
            return {
                ...prev,
                [newGroupName]: [createEmptyProductRow()],
            };
        });
    };

    // 그룹 삭제 핸들러
    const handleRemoveGroup = (groupName: string) => {
        if (Object.keys(editProducts).length <= 1) {
            alert("최소 하나의 그룹은 유지해야 합니다.");
            return;
        }
        if (window.confirm(`'${groupName}' 그룹을 삭제하시겠습니까?`)) {
            setEditProducts((prev) => {
                const next = { ...prev };
                delete next[groupName];
                return next;
            });
            if (editDefaultGroup === groupName) {
                const remaining = Object.keys(editProducts).filter((k) => k !== groupName);
                if (remaining.length > 0) {
                    setEditDefaultGroup(remaining[0]);
                }
            }
        }
    };

    // quoting.tsx와 동일한 제품 편집 핸들러
    const handleProductChange = (
        groupName: string,
        index: number,
        field: string,
        value: any,
    ) => {
        setEditProducts((prev) => {
            const groupProds = prev[groupName] ? [...prev[groupName]] : [];
            const updatedProduct = { ...groupProds[index], [field]: value };

            if (field === "제품코드") {
                const matched = (loaderData.masterProducts as any[]).find(
                    (p: any) => p.code === value,
                );
                if (matched) {
                    updatedProduct.lpd = matched.lpd || 0;
                    updatedProduct.lpw = matched.lpw || 0;
                    updatedProduct.제품설명 = matched.description || "";
                }
            }

            // 역산 로직 추가 (원화PPC 또는 마진율 변경 시 DC원화 재계산)
            if (field === "원화PPC" || field === "마진율") {
                const targetDcWon = calculateReverseDCWon(field, value, updatedProduct);
                if (targetDcWon !== null) {
                    updatedProduct.DC원화 = targetDcWon;
                }
            }

            groupProds[index] = updatedProduct;
            return {
                ...prev,
                [groupName]: groupProds,
            };
        });
    };

    // quoting.tsx와 동일한 제품 추가 핸들러
    const handleAddProduct = (groupName: string) => {
        setEditProducts((prev) => ({
            ...prev,
            [groupName]: [
                ...(prev[groupName] || []),
                createEmptyProductRow(),
            ],
        }));
    };

    // quoting.tsx와 동일한 제품 삭제 핸들러
    const handleRemoveProduct = (groupName: string, index: number) => {
        setEditProducts((prev) => ({
            ...prev,
            [groupName]: (prev[groupName] || []).filter((_, i) => i !== index),
        }));
    };

    // 서버 사이드 기반의 검색 및 정렬 핸들러
    const handleSort = (key: string) => {
        const currentSortKey = searchParams.get("sortKey") || "updated_at";
        const currentSortDir = searchParams.get("sortDir") || "desc";
        const newParams = new URLSearchParams(searchParams);

        if (currentSortKey === key) {
            newParams.set("sortDir", currentSortDir === "asc" ? "desc" : "asc");
        } else {
            newParams.set("sortKey", key);
            newParams.set("sortDir", "asc");
        }
        newParams.set("page", "1"); // 정렬 시 1페이지로 리셋
        setSearchParams(newParams);
    };

    const handleFilterChange = (key: string, value: string) => {
        let currentVal = searchParams.get(key);
        if (
            currentVal === null &&
            (key === "is_ordered" || key === "is_lost")
        ) {
            currentVal = "0"; // 초기 상태일 때 내부적으로 0으로 간주
        } else if (currentVal === null) {
            currentVal = "";
        }

        if (currentVal === value) return; // 변경사항 없음

        const newParams = new URLSearchParams(searchParams);
        if (value) {
            newParams.set(key, value);
        } else {
            newParams.delete(key);
        }
        newParams.set("page", "1"); // 검색 시 1페이지로 리셋
        setSearchParams(newParams);
    };

    const currentVendorsParam = searchParams.get("vendor");
    const selectedVendors = currentVendorsParam === null
        ? ["Broadcom", "Omnissa"]
        : currentVendorsParam === "none"
            ? []
            : currentVendorsParam.split(",");

    const handleVendorFilterCheckbox = (vendorName: string, checked: boolean) => {
        let nextVendors = [...selectedVendors];
        if (checked) {
            if (!nextVendors.includes(vendorName)) {
                nextVendors.push(vendorName);
            }
        } else {
            nextVendors = nextVendors.filter((v) => v !== vendorName);
        }

        let paramValue = "";
        if (nextVendors.length === 0) {
            paramValue = "none";
        } else if (nextVendors.length === 2) {
            paramValue = "";
        } else {
            paramValue = nextVendors[0];
        }

        handleFilterChange("vendor", paramValue);
    };

    const toggleRow = (id: number) => {
        if (expandedRows.has(id)) {
            // 편집 중인 행을 접을 때 편집 상태도 안전하게 초기화합니다.
            if (editingQuoteId === id) {
                handleCancelEdit();
            }
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        } else {
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.add(id);
                return newSet;
            });
        }
    };

    // quoting.tsx와 동일한 계산 기준(calcMode) 변경 핸들러
    const handleCalcModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMode = e.target.value as "PPC" | "DC" | "MARGIN";
        setEditProducts((prev) => getFinalProducts(prev, calcMode));
        setCalcMode(newMode);
    };

    // 엑셀 출력 버튼 클릭 핸들러
    const handleExportExcel = () => {
        const queryString = searchParams.toString();
        window.location.href = `/api/home/download?${queryString}`;
    };

    // 원가표/견적서 엑셀 다운로드 (개별 견적)
    const downloadFile = async (
        type: string,
        filename: string,
        productsData: any[] | Record<string, any[]>,
        quoteInfo: any,
        projectName: string,
    ) => {
        const response = await fetch(`/api/download?type=${type}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                products: productsData,
                partnerCompany: quoteInfo.partner_company,
                partnerName: quoteInfo.partner_contact_name,
                clientCompany: quoteInfo.client_company,
                projectName: projectName,
            }),
        });

        if (!response.ok) {
            throw new Error(`${filename} 다운로드 실패`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const handleDownloadExcel = async (
        quote: any,
        productsData: any[] | Record<string, any[]>,
        currentProjectName: string,
    ) => {
        const grouped = Array.isArray(productsData)
            ? { "원가표": productsData }
            : productsData;

        const totalProductsCount = Object.values(grouped).reduce((sum, prods) => sum + (prods?.length || 0), 0);
        if (totalProductsCount === 0) {
            alert("다운로드할 제품이 없습니다.");
            return;
        }

        try {
            const now = new Date();
            const kstDateString = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(now);
            const [yyyy, mm, dd] = kstDateString.split("-");
            const dateStr = `${yyyy.slice(2)}${mm}${dd}`;

            const prefix = [
                quote.partner_company?.trim(),
                quote.partner_contact_name?.trim(),
                quote.client_company?.trim(),
                currentProjectName?.trim(),
                dateStr,
            ]
                .filter(Boolean)
                .join("-");

            const finalGroupedProducts = getFinalProducts(grouped, quote.quote_type === 0 ? "PPC" : "DC");

            await Promise.all([
                downloadFile(
                    "cost",
                    `${prefix}-원가표.xlsx`,
                    finalGroupedProducts,
                    quote,
                    currentProjectName,
                ),
                downloadFile(
                    "quote",
                    `${prefix}-견적서.xlsx`,
                    finalGroupedProducts,
                    quote,
                    currentProjectName,
                ),
            ]);
        } catch (error) {
            console.error(error);
            alert("엑셀 다운로드 중 오류가 발생했습니다.");
        }
    };

    const renderTh = (
        label: string,
        columnKey: string,
        options: {
            sortable?: boolean;
            searchable?: boolean;
            className?: string;
        } = {},
    ) => {
        const { sortable = true, searchable = true, className = "" } = options;
        const currentSortKey = searchParams.get("sortKey") || "updated_at";
        const currentSortDir = searchParams.get("sortDir") || "desc";
        const isSorted = currentSortKey === columnKey;
        const filterValue = searchParams.get(columnKey) || "";

        return (
            <th key={columnKey} className={`p-3 align-top ${className}`}>
                <div
                    className={`flex items-center justify-between font-semibold select-none mb-2 ${sortable
                        ? "cursor-pointer group hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        : ""
                        }`}
                    onClick={() => sortable && handleSort(columnKey)}
                >
                    <span>{label}</span>
                    {sortable &&
                        (isSorted ? (
                            <span className="ml-1 text-blue-500 text-right flex items-center">
                                {currentSortDir === "desc" ? (
                                    <ChevronDown className="w-4 h-4" />
                                ) : (
                                    <ChevronUp className="w-4 h-4" />
                                )}
                            </span>
                        ) : (
                            <span className="ml-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-right flex items-center">
                                <ChevronsUpDown className="w-4 h-4" />
                            </span>
                        ))}
                </div>
                {searchable && (
                    <input
                        key={`filter-${columnKey}-${filterValue}`}
                        type="text"
                        defaultValue={filterValue}
                        onBlur={(e) =>
                            handleFilterChange(columnKey, e.target.value)
                        }
                        onKeyDown={(e) => {
                            if (e.key === "Enter")
                                handleFilterChange(
                                    columnKey,
                                    e.currentTarget.value,
                                );
                        }}
                        placeholder={`${label} 검색`}
                        className="w-full text-xs font-normal px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-500"
                    />
                )}
            </th>
        );
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 목록
            </h1>

            {/* 상단 필터 영역 (사이드바 대체) */}
            <div className="mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center">
                        <Search className="w-4 h-4 mr-1.5 text-gray-500" /> 상태
                        필터
                    </span>
                    <select
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 transition-shadow"
                        value={searchParams.get("is_ordered") ?? "0"}
                        onChange={(e) =>
                            handleFilterChange("is_ordered", e.target.value)
                        }
                    >
                        <option value="all">오더 전체</option>
                        <option value="1">오더 완료</option>
                        <option value="0">미오더</option>
                    </select>
                    <select
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 transition-shadow"
                        value={searchParams.get("is_lost") ?? "0"}
                        onChange={(e) =>
                            handleFilterChange("is_lost", e.target.value)
                        }
                    >
                        <option value="all">실주 전체</option>
                        <option value="1">실주</option>
                        <option value="0">진행중</option>
                    </select>
                </div>

                <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>

                <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center">
                        <Calendar className="w-4 h-4 mr-1.5 text-gray-500" />{" "}
                        견적날짜 필터
                    </span>
                    <select
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 transition-shadow"
                        value={searchParams.get("created_year") || ""}
                        onChange={(e) =>
                            handleFilterChange("created_year", e.target.value)
                        }
                    >
                        <option value="">연도 전체</option>
                        {years.map((y) => (
                            <option key={y} value={y}>
                                {y}년
                            </option>
                        ))}
                    </select>
                    <select
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 transition-shadow"
                        value={searchParams.get("created_month") || ""}
                        onChange={(e) =>
                            handleFilterChange("created_month", e.target.value)
                        }
                    >
                        <option value="">월 전체</option>
                        {months.map((m) => (
                            <option key={m} value={m}>
                                {m}월
                            </option>
                        ))}
                    </select>
                </div>

                <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>

                <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center">
                        <Tag className="w-4 h-4 mr-1.5 text-gray-500" /> 벤더 필터
                    </span>
                    <div className="flex gap-4 items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={selectedVendors.includes("Broadcom")}
                                onChange={(e) => handleVendorFilterCheckbox("Broadcom", e.target.checked)}
                                className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Broadcom</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={selectedVendors.includes("Omnissa")}
                                onChange={(e) => handleVendorFilterCheckbox("Omnissa", e.target.checked)}
                                className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Omnissa</span>
                        </label>
                    </div>
                </div>

                {/* 출력하기 버튼 (가장 우측으로 밀기 위해 ml-auto 사용) */}
                <div className="ml-auto">
                    <button
                        onClick={handleExportExcel}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2 shadow"
                    >
                        <Download className="w-4 h-4 mr-1.5" /> 출력하기
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="overflow-auto max-h-[calc(100vh-250px)] rounded-t-lg">
                    <table className="w-full text-left border-collapse relative table-fixed">
                        <thead className="sticky top-0 z-20 bg-gray-100 dark:bg-gray-700 shadow-[0_1px_0_0_#e5e7eb] dark:shadow-[0_1px_0_0_#4b5563]">
                            <tr className="text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                                {renderTh("고객사", "client_company", {
                                    className: "w-[12%]",
                                })}
                                {renderTh("파트너사", "partner_company", {
                                    className: "w-[12%]",
                                })}
                                {renderTh("담당자", "partner_contact_name", {
                                    className: "w-[10%]",
                                })}
                                {renderTh("총판", "dist_contact_name", {
                                    className: "w-[8%]",
                                })}
                                {renderTh("사업명", "project_name", {
                                    className: "w-[20%]",
                                })}
                                {renderTh("단계", "stage", {
                                    sortable: false,
                                    searchable: false,
                                    className: "w-[6%] whitespace-nowrap",
                                })}
                                {renderTh("총 공급가", "totalSupplyPrice", {
                                    sortable: false,
                                    searchable: false,
                                    className: "w-[10%] whitespace-nowrap",
                                })}
                                {renderTh("견적날짜", "created_at", {
                                    sortable: true,
                                    searchable: false,
                                    className: "w-[10%] whitespace-nowrap",
                                })}
                                {renderTh("마지막 수정날짜", "updated_at", {
                                    sortable: true,
                                    searchable: false,
                                    className: "w-[12%] whitespace-nowrap",
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {loaderData.quotes.map((quote: any) => (
                                <Fragment key={quote.id}>
                                    <tr
                                        className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 cursor-pointer divide-x divide-gray-200 dark:divide-gray-700"
                                        onClick={() => toggleRow(quote.id)}
                                    >
                                        <td className="p-4 truncate" title={quote.client_company}>
                                            {quote.client_company}
                                        </td>
                                        <td className="p-4 truncate" title={quote.partner_company}>
                                            {quote.partner_company}
                                        </td>
                                        <td className="p-4 truncate" title={quote.partner_contact_name}>
                                            {quote.partner_contact_name}
                                        </td>
                                        <td className="p-4 truncate" title={quote.dist_contact_name}>
                                            {quote.dist_contact_name}
                                        </td>
                                        <td className="p-4 truncate" title={quote.project_name}>
                                            {quote.project_name}
                                        </td>
                                        <td className="p-4 truncate">
                                            {quote.stage !== undefined && quote.stage !== null ? `${quote.stage}%` : "-"}
                                        </td>
                                        <td className="p-4 font-medium truncate">
                                            {quote.totalSupplyPrice.toLocaleString()}원
                                        </td>
                                        <td className="p-4 truncate">
                                            {quote.createdAtDate}
                                        </td>
                                        <td className="p-4 truncate">
                                            {quote.updatedAtDate}
                                        </td>
                                    </tr>
                                    {/* 펼쳐진 영역 상세 내용 */}
                                    {expandedRows.has(quote.id) && (
                                        <tr className="no-hover bg-slate-50/50 dark:bg-slate-900/30 border-y border-gray-200 dark:border-gray-700 shadow-inner">
                                            <td colSpan={9} className="p-6">
                                                <div className="space-y-6">
                                                    {/* 0. 담당자 및 영업 요약 정보 */}
                                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-white dark:bg-gray-800 p-5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                                                        <div>
                                                            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                                <Building2 className="w-4 h-4 mr-2 text-gray-500" />
                                                                고객사 담당자
                                                            </h4>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                                                                <p>
                                                                    이름:{" "}
                                                                    {quote.client_contact_name ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    이메일:{" "}
                                                                    {quote.client_contact_email ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    연락처:{" "}
                                                                    {quote.client_contact_phone ||
                                                                        ""}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                                <Users className="w-4 h-4 mr-2 text-gray-500" />
                                                                파트너사 담당자
                                                            </h4>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                                                                <p>
                                                                    이름:{" "}
                                                                    {quote.partner_contact_name ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    이메일:{" "}
                                                                    {quote.partner_contact_email ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    연락처:{" "}
                                                                    {quote.partner_contact_phone ||
                                                                        ""}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                                <UserCircle className="w-4 h-4 mr-2 text-gray-500" />
                                                                영업 정보
                                                            </h4>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                                                                <p>
                                                                    총판 담당자:{" "}
                                                                    {quote.dist_contact_name ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    AM 이름:{" "}
                                                                    {quote.am_name ||
                                                                        ""}
                                                                </p>
                                                                <p>
                                                                    계약방식:{" "}
                                                                    {quote.contract_type ||
                                                                        ""}
                                                                </p>
                                                                <p className="flex flex-wrap gap-1">
                                                                    Deal Flow:{" "}
                                                                    <span className="text-blue-600 dark:text-blue-400 font-medium break-all">
                                                                        {quote.dealFlowList?.join(
                                                                            " ➔ ",
                                                                        ) || ""}
                                                                    </span>
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                                <ClipboardList className="w-4 h-4 mr-2 text-gray-500" />
                                                                사업 정보
                                                            </h4>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                                                {editingQuoteId ===
                                                                    quote.id ? (
                                                                    <>
                                                                        <div className="flex flex-col gap-1">
                                                                            <label className="text-xs font-medium text-gray-500">
                                                                                사업명
                                                                            </label>
                                                                            <input
                                                                                type="text"
                                                                                value={
                                                                                    editProjectName
                                                                                }
                                                                                onChange={(
                                                                                    e,
                                                                                ) =>
                                                                                    setEditProjectName(
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                    )
                                                                                }
                                                                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                                                                            />
                                                                        </div>
                                                                        <div className="flex flex-col gap-1 mt-1">
                                                                            <label className="text-xs font-medium text-gray-500">
                                                                                단계 (%)
                                                                            </label>
                                                                            <input
                                                                                type="number"
                                                                                value={editStage}
                                                                                onFocus={(e) => {
                                                                                    prevStageValRef.current = Number(e.target.value) || 10;
                                                                                }}
                                                                                onChange={(e) => setEditStage(Number(e.target.value) || 0)}
                                                                                onBlur={(e) => {
                                                                                    const newVal = Number(e.target.value) || 0;
                                                                                    if (newVal === prevStageValRef.current) return;
                                                                                    const success = updateAllProductsStage(newVal);
                                                                                    if (!success) {
                                                                                        setEditStage(prevStageValRef.current);
                                                                                    }
                                                                                }}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === "Enter") {
                                                                                        e.currentTarget.blur();
                                                                                    }
                                                                                }}
                                                                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                                                                            />
                                                                        </div>
                                                                        <div className="flex items-center gap-4 mt-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <label className="text-xs font-medium text-gray-500">
                                                                                    오더여부
                                                                                </label>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={
                                                                                        editIsOrdered ===
                                                                                        1
                                                                                    }
                                                                                    onChange={(
                                                                                        e,
                                                                                    ) =>
                                                                                        setEditIsOrdered(
                                                                                            e
                                                                                                .target
                                                                                                .checked
                                                                                                ? 1
                                                                                                : 0,
                                                                                        )
                                                                                    }
                                                                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 transition-colors"
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <label className="text-xs font-medium text-gray-500">
                                                                                    실주여부
                                                                                </label>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={
                                                                                        editIsLost ===
                                                                                        1
                                                                                    }
                                                                                    onChange={(
                                                                                        e,
                                                                                    ) =>
                                                                                        setEditIsLost(
                                                                                            e
                                                                                                .target
                                                                                                .checked
                                                                                                ? 1
                                                                                                : 0,
                                                                                        )
                                                                                    }
                                                                                    className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 transition-colors"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <p>
                                                                            사업명:{" "}
                                                                            {quote.project_name ||
                                                                                ""}
                                                                        </p>
                                                                        <p>
                                                                            단계: {quote.stage !== undefined && quote.stage !== null ? `${quote.stage}%` : "-"}
                                                                        </p>
                                                                        <div className="flex items-center gap-4 mt-1">
                                                                            <div className="flex items-center gap-2">
                                                                                <span>
                                                                                    오더여부:
                                                                                </span>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={
                                                                                        quote.is_ordered ===
                                                                                        1
                                                                                    }
                                                                                    readOnly
                                                                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 cursor-not-allowed"
                                                                                />
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span>
                                                                                    실주여부:
                                                                                </span>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={
                                                                                        quote.is_lost ===
                                                                                        1
                                                                                    }
                                                                                    readOnly
                                                                                    className="w-4 h-4 text-red-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 cursor-not-allowed"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 1. 제품 상세 테이블 */}
                                                    <div className="space-y-6">
                                                        <div className="bg-white dark:bg-gray-800 p-5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                                                            <div className="flex justify-between items-center">
                                                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                                                                    <Package className="w-5 h-5 mr-2 text-gray-500" />
                                                                    제품 상세 목록 설정
                                                                </h3>
                                                                <div className="flex items-center gap-4">
                                                                    {editingQuoteId === quote.id ? (
                                                                        <>
                                                                            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded border border-gray-200 dark:border-gray-600">
                                                                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 ml-2">
                                                                                    계산 기준:
                                                                                </span>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="PPC"
                                                                                        checked={calcMode === "PPC"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">PPC</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="DC"
                                                                                        checked={calcMode === "DC"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">DC원화</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="MARGIN"
                                                                                        checked={calcMode === "MARGIN"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">마진</span>
                                                                                </label>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleAddGroup}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 h-8 px-3 border border-blue-200 dark:border-blue-800"
                                                                            >
                                                                                <Plus className="w-4 h-4 mr-1" /> 그룹 추가
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleSaveEdit(quote.id)}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-600 text-white hover:bg-green-700 h-8 px-3 shadow"
                                                                            >
                                                                                <Save className="w-4 h-4 mr-1.5" /> 저장
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleDeleteQuote(quote.id)}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 bg-red-600 text-white hover:bg-red-700 h-8 px-3 shadow"
                                                                            >
                                                                                <Trash2 className="w-4 h-4 mr-1.5" /> 삭제
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleCancelEdit}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-3"
                                                                            >
                                                                                <X className="w-4 h-4 mr-1.5" /> 취소
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        <div className="flex gap-2">
                                                                            <Link
                                                                                to={`/history/${quote.id}`}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-blue-600 hover:bg-blue-50 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-3 shadow-sm"
                                                                            >
                                                                                기록보기
                                                                            </Link>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleEditClick(quote)}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-4 shadow-sm"
                                                                            >
                                                                                수정
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {Object.entries(
                                                            editingQuoteId === quote.id
                                                                ? editProducts
                                                                : (Array.isArray(quote.productsList)
                                                                    ? { "원가표1": quote.productsList }
                                                                    : quote.productsList)
                                                        ).map(([groupName, groupProducts]) => {
                                                            const isEditing = editingQuoteId === quote.id;
                                                            const currentMode = isEditing
                                                                ? calcMode
                                                                : (quote.quote_type === 0 ? "PPC" : "DC");
                                                            const finalProds = getFinalProducts(groupProducts as any[], currentMode) as any[];

                                                            const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                                                            const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                                                            const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                                                            return (
                                                                <div key={groupName} className="bg-white dark:bg-gray-800 p-5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
                                                                    <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3">
                                                                        <div className="flex items-center gap-4 w-1/2">
                                                                            {isEditing ? (
                                                                                <>
                                                                                    <div className="w-52">
                                                                                        <GroupNameInput value={groupName} onRename={(newName) => handleRenameGroup(groupName, newName)} />
                                                                                    </div>
                                                                                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                                                                        <input
                                                                                            type="radio"
                                                                                            name={`defaultGroupSelection-${quote.id}`}
                                                                                            checked={editDefaultGroup === groupName}
                                                                                            onChange={() => setEditDefaultGroup(groupName)}
                                                                                            className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                                                                        />
                                                                                        <span className="font-semibold text-gray-700 dark:text-gray-300">기본 원가표</span>
                                                                                    </label>
                                                                                </>
                                                                            ) : (
                                                                                <div className="flex items-center gap-3">
                                                                                    <h4 className="font-bold text-gray-800 dark:text-gray-200 text-lg">
                                                                                        {groupName}
                                                                                    </h4>
                                                                                    {(groupProducts as any[]).length > 0 && ((groupProducts as any[])[0] as any).group_default === 1 && (
                                                                                        <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/10 dark:ring-blue-400/20">
                                                                                            기본
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-6">
                                                                            <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-4">
                                                                                <span>공급가 합계: <strong className="text-gray-800 dark:text-gray-200">₩{groupTotalSupply.toLocaleString()}</strong></span>
                                                                                <span>마진 합계: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                                                            </div>
                                                                            {isEditing && (
                                                                                <div className="flex gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleAddProduct(groupName)}
                                                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                                                                    >
                                                                                        <Plus className="w-3.5 h-3.5 mr-1" /> 제품 추가
                                                                                    </button>
                                                                                    {Object.keys(editProducts).length > 1 && (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => handleRemoveGroup(groupName)}
                                                                                            className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 h-8 px-2.5"
                                                                                            title="그룹 삭제"
                                                                                        >
                                                                                            <Trash2 className="w-4 h-4 mr-1" /> 그룹 삭제
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {(groupProducts as any[]).length === 0 ? (
                                                                        <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                                                                            추가된 제품이 없습니다.
                                                                        </div>
                                                                    ) : (
                                                                        <ProductTable
                                                                            rawProducts={groupProducts as any[]}
                                                                            finalProducts={finalProds}
                                                                            isEditable={isEditing}
                                                                            calcMode={currentMode}
                                                                            masterProducts={loaderData.masterProducts}
                                                                            vendorFilter={quote.vendor}
                                                                            onChangeProduct={(idx, field, value) => handleProductChange(groupName, idx, field, value)}
                                                                            onRemoveProduct={(idx) => handleRemoveProduct(groupName, idx)}
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}

                                                        {/* 원가표/견적서 다운로드 버튼 (오른쪽 아래) */}
                                                        <div className="flex justify-end mt-4">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDownloadExcel(
                                                                        quote,
                                                                        editingQuoteId === quote.id
                                                                            ? editProducts
                                                                            : quote.productsList,
                                                                        editingQuoteId === quote.id
                                                                            ? editProjectName
                                                                            : quote.project_name,
                                                                    )
                                                                }
                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-white text-green-600 border border-green-600 hover:bg-green-50 dark:bg-gray-800 dark:text-green-400 dark:border-green-500 dark:hover:bg-green-900/30 h-9 px-4 shadow-sm"
                                                            >
                                                                <Download className="w-4 h-4 mr-1.5" />{" "}
                                                                다운로드 (Excel)
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* 2. 비고 리스트 */}
                                                    {(editingQuoteId ===
                                                        quote.id ||
                                                        (quote.noteList &&
                                                            quote.noteList
                                                                .length >
                                                            0)) && (
                                                            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                                                                <div className="flex justify-between items-center mb-4">
                                                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                                                                        <FileText className="w-5 h-5 mr-2 text-gray-500" />
                                                                        비고
                                                                    </h3>
                                                                    {editingQuoteId ===
                                                                        quote.id && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={
                                                                                    handleAddNote
                                                                                }
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 h-8 px-3 shadow-sm"
                                                                            >
                                                                                <Plus className="w-4 h-4 mr-1" />{" "}
                                                                                비고
                                                                                추가
                                                                            </button>
                                                                        )}
                                                                </div>

                                                                {editingQuoteId ===
                                                                    quote.id ? (
                                                                    <div className="space-y-2">
                                                                        {editNotes.map(
                                                                            (
                                                                                note,
                                                                                idx,
                                                                            ) => (
                                                                                <div
                                                                                    key={
                                                                                        idx
                                                                                    }
                                                                                    className="flex items-start gap-2"
                                                                                >
                                                                                    <span className="text-gray-400 mt-2 text-sm">
                                                                                        •
                                                                                    </span>
                                                                                    <textarea
                                                                                        value={
                                                                                            note
                                                                                        }
                                                                                        onChange={(
                                                                                            e,
                                                                                        ) =>
                                                                                            handleNoteChange(
                                                                                                idx,
                                                                                                e
                                                                                                    .target
                                                                                                    .value,
                                                                                            )
                                                                                        }
                                                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow min-h-[40px] resize-y"
                                                                                        placeholder="비고 내용을 입력하세요"
                                                                                    />
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            handleRemoveNote(
                                                                                                idx,
                                                                                            )
                                                                                        }
                                                                                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 w-8 h-8 mt-1"
                                                                                    >
                                                                                        <Trash2 className="w-4 h-4" />
                                                                                    </button>
                                                                                </div>
                                                                            ),
                                                                        )}
                                                                        {editNotes.length ===
                                                                            0 && (
                                                                                <div className="text-center text-gray-500 dark:text-gray-400 py-6 border border-dashed border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50">
                                                                                    추가된
                                                                                    비고가
                                                                                    없습니다.
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                ) : (
                                                                    <ul className="list-disc pl-5 text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                                                                        {quote.noteList.map(
                                                                            (
                                                                                noteText: string,
                                                                                idx: number,
                                                                            ) => (
                                                                                <li
                                                                                    key={
                                                                                        idx
                                                                                    }
                                                                                    className="whitespace-pre-wrap leading-relaxed"
                                                                                >
                                                                                    {
                                                                                        noteText
                                                                                    }
                                                                                </li>
                                                                            ),
                                                                        )}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* 페이지네이션 컨트롤러 */}
                <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg border-t dark:border-gray-600">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        총{" "}
                        <span className="font-bold">
                            {loaderData.pagination.total}
                        </span>
                        건
                    </div>
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={() => {
                                const newParams = new URLSearchParams(
                                    searchParams,
                                );
                                newParams.set(
                                    "page",
                                    String(loaderData.pagination.page - 1),
                                );
                                setSearchParams(newParams);
                            }}
                            disabled={loaderData.pagination.page <= 1}
                            className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            이전
                        </button>
                        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                            {loaderData.pagination.page} /{" "}
                            {loaderData.pagination.totalPages}
                        </span>
                        <button
                            onClick={() => {
                                const newParams = new URLSearchParams(
                                    searchParams,
                                );
                                newParams.set(
                                    "page",
                                    String(loaderData.pagination.page + 1),
                                );
                                setSearchParams(newParams);
                            }}
                            disabled={
                                loaderData.pagination.page >=
                                loaderData.pagination.totalPages
                            }
                            className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            다음
                        </button>
                    </div>
                </div>
            </div>

            {/* 자체 구현한 트렌디한 Toast 컴포넌트 */}
            {toast && (
                <div
                    className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-lg shadow-xl border ${toast.type === "error" ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200" : "bg-gray-900 border-gray-800 text-white dark:bg-gray-100 dark:border-gray-200 dark:text-gray-900"} transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in`}
                >
                    {toast.type === "error" ? (
                        <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
                    ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-400 dark:text-green-600" />
                    )}
                    <p className="text-sm font-medium">{toast.message}</p>
                </div>
            )}
        </div>
    );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    return (
        <div className="p-4 bg-red-100 text-red-700 border border-red-400 rounded max-w-2xl mx-auto mt-10">
            <h2 className="text-xl font-bold">오류가 발생했습니다!</h2>
            <p>Home 페이지를 처리하는 중 문제가 생겼습니다.</p>
        </div>
    );
}
0;
