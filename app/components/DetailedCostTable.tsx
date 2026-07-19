import { Trash2 } from "lucide-react";

interface DetailedCostTableProps {
    groupName: string;
    rawProducts: any[];
    calcProducts: any[];
    isEditing: boolean;
    calcMode: "PPC" | "DC" | "MARGIN";
    masterProducts: any[];
    vendorFilter?: string;
    onProductChange: (
        groupName: string,
        idx: number,
        field: string,
        val: any,
    ) => void;
    onRemoveProduct: (groupName: string, idx: number) => void;
}

export default function DetailedCostTable({
    groupName,
    rawProducts,
    calcProducts,
    isEditing,
    calcMode,
    masterProducts,
    vendorFilter,
    onProductChange,
    onRemoveProduct,
}: DetailedCostTableProps) {
    return (
        <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs text-left table-fixed min-w-[1150px]">
                <thead className="bg-gray-50 dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 border-b dark:border-gray-700 whitespace-nowrap">
                    <tr className="divide-x divide-gray-200 dark:divide-gray-700">
                        <th className="p-1.5 font-semibold text-center w-14">매출년</th>
                        <th className="p-1.5 font-semibold text-center w-14">매출월</th>
                        <th className="p-1.5 font-semibold w-32">제품코드</th>
                        <th className="p-1.5 font-semibold text-center w-12">수량</th>
                        <th className="p-1.5 font-semibold text-center w-12">기간</th>
                        <th className="p-1.5 font-semibold text-center w-18">DC달러(%)</th>
                        <th className="p-1.5 font-semibold text-right w-22">달러PPC($)</th>
                        <th className="p-1.5 font-semibold text-center w-22">달러net($)</th>
                        <th className="p-1.5 font-semibold text-center w-18">환율(₩)</th>
                        <th className="p-1.5 font-semibold text-center w-24">원화PPC(₩)</th>
                        <th className="p-1.5 font-semibold text-center w-18">DC원화(%)</th>
                        <th className="p-1.5 font-semibold text-center w-24">공급가(₩)</th>
                        <th className="p-1.5 font-semibold text-center w-24">마진(₩)</th>
                        <th className="p-1.5 font-semibold text-right w-20">마진%</th>
                        <th className="p-1.5 font-semibold text-center w-14">단계</th>
                        {isEditing && <th className="p-1.5 font-semibold text-center w-12">관리</th>}
                    </tr>
                </thead>
                <tbody>
                    {calcProducts.map((calcProd: any, idx: number) => {
                        const rawProd = rawProducts[idx];
                        if (!rawProd) return null;

                        return (
                            <tr
                                key={idx}
                                className="border-b last:border-b-0 border-gray-200 dark:border-gray-650 hover:!bg-blue-100 dark:hover:!bg-gray-600 divide-x divide-gray-200 dark:divide-gray-650 text-gray-700 dark:text-gray-300"
                            >
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={rawProd.년차}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "년차",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                                        />
                                    ) : (
                                        <div className="text-center px-1.5">
                                            {calcProd.년차 !== undefined ? calcProd.년차 : calcProd.year}
                                        </div>
                                    )}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            min={1}
                                            max={12}
                                            value={rawProd.매출월 !== undefined ? rawProd.매출월 : 1}
                                            onChange={(e) => {
                                                const val = Math.max(
                                                    1,
                                                    Math.min(
                                                        12,
                                                        Number(e.target.value) || 1,
                                                    ),
                                                );
                                                onProductChange(groupName, idx, "매출월", val);
                                            }}
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                                        />
                                    ) : (
                                        <div className="text-center px-1.5">
                                            {calcProd.매출월 !== undefined
                                                ? calcProd.매출월
                                                : calcProd.month || 1}
                                        </div>
                                    )}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <select
                                            value={rawProd.제품코드}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "제품코드",
                                                    e.target.value,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs"
                                        >
                                            <option value="">제품 선택</option>
                                            {masterProducts
                                                .filter(
                                                    (p: any) =>
                                                        (!vendorFilter ||
                                                            vendorFilter
                                                                .split(",")
                                                                .includes(p.vendor)) &&
                                                        (p.available === 1 ||
                                                            p.code === rawProd.제품코드),
                                                )
                                                .map((p: any) => (
                                                    <option key={p.code} value={p.code}>
                                                        {p.available === 0 ? "[단종] " : ""}
                                                        {p.code} - {p.description}{" "}
                                                        {p.vendor && !vendorFilter
                                                            ? ` [${p.vendor}]`
                                                            : ""}
                                                    </option>
                                                ))}
                                        </select>
                                    ) : (
                                        <span className="px-1.5 truncate block" title={calcProd.제품코드}>
                                            {calcProd.제품코드}
                                        </span>
                                    )}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={rawProd.수량}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "수량",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                                        />
                                    ) : (
                                        <div className="text-right px-1.5">{calcProd.수량}</div>
                                    )}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={rawProd.기간}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "기간",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                                        />
                                    ) : (
                                        <div className="text-center px-1.5">{calcProd.기간}</div>
                                    )}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            step="any"
                                            value={rawProd.DC달러}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "DC달러",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                                        />
                                    ) : (
                                        <div className="text-right px-1.5">{calcProd.DC달러}%</div>
                                    )}
                                </td>
                                <td className="p-1.5 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                    $
                                    {Number(calcProd.달러PPC).toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </td>
                                <td className="p-1.5 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                    $
                                    {Number(calcProd.달러net).toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </td>
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            step="any"
                                            value={rawProd.환율}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "환율",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                                        />
                                    ) : (
                                        <div className="text-right px-1.5">
                                            ₩{Number(calcProd.환율).toLocaleString()}
                                        </div>
                                    )}
                                </td>
                                {isEditing && calcMode === "PPC" ? (
                                    <td className="p-1.5">
                                        <input
                                            type="number"
                                            value={
                                                rawProd.원화PPC !== undefined
                                                    ? rawProd.원화PPC
                                                    : calcProd.원화PPC
                                            }
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "원화PPC",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right font-medium"
                                        />
                                    </td>
                                ) : (
                                    <td className="p-1.5 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                        {Number(calcProd.원화PPC).toLocaleString()}
                                    </td>
                                )}
                                {isEditing && calcMode === "DC" ? (
                                    <td className="p-1.5">
                                        <input
                                            type="number"
                                            step="any"
                                            value={rawProd.DC원화}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "DC원화",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                                        />
                                    </td>
                                ) : (
                                    <td className="p-1.5 text-right text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                        {calcProd.DC원화}%
                                    </td>
                                )}
                                <td className="p-1.5 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                    ₩{Number(calcProd.공급가).toLocaleString()}
                                </td>
                                <td className="p-1.5 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/50">
                                    ₩{Math.round(Number(calcProd.마진)).toLocaleString()}
                                </td>
                                {isEditing && calcMode === "MARGIN" ? (
                                    <td className="p-1.5">
                                        <div className="flex items-center">
                                            <input
                                                type="number"
                                                step="any"
                                                value={
                                                    rawProd.마진율 !== undefined
                                                        ? rawProd.마진율
                                                        : calcProd.마진율
                                                }
                                                onChange={(e) =>
                                                    onProductChange(
                                                        groupName,
                                                        idx,
                                                        "마진율",
                                                        Number(e.target.value) || 0,
                                                    )
                                                }
                                                className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right font-bold text-blue-600 dark:text-blue-400"
                                            />
                                            <span className="ml-1 text-blue-600 dark:text-blue-400 font-bold">
                                                %
                                            </span>
                                        </div>
                                    </td>
                                ) : (
                                    <td className="p-1.5 text-right font-bold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/50">
                                        {calcProd.마진율}%
                                    </td>
                                )}
                                <td className="p-1.5">
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            value={rawProd.stage !== undefined ? rawProd.stage : 10}
                                            onChange={(e) =>
                                                onProductChange(
                                                    groupName,
                                                    idx,
                                                    "stage",
                                                    Number(e.target.value) || 0,
                                                )
                                            }
                                            className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                                        />
                                    ) : (
                                        <div className="text-center px-1.5">
                                            {calcProd.stage !== undefined && calcProd.stage !== null
                                                ? `${calcProd.stage}%`
                                                : "10%"}
                                        </div>
                                    )}
                                </td>
                                {isEditing && (
                                    <td className="p-1.5 text-center">
                                        <button
                                            type="button"
                                            onClick={() => onRemoveProduct(groupName, idx)}
                                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 w-7 h-7"
                                            title="삭제"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
