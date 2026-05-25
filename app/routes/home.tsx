import { useState, Fragment } from "react";
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
            q.updated_at,
            q.stage,
            q.note,
            a.name as am_name,
            q.deal_flow,
            q.expected_quarter,
            q.contract_type
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
            updated_at: row.updated_at, // 정렬 처리를 위한 원본 데이터 보존
            updatedAtDate: new Date(row.updated_at).toLocaleDateString("ko-KR"), // 타임스탬프를 YYYY. MM. DD. 형식으로 변환
        };
    });

    return { quotes };
}

export default function Home({ loaderData }: Route.ComponentProps) {
    // 펼쳐진 행(Row) 상태 관리
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

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
            updated_at: (_, row) => row.updatedAtDate,
        },
    });

    const toggleRow = (id: number) => {
        setExpandedRows((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
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
        <div className="p-8 container mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 목록
            </h1>
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("예상 분기", "expected_quarter")}
                            {renderTh("고객사", "client_company")}
                            {renderTh("파트너사", "partner_company")}
                            {renderTh("파트너 담당자", "partner_contact_name")}
                            {renderTh("사업명", "project_name")}
                            {renderTh("총 공급가", "totalSupplyPrice")}
                            {renderTh("마지막 수정날짜", "updated_at")}
                            {renderTh("단계", "stage")}
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
                                        {quote.expected_quarter}
                                    </td>
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
                                        {quote.updatedAtDate}
                                    </td>
                                    <td className="p-4">{quote.stage}</td>
                                </tr>
                                {/* 펼쳐진 영역 상세 내용 */}
                                {expandedRows.has(quote.id) && (
                                    <tr className="bg-blue-50/50 dark:bg-slate-700/50 border-b dark:border-gray-600 shadow-inner">
                                        <td colSpan={8} className="p-6">
                                            <div className="space-y-6">
                                                {/* 0. 담당자 및 영업 요약 정보 */}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white dark:bg-gray-800 p-5 rounded border border-gray-200 dark:border-gray-600">
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
                                                </div>

                                                {/* 1. 제품 상세 테이블 */}
                                                <div>
                                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                        <span className="mr-2">
                                                            📦
                                                        </span>{" "}
                                                        제품 상세
                                                    </h3>
                                                    <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
                                                        <table className="w-full text-sm text-left">
                                                            <thead className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-b dark:border-gray-600">
                                                                <tr className="divide-x divide-gray-200 dark:divide-gray-600">
                                                                    <th className="p-3 font-semibold">
                                                                        제품코드
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        수량
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-center">
                                                                        기간
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        DC달러
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        달러PPC
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        달러net
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        환율
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        공급가
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        마진
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-right">
                                                                        마진%
                                                                    </th>
                                                                    <th className="p-3 font-semibold text-center">
                                                                        년차
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {quote.productsList.map(
                                                                    (
                                                                        prod: any,
                                                                        idx: number,
                                                                    ) => {
                                                                        // 마진% 계산 (공급가가 있을 경우에만)
                                                                        const marginPercent =
                                                                            prod.공급가
                                                                                ? (
                                                                                      (prod.마진 /
                                                                                          prod.공급가) *
                                                                                      100
                                                                                  ).toFixed(
                                                                                      1,
                                                                                  )
                                                                                : 0;

                                                                        // 달러PPC 계산: 달러net / (수량 * 기간), 소수점 둘째자리
                                                                        const safeQty =
                                                                            prod.수량 ||
                                                                            1;
                                                                        const safePeriod =
                                                                            prod.기간 ||
                                                                            1;
                                                                        const dollarPpc =
                                                                            prod.달러net
                                                                                ? (
                                                                                      prod.달러net /
                                                                                      (safeQty *
                                                                                          safePeriod)
                                                                                  ).toFixed(
                                                                                      2,
                                                                                  )
                                                                                : "0.00";

                                                                        return (
                                                                            <tr
                                                                                key={
                                                                                    idx
                                                                                }
                                                                                className="border-b last:border-b-0 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 divide-x divide-gray-200 dark:divide-gray-600"
                                                                            >
                                                                                <td className="p-3">
                                                                                    {
                                                                                        prod.제품코드
                                                                                    }
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    {prod.수량?.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-3 text-center">
                                                                                    {
                                                                                        prod.기간
                                                                                    }
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    {
                                                                                        prod.DC달러
                                                                                    }

                                                                                    %
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    $
                                                                                    {
                                                                                        dollarPpc
                                                                                    }
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    $
                                                                                    {prod.달러net?.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-3 text-right">
                                                                                    ₩
                                                                                    {prod.환율?.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-3 text-right font-medium">
                                                                                    ₩
                                                                                    {prod.공급가?.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-3 text-right text-green-600 dark:text-green-400">
                                                                                    ₩
                                                                                    {prod.마진?.toLocaleString()}
                                                                                </td>
                                                                                <td className="p-3 text-right font-bold text-blue-600 dark:text-blue-400">
                                                                                    {
                                                                                        marginPercent
                                                                                    }

                                                                                    %
                                                                                </td>
                                                                                <td className="p-3 text-center">
                                                                                    {
                                                                                        prod.년차
                                                                                    }
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    },
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>

                                                {/* 2. 비고 리스트 (역순 배치) */}
                                                {quote.noteList &&
                                                    quote.noteList.length >
                                                        0 && (
                                                        <div>
                                                            <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                                                <span className="mr-2">
                                                                    📝
                                                                </span>{" "}
                                                                비고
                                                            </h3>
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
