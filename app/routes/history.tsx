import { useState, Fragment } from "react";
import { Link } from "react-router";
import db from "../db.server";
import { getFinalProducts, normalizeProducts } from "~/utils/calculator";
import DetailedCostTable from "~/components/DetailedCostTable";
import type { Route } from "./+types/history";
import {
    ArrowLeft,
    Calendar,
    History,
    FileText,
    Building2,
    Users,
    UserCircle,
    Layers,
} from "lucide-react";

// loader to fetch the quote metadata and database history
export async function loader({ params }: Route.LoaderArgs) {
    const id = params.id;
    const quote = db.prepare("SELECT *, (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = quotes.id) as vendor FROM quotes WHERE id = ?").get(id) as any;
    if (!quote) {
        throw new Response("견적을 찾을 수 없습니다.", { status: 404 });
    }

    const partnerName = quote.partner_id
        ? (db.prepare("SELECT name FROM partners WHERE id = ?").get(quote.partner_id) as any)?.name
        : "";
    const partnerContactName = quote.partner_contact_id
        ? (db.prepare("SELECT name FROM partner_contacts WHERE id = ?").get(quote.partner_contact_id) as any)?.name
        : "";
    const amName = quote.am_id
        ? (db.prepare("SELECT name FROM ams WHERE id = ?").get(quote.am_id) as any)?.name
        : "";
    const distContactName = quote.dist_contact_id
        ? (db.prepare("SELECT name FROM dist_contacts WHERE id = ?").get(quote.dist_contact_id) as any)?.name
        : "";

    let dealFlowList: string[] = [];
    try {
        dealFlowList = JSON.parse(quote.deal_flow || "[]");
        if (!Array.isArray(dealFlowList)) dealFlowList = [];
    } catch (e) {
        dealFlowList = [];
    }

    return { quote, partnerName, partnerContactName, amName, distContactName, dealFlowList };
}

