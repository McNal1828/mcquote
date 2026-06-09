import { useState, Fragment } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/home";
import db from "../db.server";
import { useTableFeatures } from "./useTableFeatures";

export const handle = {
    breadcrumb: () => "홈페이지",
};

export const links: Route.LinksFunction = () => [
    // 예: { rel: "stylesheet", href: "/styles/home-custom.css" }
];

export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return {
        // "Cache-Control": "max-age=3600, s-maxage=3600",
    };
}

export function meta({}: Route.MetaArgs) {
    return [
        { title: "견적관리" },
        { name: "description", content: "McNal의 견적관리 프로젝트" },
    ];
}

export async function action({ request }: Route.ActionArgs) {
    const data = await request.json();
    const {
        quoteId,
        products,
        calcMode,
        notes,
        projectName,
        isOrdered,
        isLost,
    } = data;
    const quote_type = calcMode === "PPC" ? 0 : 1;
    const now = Date.now();

    try {
        const stmt = db.prepare(`
            UPDATE quotes 
            SET products = ?, quote_type = ?, note = ?, project_name = ?, is_ordered = ?, is_lost = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.run(
            JSON.stringify(products),
            quote_type,
            JSON.stringify(notes),
            projectName,
            isOrdered,
            isLost,
            now,
            quoteId,
        );
        return { success: true };
    } catch (error) {
        return { error: "업데이트 중 오류가 발생했습니다." };
    }
}

export async function loader({ request }: Route.LoaderArgs) {
    // quotes 테이블을 중심으로 partners, partner_contacts 테이블을 JOIN하여 필요한 데이터를 가져옵니다.
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
            q.project_name,
            q.products,
            q.created_at,
            q.updated_at,
            q.stage,
            q.note,
            a.name as am_name,
            q.deal_flow,
            q.expected_quarter,
            q.contract_type,
            q.quote_type,
            q.is_ordered,
            q.is_lost
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN ams a ON q.am_id = a.id
        ORDER BY q.updated_at DESC
    `);

    const rawQuotes = stmt.all() as any[];

    // 화면에 보여주기 좋게 데이터를 가공합니다.
    const quotes = rawQuotes.map((row) => {
        let totalSupplyPrice = 0;
        let productsList = [];
        let noteList = [];
        let dealFlowList = [];

        // 1-1. JSON 형식인 제품 정보에서 공급가의 합계를 구합니다.
        try {
            productsList = JSON.parse(row.products || "[]");
            totalSupplyPrice = productsList.reduce(
                (sum: number, product: any) => sum + (product.공급가 || 0),
                0,
            );
        } catch (e) {
            console.error("제품 정보 JSON 파싱 실패:", e);
        }

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
            project_name: row.project_name,
            stage: row.stage,
            totalSupplyPrice, // 계산된 총 공급가
            productsList, // 펼쳤을 때 보여줄 제품 목록 원본 데이터
            noteList, // 펼쳤을 때 역순으로 보여줄 비고 리스트
            am_name: row.am_name,
            dealFlowList, // 화살표로 연결하여 보여줄 deal flow 리스트
            expected_quarter: row.expected_quarter,
            contract_type: row.contract_type,
            quote_type: row.quote_type, // PPC(0) or DC/MARGIN(1)
            is_ordered: row.is_ordered,
            is_lost: row.is_lost,
            created_at: row.created_at,
            createdAtDate: new Date(row.created_at).toLocaleDateString("ko-KR"),
            updated_at: row.updated_at, // 정렬 처리를 위한 원본 데이터 보존
            updatedAtDate: new Date(row.updated_at).toLocaleDateString("ko-KR"), // 타임스탬프를 YYYY. MM. DD. 형식으로 변환
        };
    });

    // 제품 자동완성 및 정보 불러오기를 위한 마스터 데이터
    const productsStmt = db.prepare(
        "SELECT code, description, lpd, lpw FROM products",
    );
    const masterProducts = productsStmt.all();

    return { quotes, masterProducts };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    const fetcher = useFetcher();

    // 펼쳐진 행(Row) 상태 관리
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    // 편집 모드 상태 관리 (quoting.tsx 로직 통일)
    const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
    const [editProducts, setEditProducts] = useState<any[]>([]);
    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN">("DC");
    const [editNotes, setEditNotes] = useState<string[]>([]);
    const [editProjectName, setEditProjectName] = useState<string>("");
    const [editIsOrdered, setEditIsOrdered] = useState<number>(0);
    const [editIsLost, setEditIsLost] = useState<number>(0);

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
        setEditProducts(JSON.parse(JSON.stringify(quote.productsList))); // 깊은 복사
        setCalcMode(quote.quote_type === 0 ? "PPC" : "DC");
        setEditNotes(JSON.parse(JSON.stringify(quote.noteList)));
        setEditProjectName(quote.project_name || "");
        setEditIsOrdered(quote.is_ordered || 0);
        setEditIsLost(quote.is_lost || 0);
    };

    // 견적 수정 취소
    const handleCancelEdit = () => {
        setEditingQuoteId(null);
        setEditProducts([]);
        setEditNotes([]);
        setEditProjectName("");
        setEditIsOrdered(0);
        setEditIsLost(0);
    };

    // 견적 수정 저장
    const handleSaveEdit = (quoteId: number) => {
        // 저장하기 직전에 화면에 보여지는 실시간 계산값들을 배열에 완전히 덮어씌웁니다.
        const finalProducts = editProducts.map((prod) => {
            const lpd = Number(prod.lpd) || 0;
            const lpw = Number(prod.lpw) || 0;
            const qty = Number(prod.수량) || 0;
            const period = Number(prod.기간) || 0;
            const dcDollar = Number(prod.DC달러) || 0;
            const exchangeRate = Number(prod.환율) || 0;
            const dcWon = Number(prod.DC원화) || 0;

            const dollarPpc = lpd * (1 - dcDollar / 100);
            const dollarCost = lpd * qty * period;
            const dollarNet = dollarPpc * qty * period;
            const wonNet = dollarNet * exchangeRate;

            let supplyPrice =
                Math.round((lpw * qty * period * (1 - dcWon / 100)) / 1000) *
                1000;

            if (calcMode === "PPC" && prod.원화PPC !== undefined) {
                supplyPrice = Number(prod.원화PPC) * qty * period;
            } else if (calcMode === "MARGIN" && prod.마진율 !== undefined) {
                const inputMarginPercent = Number(prod.마진율);
                supplyPrice =
                    inputMarginPercent < 100
                        ? Math.round(
                              wonNet / (1 - inputMarginPercent / 100) / 1000,
                          ) * 1000
                        : 0;
            }

            const wonPpc = qty * period > 0 ? supplyPrice / (qty * period) : 0;
            const margin = supplyPrice - wonNet;
            const marginPercent = supplyPrice
                ? ((margin / supplyPrice) * 100).toFixed(1)
                : "0.0";

            return {
                ...prod,
                달러원가: dollarCost,
                달러net: dollarNet,
                공급가: supplyPrice,
                마진: margin,
                원화PPC:
                    calcMode === "PPC"
                        ? prod.원화PPC !== undefined
                            ? prod.원화PPC
                            : Math.round(wonPpc)
                        : Math.round(wonPpc),
                마진율:
                    calcMode === "MARGIN"
                        ? prod.마진율 !== undefined
                            ? prod.마진율
                            : marginPercent
                        : marginPercent,
            };
        });

        fetcher.submit(
            {
                quoteId,
                products: finalProducts,
                calcMode,
                notes: editNotes,
                projectName: editProjectName,
                isOrdered: editIsOrdered,
                isLost: editIsLost,
            },
            { method: "post", encType: "application/json" },
        );
        setEditingQuoteId(null);
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

    // quoting.tsx와 동일한 제품 편집 핸들러
    const handleProductChange = (index: number, field: string, value: any) => {
        setEditProducts((prev) => {
            const newProducts = [...prev];
            const updatedProduct = { ...newProducts[index], [field]: value };

            if (field === "제품코드") {
                const matched = loaderData.masterProducts.find(
                    (p: any) => p.code === value,
                );
                if (matched) {
                    updatedProduct.lpd = matched.lpd || 0;
                    updatedProduct.lpw = matched.lpw || 0;
                    updatedProduct.제품설명 = matched.description || "";
                }
            }

            if (field === "원화PPC" || field === "마진율") {
                const lpd = Number(updatedProduct.lpd) || 0;
                const lpw = Number(updatedProduct.lpw) || 0;
                const qty = Number(updatedProduct.수량) || 0;
                const period = Number(updatedProduct.기간) || 0;
                const dcDollar = Number(updatedProduct.DC달러) || 0;
                const exchangeRate = Number(updatedProduct.환율) || 0;
                const baseTotalLpw = lpw * qty * period;

                if (baseTotalLpw > 0) {
                    let targetSupply: number | null = null;
                    if (field === "원화PPC") {
                        targetSupply = (Number(value) || 0) * qty * period;
                    } else if (field === "마진율") {
                        const inputMarginPercent = Number(value) || 0;
                        if (inputMarginPercent < 100) {
                            const dollarPpc = lpd * (1 - dcDollar / 100);
                            const wonNet =
                                dollarPpc * qty * period * exchangeRate;
                            targetSupply =
                                Math.round(
                                    wonNet /
                                        (1 - inputMarginPercent / 100) /
                                        1000,
                                ) * 1000;
                        }
                    }
                    if (targetSupply !== null) {
                        const rawDcWon =
                            (1 - targetSupply / baseTotalLpw) * 100;
                        updatedProduct.DC원화 =
                            Math.trunc(rawDcWon * 100) / 100;
                    }
                }
            }

            newProducts[index] = updatedProduct;
            return newProducts;
        });
    };

    // quoting.tsx와 동일한 제품 추가/삭제 핸들러
    const handleAddProduct = () => {
        setEditProducts((prev) => [
            ...prev,
            {
                제품코드: "",
                제품설명: "",
                lpd: 0,
                lpw: 0,
                수량: 1,
                기간: 1,
                DC달러: 0,
                환율: 0,
                DC원화: 0,
                공급가: 0,
                마진: 0,
                년차: 1,
                원화PPC: 0,
                마진율: "0.0",
            },
        ]);
    };

    const handleRemoveProduct = (index: number) => {
        setEditProducts((prev) => prev.filter((_, i) => i !== index));
    };

    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: loaderData.quotes,
        filterFormatters: {
            created_at: (_, row) => row.createdAtDate,
            updated_at: (_, row) => row.updatedAtDate,
        },
    });

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

        setEditProducts((prev) =>
            prev.map((prod) => {
                const lpd = Number(prod.lpd) || 0;
                const lpw = Number(prod.lpw) || 0;
                const qty = Number(prod.수량) || 0;
                const period = Number(prod.기간) || 0;
                const dcDollar = Number(prod.DC달러) || 0;
                const exchangeRate = Number(prod.환율) || 0;
                const dcWon = Number(prod.DC원화) || 0;

                const dollarPpc = lpd * (1 - dcDollar / 100);
                const wonNet = dollarPpc * qty * period * exchangeRate;

                let supplyPrice =
                    Math.round(
                        (lpw * qty * period * (1 - dcWon / 100)) / 1000,
                    ) * 1000;

                if (calcMode === "PPC" && (prod as any).원화PPC !== undefined) {
                    supplyPrice = Number((prod as any).원화PPC) * qty * period;
                } else if (
                    calcMode === "MARGIN" &&
                    (prod as any).마진율 !== undefined
                ) {
                    const inputMarginPercent = Number((prod as any).마진율);
                    supplyPrice =
                        inputMarginPercent < 100
                            ? Math.round(
                                  wonNet /
                                      (1 - inputMarginPercent / 100) /
                                      1000,
                              ) * 1000
                            : 0;
                }

                let currentWonPpc =
                    qty * period > 0 ? supplyPrice / (qty * period) : 0;
                if (newMode === "PPC") {
                    currentWonPpc = Math.round(currentWonPpc);
                    supplyPrice = currentWonPpc * qty * period;
                }

                const currentMargin = supplyPrice - wonNet;
                const currentMarginPercent = supplyPrice
                    ? ((currentMargin / supplyPrice) * 100).toFixed(1)
                    : "0.0";
                const rawDcWon =
                    lpw * qty * period > 0
                        ? (1 - supplyPrice / (lpw * qty * period)) * 100
                        : dcWon;

                return {
                    ...prod,
                    원화PPC: currentWonPpc,
                    마진율: currentMarginPercent,
                    DC원화: Math.trunc(rawDcWon * 100) / 100,
                };
            }),
        );
        setCalcMode(newMode);
    };

    const renderTh = (label: string, sortKey: string) => {
        const ruleIndex = sortRules.findIndex((rule) => rule.key === sortKey);
        const isSorted = ruleIndex !== -1;
        const direction = isSorted ? sortRules[ruleIndex].direction : null;
        const filterValue = filters[sortKey] || "";

        return (
            <th key={sortKey} className="p-3 align-top">
                <div
                    className="flex items-center justify-between font-semibold cursor-pointer group hover:text-blue-600 dark:hover:text-blue-400 transition-colors select-none mb-2"
                    onClick={() => handleSort(sortKey)}
                >
                    <span>{label}</span>
                    {isSorted ? (
                        <span className="ml-1 text-blue-500 text-right">
                            {direction === "desc" ? "▼" : "▲"}
                            {sortRules.length > 1 && (
                                <sup className="text-[10px] ml-0.5">
                                    {ruleIndex + 1}
                                </sup>
                            )}
                        </span>
                    ) : (
                        <span className="ml-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-right">
                            ↕
                        </span>
                    )}
                </div>
                <input
                    type="text"
                    value={filterValue}
                    onChange={(e) =>
                        handleFilterChange(sortKey, e.target.value)
                    }
                    placeholder={`${label} 검색`}
                    className="w-full text-xs font-normal px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-500"
                />
            </th>
        );
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 목록
            </h1>

            {/* 제품코드 자동완성(콤보박스)을 위한 datalist */}
            <datalist id="master-product-list">
                {loaderData.masterProducts.map((p: any) => (
                    <option key={p.code} value={p.code}>
                        {p.description}
                    </option>
                ))}
            </datalist>

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("고객사", "client_company")}
                            {renderTh("파트너사", "partner_company")}
                            {renderTh("파트너 담당자", "partner_contact_name")}
                            {renderTh("사업명", "project_name")}
                            {renderTh("총 공급가", "totalSupplyPrice")}
                            {renderTh("견적날짜", "created_at")}
                            {renderTh("마지막 수정날짜", "updated_at")}
                        </tr>
                    </thead>
                    <tbody>
                        {processedData.map((quote: any) => (
                            <Fragment key={quote.id}>
                                <tr
                                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 cursor-pointer divide-x divide-gray-200 dark:divide-gray-700"
                                    onClick={() => toggleRow(quote.id)}
                                >
                                    <td className="p-4">
                                        {quote.client_company}
                                    </td>
                                    <td className="p-4">
                                        {quote.partner_company}
                                    </td>
                                    <td className="p-4">
                                        {quote.partner_contact_name}
                                    </td>
                                    <td className="p-4">
                                        {quote.project_name}
                                    </td>
                                    <td className="p-4 font-medium">
                                        {quote.totalSupplyPrice.toLocaleString()}
                                        원
                                    </td>
                                    <td className="p-4">
                                        {quote.createdAtDate}
                                    </td>
                                    <td className="p-4">
                                        {quote.updatedAtDate}
                                    </td>
                                </tr>
                                {/* 펼쳐진 영역 상세 내용 */}
                                {expandedRows.has(quote.id) && (
                                    <tr className="bg-blue-50/50 dark:bg-slate-700/50 border-b dark:border-gray-600 shadow-inner">
                                        <td colSpan={7} className="p-6">
                                            <div className="space-y-6">
                                                {/* 0. 담당자 및 영업 요약 정보 */}
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-white dark:bg-gray-800 p-5 rounded border border-gray-200 dark:border-gray-600">
                                                    <div>
                                                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                            <span className="mr-2">
                                                                🏢
                                                            </span>{" "}
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
                                                            <span className="mr-2">
                                                                🤝
                                                            </span>{" "}
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
                                                            <span className="mr-2">
                                                                👤
                                                            </span>{" "}
                                                            영업 정보
                                                        </h4>
                                                        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
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
                                                            <span className="mr-2">
                                                                📋
                                                            </span>{" "}
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
                                                                            className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                                                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
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
                                                                                className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700"
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
                                                <div>
                                                    <div className="flex justify-between items-center mb-4">
                                                        <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                                                            <span className="mr-2">
                                                                📦
                                                            </span>{" "}
                                                            제품 상세
                                                        </h3>
                                                        {editingQuoteId ===
                                                        quote.id ? (
                                                            <div className="flex items-center gap-4">
                                                                <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded border border-gray-200 dark:border-gray-600">
                                                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 ml-2">
                                                                        계산
                                                                        기준:
                                                                    </span>
                                                                    <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                        <input
                                                                            type="radio"
                                                                            name={`calcMode-${quote.id}`}
                                                                            value="PPC"
                                                                            checked={
                                                                                calcMode ===
                                                                                "PPC"
                                                                            }
                                                                            onChange={
                                                                                handleCalcModeChange
                                                                            }
                                                                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                        />
                                                                        <span className="text-sm text-gray-700 dark:text-gray-300">
                                                                            PPC
                                                                        </span>
                                                                    </label>
                                                                    <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                        <input
                                                                            type="radio"
                                                                            name={`calcMode-${quote.id}`}
                                                                            value="DC"
                                                                            checked={
                                                                                calcMode ===
                                                                                "DC"
                                                                            }
                                                                            onChange={
                                                                                handleCalcModeChange
                                                                            }
                                                                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                        />
                                                                        <span className="text-sm text-gray-700 dark:text-gray-300">
                                                                            DC원화
                                                                        </span>
                                                                    </label>
                                                                    <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                        <input
                                                                            type="radio"
                                                                            name={`calcMode-${quote.id}`}
                                                                            value="MARGIN"
                                                                            checked={
                                                                                calcMode ===
                                                                                "MARGIN"
                                                                            }
                                                                            onChange={
                                                                                handleCalcModeChange
                                                                            }
                                                                            className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                        />
                                                                        <span className="text-sm text-gray-700 dark:text-gray-300">
                                                                            마진
                                                                        </span>
                                                                    </label>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={
                                                                        handleAddProduct
                                                                    }
                                                                    className="bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                                                                >
                                                                    + 제품 추가
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        handleSaveEdit(
                                                                            quote.id,
                                                                        )
                                                                    }
                                                                    className="bg-green-600 text-white hover:bg-green-700 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                                                                >
                                                                    저장
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={
                                                                        handleCancelEdit
                                                                    }
                                                                    className="bg-gray-200 text-gray-800 hover:bg-gray-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                                                                >
                                                                    취소
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleEditClick(
                                                                        quote,
                                                                    )
                                                                }
                                                                className="bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                                                            >
                                                                수정
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                                                        <table className="w-full text-sm text-left table-fixed min-w-[1300px]">
                                                            <thead className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-b dark:border-gray-600 whitespace-nowrap">
                                                                <tr className="divide-x divide-gray-200 dark:divide-gray-600">
                                                                    <th className="p-2 font-semibold w-40">
                                                                        제품코드
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-20">
                                                                        수량
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-20">
                                                                        기간
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-20">
                                                                        DC달러(%)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-right w-28">
                                                                        달러PPC
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-28">
                                                                        달러net($)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-24">
                                                                        환율(₩)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-32">
                                                                        원화PPC(₩)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-24">
                                                                        DC원화(%)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-32">
                                                                        공급가(₩)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-32">
                                                                        마진(₩)
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-right w-28">
                                                                        마진%
                                                                    </th>
                                                                    <th className="p-2 font-semibold text-center w-20">
                                                                        년차
                                                                    </th>
                                                                    {editingQuoteId ===
                                                                        quote.id && (
                                                                        <th className="p-2 font-semibold text-center w-16">
                                                                            관리
                                                                        </th>
                                                                    )}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(editingQuoteId ===
                                                                quote.id
                                                                    ? editProducts
                                                                    : quote.productsList
                                                                ).map(
                                                                    (
                                                                        prod: any,
                                                                        idx: number,
                                                                    ) => {
                                                                        const isEditing =
                                                                            editingQuoteId ===
                                                                            quote.id;
                                                                        // 수정 중이 아닐 때는 저장된 quote_type(0: PPC, 1: DC) 기준으로 렌더링
                                                                        const currentMode =
                                                                            isEditing
                                                                                ? calcMode
                                                                                : quote.quote_type ===
                                                                                    0
                                                                                  ? "PPC"
                                                                                  : "DC";

                                                                        const lpd =
                                                                            Number(
                                                                                prod.lpd,
                                                                            ) ||
                                                                            0;
                                                                        const lpw =
                                                                            Number(
                                                                                prod.lpw,
                                                                            ) ||
                                                                            0;
                                                                        const qty =
                                                                            Number(
                                                                                prod.수량,
                                                                            ) ||
                                                                            0;
                                                                        const period =
                                                                            Number(
                                                                                prod.기간,
                                                                            ) ||
                                                                            0;
                                                                        const dcDollar =
                                                                            Number(
                                                                                prod.DC달러,
                                                                            ) ||
                                                                            0;
                                                                        const exchangeRate =
                                                                            Number(
                                                                                prod.환율,
                                                                            ) ||
                                                                            0;
                                                                        const dcWon =
                                                                            Number(
                                                                                prod.DC원화,
                                                                            ) ||
                                                                            0;

                                                                        const dollarPpc =
                                                                            lpd *
                                                                            (1 -
                                                                                dcDollar /
                                                                                    100);
                                                                        const dollarCost =
                                                                            lpd *
                                                                            qty *
                                                                            period;
                                                                        const dollarNet =
                                                                            dollarPpc *
                                                                            qty *
                                                                            period;
                                                                        const wonNet =
                                                                            dollarNet *
                                                                            exchangeRate;

                                                                        let supplyPrice =
                                                                            Math.round(
                                                                                (lpw *
                                                                                    qty *
                                                                                    period *
                                                                                    (1 -
                                                                                        dcWon /
                                                                                            100)) /
                                                                                    1000,
                                                                            ) *
                                                                            1000;

                                                                        if (
                                                                            currentMode ===
                                                                                "PPC" &&
                                                                            prod.원화PPC !==
                                                                                undefined
                                                                        ) {
                                                                            supplyPrice =
                                                                                Number(
                                                                                    prod.원화PPC,
                                                                                ) *
                                                                                qty *
                                                                                period;
                                                                        } else if (
                                                                            currentMode ===
                                                                                "MARGIN" &&
                                                                            prod.마진율 !==
                                                                                undefined
                                                                        ) {
                                                                            const inputMarginPercent =
                                                                                Number(
                                                                                    prod.마진율,
                                                                                );
                                                                            if (
                                                                                inputMarginPercent <
                                                                                100
                                                                            ) {
                                                                                supplyPrice =
                                                                                    Math.round(
                                                                                        wonNet /
                                                                                            (1 -
                                                                                                inputMarginPercent /
                                                                                                    100) /
                                                                                            1000,
                                                                                    ) *
                                                                                    1000;
                                                                            } else {
                                                                                supplyPrice = 0;
                                                                            }
                                                                        }

                                                                        const wonPpc =
                                                                            qty *
                                                                                period >
                                                                            0
                                                                                ? supplyPrice /
                                                                                  (qty *
                                                                                      period)
                                                                                : 0;
                                                                        const margin =
                                                                            supplyPrice -
                                                                            wonNet;
                                                                        const marginPercent =
                                                                            supplyPrice
                                                                                ? (
                                                                                      (margin /
                                                                                          supplyPrice) *
                                                                                      100
                                                                                  ).toFixed(
                                                                                      1,
                                                                                  )
                                                                                : "0.0";

                                                                        return (
                                                                            <tr
                                                                                key={
                                                                                    idx
                                                                                }
                                                                                className="border-b last:border-b-0 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 divide-x divide-gray-200 dark:divide-gray-600"
                                                                            >
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="text"
                                                                                            list="master-product-list"
                                                                                            value={
                                                                                                prod.제품코드
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "제품코드",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm"
                                                                                            placeholder="선택/입력"
                                                                                        />
                                                                                    ) : (
                                                                                        <span className="px-2">
                                                                                            {
                                                                                                prod.제품코드
                                                                                            }
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            value={
                                                                                                prod.수량
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "수량",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                                                        />
                                                                                    ) : (
                                                                                        <div className="text-right px-2">
                                                                                            {
                                                                                                prod.수량
                                                                                            }
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            value={
                                                                                                prod.기간
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "기간",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-center"
                                                                                        />
                                                                                    ) : (
                                                                                        <div className="text-center px-2">
                                                                                            {
                                                                                                prod.기간
                                                                                            }
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            step="any"
                                                                                            value={
                                                                                                prod.DC달러
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "DC달러",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                                                        />
                                                                                    ) : (
                                                                                        <div className="text-right px-2">
                                                                                            {
                                                                                                prod.DC달러
                                                                                            }

                                                                                            %
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                                                                    $
                                                                                    {dollarPpc.toLocaleString(
                                                                                        undefined,
                                                                                        {
                                                                                            minimumFractionDigits: 2,
                                                                                            maximumFractionDigits: 2,
                                                                                        },
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                                                                    $
                                                                                    {dollarNet.toLocaleString(
                                                                                        undefined,
                                                                                        {
                                                                                            minimumFractionDigits: 2,
                                                                                            maximumFractionDigits: 2,
                                                                                        },
                                                                                    )}
                                                                                </td>
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            step="any"
                                                                                            value={
                                                                                                prod.환율
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "환율",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                                                        />
                                                                                    ) : (
                                                                                        <div className="text-right px-2">
                                                                                            ₩
                                                                                            {prod.환율?.toLocaleString()}
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                {isEditing &&
                                                                                currentMode ===
                                                                                    "PPC" ? (
                                                                                    <td className="p-2">
                                                                                        <input
                                                                                            type="number"
                                                                                            value={
                                                                                                prod.원화PPC !==
                                                                                                undefined
                                                                                                    ? prod.원화PPC
                                                                                                    : Math.round(
                                                                                                          wonPpc,
                                                                                                      )
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "원화PPC",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right font-medium"
                                                                                        />
                                                                                    </td>
                                                                                ) : (
                                                                                    <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                                                        {Math.round(
                                                                                            wonPpc,
                                                                                        ).toLocaleString()}
                                                                                    </td>
                                                                                )}
                                                                                {isEditing &&
                                                                                currentMode ===
                                                                                    "DC" ? (
                                                                                    <td className="p-2">
                                                                                        <input
                                                                                            type="number"
                                                                                            step="any"
                                                                                            value={
                                                                                                prod.DC원화
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "DC원화",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                                                        />
                                                                                    </td>
                                                                                ) : (
                                                                                    <td className="p-2 text-right text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                                                        {
                                                                                            prod.DC원화
                                                                                        }

                                                                                        %
                                                                                    </td>
                                                                                )}
                                                                                <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                                                    ₩
                                                                                    {supplyPrice.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/50">
                                                                                    ₩
                                                                                    {Math.round(
                                                                                        margin,
                                                                                    ).toLocaleString()}
                                                                                </td>
                                                                                {isEditing &&
                                                                                currentMode ===
                                                                                    "MARGIN" ? (
                                                                                    <td className="p-2">
                                                                                        <div className="flex items-center">
                                                                                            <input
                                                                                                type="number"
                                                                                                step="any"
                                                                                                value={
                                                                                                    prod.마진율 !==
                                                                                                    undefined
                                                                                                        ? prod.마진율
                                                                                                        : marginPercent
                                                                                                }
                                                                                                onChange={(
                                                                                                    e,
                                                                                                ) =>
                                                                                                    handleProductChange(
                                                                                                        idx,
                                                                                                        "마진율",
                                                                                                        e
                                                                                                            .target
                                                                                                            .value,
                                                                                                    )
                                                                                                }
                                                                                                className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right font-bold text-blue-600 dark:text-blue-400"
                                                                                            />
                                                                                            <span className="ml-1 text-blue-600 dark:text-blue-400 font-bold">
                                                                                                %
                                                                                            </span>
                                                                                        </div>
                                                                                    </td>
                                                                                ) : (
                                                                                    <td className="p-2 text-right font-bold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/50">
                                                                                        {
                                                                                            marginPercent
                                                                                        }

                                                                                        %
                                                                                    </td>
                                                                                )}
                                                                                <td className="p-2">
                                                                                    {isEditing ? (
                                                                                        <input
                                                                                            type="number"
                                                                                            value={
                                                                                                prod.년차
                                                                                            }
                                                                                            onChange={(
                                                                                                e,
                                                                                            ) =>
                                                                                                handleProductChange(
                                                                                                    idx,
                                                                                                    "년차",
                                                                                                    e
                                                                                                        .target
                                                                                                        .value,
                                                                                                )
                                                                                            }
                                                                                            className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-center"
                                                                                        />
                                                                                    ) : (
                                                                                        <div className="text-center px-2">
                                                                                            {
                                                                                                prod.년차
                                                                                            }
                                                                                        </div>
                                                                                    )}
                                                                                </td>
                                                                                {isEditing && (
                                                                                    <td className="p-2 text-center">
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() =>
                                                                                                handleRemoveProduct(
                                                                                                    idx,
                                                                                                )
                                                                                            }
                                                                                            className="text-red-500 hover:text-red-700 font-bold transition-colors"
                                                                                        >
                                                                                            삭제
                                                                                        </button>
                                                                                    </td>
                                                                                )}
                                                                            </tr>
                                                                        );
                                                                    },
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>

                                                {/* 2. 비고 리스트 */}
                                                {(editingQuoteId === quote.id ||
                                                    (quote.noteList &&
                                                        quote.noteList.length >
                                                            0)) && (
                                                    <div className="bg-white dark:bg-gray-800 p-5 rounded border border-gray-200 dark:border-gray-600">
                                                        <div className="flex justify-between items-center mb-4">
                                                            <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                                                                <span className="mr-2">
                                                                    📝
                                                                </span>{" "}
                                                                비고
                                                            </h3>
                                                            {editingQuoteId ===
                                                                quote.id && (
                                                                <button
                                                                    type="button"
                                                                    onClick={
                                                                        handleAddNote
                                                                    }
                                                                    className="bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                                                                >
                                                                    + 비고 추가
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
                                                                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[40px] resize-y"
                                                                                placeholder="비고 내용을 입력하세요"
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleRemoveNote(
                                                                                        idx,
                                                                                    )
                                                                                }
                                                                                className="text-red-500 hover:text-red-700 font-bold p-2 mt-1 whitespace-nowrap"
                                                                            >
                                                                                삭제
                                                                            </button>
                                                                        </div>
                                                                    ),
                                                                )}
                                                                {editNotes.length ===
                                                                    0 && (
                                                                    <div className="text-center text-gray-500 dark:text-gray-400 py-4 border border-dashed border-gray-300 dark:border-gray-600 rounded">
                                                                        추가된
                                                                        비고가
                                                                        없습니다.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <ul className="list-disc pl-5 text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                                                                {[
                                                                    ...quote.noteList,
                                                                ]
                                                                    .reverse()
                                                                    .map(
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
