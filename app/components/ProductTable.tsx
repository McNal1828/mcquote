import { Trash2 } from "lucide-react";

interface ProductTableProps {
  rawProducts: any[];         // 수정 가능한 원본 제품 배열 (e.g. groupProducts)
  finalProducts: any[];       // getFinalProducts() 처리 완료된 계산 데이터 배열
  isEditable?: boolean;       // 수정 활성화 여부 (기본값: false)
  calcMode: "DC" | "PPC" | "MARGIN" | string; // 현재 계산 모드
  masterProducts: any[];      // 마스터 제품 데이터 목록
  vendorFilter?: string;      // 벤더 필터링 조건
  onChangeProduct?: (idx: number, field: string, value: any) => void; // 값 변경 콜백
  onRemoveProduct?: (idx: number) => void;                            // 제품 삭제 콜백
}

export default function ProductTable({
  rawProducts,
  finalProducts,
  isEditable = false,
  calcMode,
  masterProducts,
  vendorFilter = "",
  onChangeProduct,
  onRemoveProduct,
}: ProductTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs text-left table-fixed min-w-[1250px]">
        <thead className="bg-gray-50 dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 border-b dark:border-gray-700 whitespace-nowrap">
          <tr className="divide-x divide-gray-200 dark:divide-gray-700">
            <th className="p-1.5 font-semibold text-center w-16">매출년</th>
            <th className="p-1.5 font-semibold text-center w-12">매출월</th>
            <th className="p-1.5 font-semibold text-center w-32">제품코드</th>
            <th className="p-1.5 font-semibold text-center w-16">수량</th>
            <th className="p-1.5 font-semibold text-center w-10">기간</th>
            <th className="p-1.5 font-semibold text-center w-17">DC달러(%)</th>
            <th className="p-1.5 font-semibold text-center w-22">달러PPC($)</th>
            <th className="p-1.5 font-semibold text-center w-22">달러net($)</th>
            <th className="p-1.5 font-semibold text-center w-15">환율(₩)</th>
            <th className="p-1.5 font-semibold text-center w-24">원화PPC(₩)</th>
            <th className="p-1.5 font-semibold text-center w-17">DC원화(%)</th>
            <th className="p-1.5 font-semibold text-center w-24">공급가(₩)</th>
            <th className="p-1.5 font-semibold text-center w-24">마진(₩)</th>
            <th className="p-1.5 font-semibold text-center w-20">마진%</th>
            <th className="p-1.5 font-semibold text-center w-13">단계</th>
            {isEditable && <th className="p-1.5 font-semibold text-center w-12">관리</th>}
          </tr>
        </thead>
        <tbody>
          {finalProducts.map((calcProd: any, idx: number) => {
            const rawProd = rawProducts[idx];
            if (!rawProd) return null;

            // 벤더 정보 및 마스터 품목 기준 필터링
            const filteredMaster = masterProducts.filter((p: any) => {
              const vendorMatches = !vendorFilter || vendorFilter.split(",").includes(p.vendor);
              const isAvailableOrSelected = p.available === 1 || p.available === undefined || p.code === rawProd.제품코드;
              return vendorMatches && isAvailableOrSelected;
            });

            return (
              <tr
                key={idx}
                className="border-b last:border-b-0 border-gray-200 dark:border-gray-600 hover:!bg-blue-100 dark:hover:!bg-gray-600 divide-x divide-gray-200 dark:divide-gray-600"
              >
                {/* 1. 매출년 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      value={rawProd.년차}
                      onChange={(e) => onChangeProduct?.(idx, "년차", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                    />
                  ) : (
                    <div className="text-center px-1.5">
                      {calcProd.년차 !== undefined ? calcProd.년차 : calcProd.year}
                    </div>
                  )}
                </td>

                {/* 2. 매출월 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={rawProd.매출월 ?? ""}
                      onChange={(e) => {
                        onChangeProduct?.(idx, "매출월", e.target.value);
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value, 10);
                        if (isNaN(num)) {
                          onChangeProduct?.(idx, "매출월", 1);
                        } else {
                          const val = Math.max(1, Math.min(12, num));
                          onChangeProduct?.(idx, "매출월", val);
                        }
                      }}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                    />
                  ) : (
                    <div className="text-center px-1.5">
                      {calcProd.매출월 !== undefined ? calcProd.매출월 : (calcProd.month || 1)}
                    </div>
                  )}
                </td>

                {/* 3. 제품코드 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <select
                      value={rawProd.제품코드}
                      onChange={(e) => onChangeProduct?.(idx, "제품코드", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs"
                    >
                      <option value="">제품 선택</option>
                      {filteredMaster.map((p: any) => (
                        <option key={p.code} value={p.code}>
                          {p.available === 0 ? "[단종] " : ""}{p.code} - {p.description}{" "}
                          {p.vendor && !vendorFilter ? ` [${p.vendor}]` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="px-1.5 block truncate" title={calcProd.제품코드}>
                      {calcProd.제품코드 || "-"}
                    </span>
                  )}
                </td>

                {/* 4. 수량 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      value={rawProd.수량}
                      onChange={(e) => onChangeProduct?.(idx, "수량", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                    />
                  ) : (
                    <div className="text-right px-1.5">{calcProd.수량}</div>
                  )}
                </td>

                {/* 5. 기간 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      value={rawProd.기간}
                      onChange={(e) => onChangeProduct?.(idx, "기간", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                    />
                  ) : (
                    <div className="text-center px-1.5">{calcProd.기간}</div>
                  )}
                </td>

                {/* 6. DC달러(%) */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      step="any"
                      value={rawProd.DC달러}
                      onChange={(e) => onChangeProduct?.(idx, "DC달러", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                    />
                  ) : (
                    <div className="text-right px-1.5">{calcProd.DC달러}%</div>
                  )}
                </td>

                {/* 7. 달러PPC($) */}
                <td className="p-1.5 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                  ${Number(calcProd.달러PPC || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>

                {/* 8. 달러net($) */}
                <td className="p-1.5 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                  ${Number(calcProd.달러net || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>

                {/* 9. 환율(₩) */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      step="any"
                      value={rawProd.환율}
                      onChange={(e) => onChangeProduct?.(idx, "환율", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                    />
                  ) : (
                    <div className="text-right px-1.5">₩{Number(calcProd.환율 || 0).toLocaleString()}</div>
                  )}
                </td>

                {/* 10. 원화PPC(₩) */}
                {isEditable && calcMode === "PPC" ? (
                  <td className="p-1.5">
                    <input
                      type="number"
                      value={rawProd.원화PPC !== undefined ? rawProd.원화PPC : calcProd.원화PPC}
                      onChange={(e) => onChangeProduct?.(idx, "원화PPC", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right font-medium"
                    />
                  </td>
                ) : (
                  <td className="p-1.5 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                    ₩{Number(calcProd.원화PPC || 0).toLocaleString()}
                  </td>
                )}

                {/* 11. DC원화(%) */}
                {isEditable && calcMode === "DC" ? (
                  <td className="p-1.5">
                    <input
                      type="number"
                      step="any"
                      value={rawProd.DC원화}
                      onChange={(e) => onChangeProduct?.(idx, "DC원화", e.target.value)}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right"
                    />
                  </td>
                ) : (
                  <td className="p-1.5 text-right text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                    {calcProd.DC원화}%
                  </td>
                )}

                {/* 12. 공급가(₩) */}
                <td className="p-1.5 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                  ₩{Number(calcProd.공급가 || 0).toLocaleString()}
                </td>

                {/* 13. 마진(₩) */}
                <td className="p-1.5 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/50">
                  ₩{Math.round(Number(calcProd.마진 || 0)).toLocaleString()}
                </td>

                {/* 14. 마진% */}
                {isEditable && calcMode === "MARGIN" ? (
                  <td className="p-1.5">
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="any"
                        value={rawProd.마진율 !== undefined ? rawProd.마진율 : calcProd.마진율}
                        onChange={(e) => onChangeProduct?.(idx, "마진율", e.target.value)}
                        className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-right font-bold text-blue-600 dark:text-blue-400"
                      />
                      <span className="ml-1 text-blue-600 dark:text-blue-400 font-bold">%</span>
                    </div>
                  </td>
                ) : (
                  <td className="p-1.5 text-right font-bold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/50">
                    {calcProd.마진율}%
                  </td>
                )}

                {/* 15. 단계 */}
                <td className="p-1.5">
                  {isEditable ? (
                    <input
                      type="number"
                      value={rawProd.stage ?? ""}
                      onChange={(e) => onChangeProduct?.(idx, "stage", e.target.value)}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value, 10);
                        if (isNaN(num)) {
                          onChangeProduct?.(idx, "stage", 10);
                        } else {
                          onChangeProduct?.(idx, "stage", num);
                        }
                      }}
                      className="w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-xs text-center"
                    />
                  ) : (
                    <div className="text-center px-1.5">
                      {calcProd.stage !== undefined && calcProd.stage !== null ? `${calcProd.stage}%` : "10%"}
                    </div>
                  )}
                </td>

                {/* 16. 관리 */}
                {isEditable && (
                  <td className="p-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => onRemoveProduct?.(idx)}
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