export default function HistoryView({ loaderData }: Route.ComponentProps) {
    const { quote, partnerName, partnerContactName, amName, distContactName, dealFlowList } = loaderData;

    // Parse the products history array
    let historyList: Array<Record<string, any>> = [];
    if (quote.products_history) {
        try {
            historyList = JSON.parse(quote.products_history);
            if (!Array.isArray(historyList)) {
                historyList = [];
            }
        } catch (e) {
            historyList = [];
        }
    }

    // Sort history from latest to oldest
    const sortedHistory = [...historyList].reverse();

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-8">
                {/* Header Navigation */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 h-9 w-9"
                            title="뒤로 가기"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">
                                견적 변경 이력
                            </span>
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white mt-1">
                                {quote.project_name || "프로젝트명 없음"}
                            </h1>
                        </div>
                    </div>
                </div>

                {/* Quote Information Summary Card - quoting.tsx 레이아웃과 동일 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    {/* 고객사 정보 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Building2 className="w-4 h-4" /> 고객사 정보
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p><span className="text-gray-500 dark:text-gray-400">고객사명:</span> <strong>{quote.client_company || "-"}</strong></p>
                            <p><span className="text-gray-500 dark:text-gray-400">담당자 이름:</span> {quote.client_contact_name || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">이메일:</span> {quote.client_contact_email || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">연락처:</span> {quote.client_contact_phone || "-"}</p>
                        </div>
                    </div>

                    {/* 담당자 정보 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Users className="w-4 h-4" /> 담당자 정보
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p><span className="text-gray-500 dark:text-gray-400">파트너사명:</span> <strong>{partnerName || "-"}</strong></p>
                            <p><span className="text-gray-500 dark:text-gray-400">담당자 이름:</span> {partnerContactName || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">총판 담당자:</span> {distContactName || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">담당AM:</span> {amName || quote.vendor || "-"}</p>
                        </div>
                    </div>

                    {/* 영업 정보 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <UserCircle className="w-4 h-4" /> 영업 정보
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p><span className="text-gray-500 dark:text-gray-400">계약방식:</span> {quote.contract_type || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">벤더:</span> {quote.vendor || "-"}</p>

                            <div>
                                <span className="text-gray-500 dark:text-gray-400">Deal Flow:</span>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                    {dealFlowList.map((flow, idx) => (
                                        <Fragment key={idx}>
                                            {idx > 0 && <span className="text-gray-400 text-xs">➤</span>}
                                            <span className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{flow}</span>
                                        </Fragment>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 현재 상태 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Layers className="w-4 h-4" /> 현재 상태
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p>
                                <span className="text-gray-500 dark:text-gray-400">오더 상태:</span>{" "}
                                {quote.is_ordered ? (
                                    <span className="text-green-600 dark:text-green-400 font-bold">오더 완료</span>
                                ) : quote.is_lost ? (
                                    <span className="text-red-500 dark:text-red-400 font-bold">실주</span>
                                ) : (
                                    <span className="text-blue-500 dark:text-blue-400 font-bold">진행 중</span>
                                )}
                            </p>
                            <p><span className="text-gray-500 dark:text-gray-400">등록일자:</span> {new Date(quote.created_at).toLocaleString("ko-KR")}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">마지막 수정:</span> {new Date(quote.updated_at).toLocaleString("ko-KR")}</p>
                        </div>
                    </div>
                </div>

                {/* History Timeline */}
                <div className="space-y-6">
                    <div className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-200">
                        <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <h2>제품 상세 변경 히스토리 ({historyList.length}건)</h2>
                    </div>

                    {sortedHistory.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 text-center text-gray-500 dark:text-gray-400">
                            기록된 변경 이력이 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-8 relative before:absolute before:inset-y-0 before:left-4 sm:before:left-6 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-800">
                            {sortedHistory.map((historyItem, revisionIdx) => {
                                const timestamp = Object.keys(historyItem)[0];
                                const rawProducts = historyItem[timestamp];
                                const editTime = new Date(Number(timestamp)).toLocaleString("ko-KR");

                                // Set calculation mode
                                const currentMode = quote.quote_type === 0 ? "PPC" : "DC";

                                // Normalize products structure to support legacy list and new grouped object
                                const grouped = Array.isArray(rawProducts)
                                    ? { "원가표": rawProducts }
                                    : rawProducts;

                                // Run calculations
                                const calculatedGrouped = getFinalProducts(grouped, currentMode);

                                return (
                                    <div key={timestamp} className="relative pl-10 sm:pl-14 group">
                                        {/* Timeline Indicator Node */}
                                        <div className="absolute left-2.5 sm:left-4.5 top-1.5 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-blue-600 border-4 border-white dark:border-gray-900 group-hover:scale-110 transition-transform duration-200 shadow-sm" />

                                        {/* Revision Content Card */}
                                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 space-y-6">
                                            {/* Revision Title Header */}
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b dark:border-gray-700 pb-3 gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">
                                                        버전 {historyList.length - revisionIdx}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                                                        <Calendar className="w-4 h-4" />
                                                        <span>{editTime}</span>
                                                    </div>
                                                </div>
                                                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">
                                                    타입: {currentMode === "PPC" ? "원화PPC 기준" : "DC원화 기준"}
                                                </span>
                                            </div>

                                            {/* Render Product Tables per Group */}
                                            {Object.entries(calculatedGrouped).map(([groupName, groupProducts]) => {
                                                const finalProds = groupProducts as any[];
                                                const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                                                const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                                                const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                                                return (
                                                    <div key={groupName} className="space-y-3">
                                                        <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-750 pb-2">
                                                            <h4 className="font-bold text-gray-800 dark:text-gray-200 text-base">
                                                                {groupName}
                                                            </h4>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-4">
                                                                <span>공급가: <strong>₩{groupTotalSupply.toLocaleString()}</strong></span>
                                                                <span>마진: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                                            </div>
                                                        </div>

                                                        {finalProds.length === 0 ? (
                                                            <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                                                                추가된 제품이 없습니다.
                                                            </div>
                                                        ) : (
                                                            <div className="overflow-x-auto border border-gray-200 dark:border-gray-750 rounded-lg">
                                                                <table className="w-full text-xs text-left border-collapse">
                                                                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-400 uppercase divide-y divide-gray-250 dark:divide-gray-750">
                                                                        <tr className="divide-x divide-gray-200 dark:divide-gray-750">
                                                                            <th className="p-2 font-semibold text-center w-16">매출년</th>
                                                                            <th className="p-2 font-semibold text-center w-16">매출월</th>
                                                                            <th className="p-2 font-semibold text-center w-28">제품코드</th>
                                                                            <th className="p-2 font-semibold text-center w-12">수량</th>
                                                                            <th className="p-2 font-semibold text-center w-12">기간</th>
                                                                            <th className="p-2 font-semibold text-center w-20">DC달러(%)</th>
                                                                            <th className="p-2 font-semibold text-right w-24">달러PPC($)</th>
                                                                            <th className="p-2 font-semibold text-right w-24">달러net($)</th>
                                                                            <th className="p-2 font-semibold text-right w-20">환율(₩)</th>
                                                                            <th className="p-2 font-semibold text-right w-28">원화PPC(₩)</th>
                                                                            <th className="p-2 font-semibold text-center w-20">DC원화(%)</th>
                                                                            <th className="p-2 font-semibold text-center w-28">공급가(₩)</th>
                                                                            <th className="p-2 font-semibold text-center w-28">마진(₩)</th>
                                                                            <th className="p-2 font-semibold text-right w-20 border-r border-gray-200 dark:border-gray-750">마진%</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-750">
                                                                        {finalProds.map((calcProd: any, idx: number) => (
                                                                            <tr
                                                                                key={idx}
                                                                                className="border-b last:border-b-0 border-gray-200 dark:border-gray-750 hover:bg-gray-50 dark:hover:bg-gray-900/50 divide-x divide-gray-200 dark:divide-gray-750"
                                                                            >
                                                                                <td className="p-2 text-center">
                                                                                    {calcProd.년차 !== undefined ? calcProd.년차 : calcProd.year}
                                                                                </td>
                                                                                <td className="p-2 text-center">
                                                                                    {calcProd.매출월 !== undefined ? calcProd.매출월 : calcProd.month}
                                                                                </td>
                                                                                <td className="p-2 font-medium truncate max-w-[120px]">{calcProd.제품코드 || "-"}</td>
                                                                                <td className="p-2 text-center">{calcProd.수량}</td>
                                                                                <td className="p-2 text-center">{calcProd.기간}</td>
                                                                                <td className="p-2 text-center">{calcProd.DC달러}%</td>
                                                                                <td className="p-2 text-right">
                                                                                    ${Number(calcProd.달러PPC || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                                </td>
                                                                                <td className="p-2 text-right">
                                                                                    ${Number(calcProd.달러net || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                                </td>
                                                                                <td className="p-2 text-right">
                                                                                    {Number(calcProd.환율).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right">
                                                                                    ₩{Number(calcProd.원화PPC || 0).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-center">{calcProd.DC원화}%</td>
                                                                                <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/30">
                                                                                    ₩{Number(calcProd.공급가).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/30">
                                                                                    ₩{Math.round(Number(calcProd.마진)).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right font-semibold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/30 border-r border-gray-200 dark:border-gray-750">
                                                                                    {calcProd.마진율}%
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
