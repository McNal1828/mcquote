import { useState, Fragment } from "react";
import { Link } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/history";
import {
    ArrowLeft,
    Calendar,
    History,
    FileText,
    Building2,
    Users,
    UserCheck,
    Layers,
} from "lucide-react";

// loader to fetch the quote metadata and database history
export async function loader({ params }: Route.LoaderArgs) {
    const id = params.id;
    const quote = db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as any;
    if (!quote) {
        throw new Response("견적을 찾을 수 없습니다.", { status: 404 });
    }

    const partnerName = quote.partner_id
        ? (db.prepare("SELECT name FROM partners WHERE id = ?").get(quote.partner_id) as any)?.name
        : "";
    const amName = quote.am_id
        ? (db.prepare("SELECT name FROM ams WHERE id = ?").get(quote.am_id) as any)?.name
        : "";

    return { quote, partnerName, amName };
}

// helper calculation logic to reconstruct unit prices and margins for older revisions
function getFinalProducts(
    productsToProcess: any[] | Record<string, any[]>,
    currentMode: string,
): any {
    if (Array.isArray(productsToProcess)) {
        return productsToProcess.map((prod) => {
            const lpd = Number(prod.lpd) || 0;
            const lpw = Number(prod.lpw) || 0;
            const qty = Number(prod.수량) || 0;
            const period = Number(prod.기간) || 0;
            const dcDollar = Number(prod.DC달러) || 0;
            const exchangeRate = Number(prod.환율) || 0;
            let dcWon = Number(prod.DC원화) || 0;

            const dollarPpc = lpd * (1 - dcDollar / 100);
            const dollarCost = lpd * qty * period;
            const dollarNet = dollarPpc * qty * period;
            const wonNet = dollarNet * exchangeRate;

            const baseUnitLpw = Math.round((lpw * period) / 1000) * 1000;
            let supplyPrice = 0;

            if (currentMode === "PPC" && prod.원화PPC !== undefined) {
                supplyPrice = Number(prod.원화PPC) * qty * period;
            } else if (currentMode === "MARGIN" && prod.마진율 !== undefined) {
                const inputMarginPercent = Number(prod.마진율);
                let tempSupply = 0;
                if (inputMarginPercent < 100) {
                    tempSupply =
                        Math.round(
                            wonNet / (1 - inputMarginPercent / 100) / 1000,
                        ) * 1000;
                }
                const baseTotalLpw = lpw * qty * period;
                if (baseTotalLpw > 0) {
                    const rawDcWon = (1 - tempSupply / baseTotalLpw) * 100;
                    dcWon = Math.trunc(rawDcWon * 100) / 100;
                }

                const discountedUnitLpw =
                    Math.round((baseUnitLpw * (1 - dcWon / 100)) / 1000) * 1000;
                supplyPrice = discountedUnitLpw * qty;
            } else {
                const discountedUnitLpw =
                    Math.round((baseUnitLpw * (1 - dcWon / 100)) / 1000) * 1000;
                supplyPrice = discountedUnitLpw * qty;
            }

            const wonPpc = qty * period > 0 ? supplyPrice / (qty * period) : 0;
            const margin = supplyPrice - wonNet;
            const marginPercent = supplyPrice
                ? ((margin / supplyPrice) * 100).toFixed(1)
                : "0.0";

            return {
                ...prod,
                DC원화: dcWon,
                달러PPC: dollarPpc,
                달러원가: dollarCost,
                달러net: dollarNet,
                공급가: supplyPrice,
                마진: margin,
                원화PPC:
                    currentMode === "PPC" && prod.원화PPC !== undefined
                        ? prod.원화PPC
                        : Math.round(wonPpc),
                마진율:
                    currentMode === "MARGIN" && prod.마진율 !== undefined
                        ? prod.마진율
                        : marginPercent,
            };
        });
    } else {
        const processed: Record<string, any[]> = {};
        for (const [groupName, prods] of Object.entries(productsToProcess)) {
            processed[groupName] = getFinalProducts(prods, currentMode);
        }
        return processed;
    }
}

export default function HistoryView({ loaderData }: Route.ComponentProps) {
    const { quote, partnerName, amName } = loaderData;

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

                {/* Quote Information Summary Card */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Building2 className="w-4 h-4" /> 고객 및 프로젝트 정보
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p><span className="text-gray-500 dark:text-gray-400">고객사:</span> <strong>{quote.client_company || "-"}</strong></p>
                            <p><span className="text-gray-500 dark:text-gray-400">담당자:</span> {quote.client_contact_name || "-"} {quote.client_contact_email && `(${quote.client_contact_email})`}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">연락처:</span> {quote.client_contact_phone || "-"}</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Users className="w-4 h-4" /> 파트너 및 벤더
                        </h3>
                        <div className="space-y-1 sm:space-y-1.5 text-sm">
                            <p><span className="text-gray-500 dark:text-gray-400">파트너사:</span> <strong>{partnerName || "-"}</strong></p>
                            <p><span className="text-gray-500 dark:text-gray-400">제조사 AM:</span> {amName || quote.vendor || "-"}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">계약 종류:</span> {quote.contract_type || "-"}</p>
                        </div>
                    </div>
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
                                                                <table className="w-full text-xs text-left">
                                                                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-400 uppercase divide-y divide-gray-250 dark:divide-gray-750">
                                                                        <tr className="divide-x divide-gray-200 dark:divide-gray-750">
                                                                            <th className="p-2 font-semibold text-center w-28">제품코드</th>
                                                                            <th className="p-2 font-semibold text-center w-12">수량</th>
                                                                            <th className="p-2 font-semibold text-center w-12">기간</th>
                                                                            <th className="p-2 font-semibold text-right w-20">LPD($)</th>
                                                                            <th className="p-2 font-semibold text-right w-20">LPW(₩)</th>
                                                                            <th className="p-2 font-semibold text-center w-20">DC달러(%)</th>
                                                                            <th className="p-2 font-semibold text-right w-16">환율</th>
                                                                            <th className="p-2 font-semibold text-center w-20">DC원화(%)</th>
                                                                            <th className="p-2 font-semibold text-center w-28">공급가(₩)</th>
                                                                            <th className="p-2 font-semibold text-center w-28">마진(₩)</th>
                                                                            <th className="p-2 font-semibold text-right w-20">마진%</th>
                                                                            <th className="p-2 font-semibold text-center w-12">년차</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-750">
                                                                        {finalProds.map((calcProd: any, idx: number) => (
                                                                            <tr
                                                                                key={idx}
                                                                                className="border-b last:border-b-0 border-gray-200 dark:border-gray-750 hover:bg-gray-50 dark:hover:bg-gray-900/50 divide-x divide-gray-200 dark:divide-gray-750"
                                                                            >
                                                                                <td className="p-2 font-medium truncate max-w-[120px]">{calcProd.제품코드 || "-"}</td>
                                                                                <td className="p-2 text-center">{calcProd.수량}</td>
                                                                                <td className="p-2 text-center">{calcProd.기간}</td>
                                                                                <td className="p-2 text-right">
                                                                                    ${Number(calcProd.lpd).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right">
                                                                                    ₩{Number(calcProd.lpw).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-center">{calcProd.DC달러}%</td>
                                                                                <td className="p-2 text-right">
                                                                                    {Number(calcProd.환율).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-center">{calcProd.DC원화}%</td>
                                                                                <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/30">
                                                                                    ₩{Number(calcProd.공급가).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/30">
                                                                                    ₩{Math.round(Number(calcProd.마진)).toLocaleString()}
                                                                                </td>
                                                                                <td className="p-2 text-right font-semibold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/30">
                                                                                    {calcProd.마진율}%
                                                                                </td>
                                                                                <td className="p-2 text-center">{calcProd.년차}</td>
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
