import { useState } from "react";
import db from "../db.server";
import type { Route } from "./+types/quoting";

export async function loader({ request }: Route.LoaderArgs) {
    // 제품(products) 목록을 DB에서 불러옵니다.
    const stmt = db.prepare("SELECT code, description, lpd, lpw FROM products");
    const products = stmt.all();
    return { products };
}

export default function Quoting({ loaderData }: Route.ComponentProps) {
    // 1. 기본 및 담당자/영업 정보 상태 관리
    const [basicInfo, setBasicInfo] = useState({
        projectName: "",
        expectedQuarter: "",
        clientCompany: "",
        clientName: "",
        clientEmail: "",
        clientPhone: "",
        partnerCompany: "",
        partnerName: "",
        partnerEmail: "",
        partnerPhone: "",
        amName: "",
        contractType: "",
    });

    // Deal Flow 상태 관리 (배열로 관리하여 여러 단계 추가 가능)
    const [dealFlows, setDealFlows] = useState<string[]>([""]);

    // 2. 제품 상세 목록 상태 관리
    const [products, setProducts] = useState([
        {
            제품코드: "",
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
        },
    ]);

    // 3. 비고 상태 관리
    const [notes, setNotes] = useState<string[]>([""]);

    // 기본 정보 입력 핸들러
    const handleBasicInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setBasicInfo((prev) => ({ ...prev, [name]: value }));
    };

    // 제품 테이블 행(Row) 추가/삭제/변경 핸들러
    const handleAddProduct = () => {
        setProducts((prev) => [
            ...prev,
            {
                제품코드: "",
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
            },
        ]);
    };

    const handleRemoveProduct = (index: number) => {
        setProducts((prev) => prev.filter((_, i) => i !== index));
    };

    const handleProductChange = (index: number, field: string, value: any) => {
        setProducts((prev) => {
            const newProducts = [...prev];
            const updatedProduct = { ...newProducts[index], [field]: value };

            // 제품코드 선택 시 lpd, lpw 값 자동 불러오기
            if (field === "제품코드") {
                const matched = loaderData.products.find(
                    (p: any) => p.code === value,
                );
                if (matched) {
                    updatedProduct.lpd = matched.lpd || 0;
                    updatedProduct.lpw = matched.lpw || 0;
                }
            }

            newProducts[index] = updatedProduct;
            return newProducts;
        });
    };

    // 비고 항목 추가/삭제/변경 핸들러
    const handleAddNote = () => {
        setNotes((prev) => [...prev, ""]);
    };

    const handleRemoveNote = (index: number) => {
        setNotes((prev) => prev.filter((_, i) => i !== index));
    };

    const handleNoteChange = (index: number, value: string) => {
        setNotes((prev) => {
            const newNotes = [...prev];
            newNotes[index] = value;
            return newNotes;
        });
    };

    // Deal Flow 항목 추가/삭제/변경 핸들러
    const handleAddDealFlow = () => {
        setDealFlows((prev) => [...prev, ""]);
    };

    const handleRemoveDealFlow = (index: number) => {
        setDealFlows((prev) => prev.filter((_, i) => i !== index));
    };

    const handleDealFlowChange = (index: number, value: string) => {
        setDealFlows((prev) => {
            const newFlows = [...prev];
            newFlows[index] = value;
            return newFlows;
        });
    };

    // 등록 버튼 클릭 시 호출
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: 서버의 DB로 폼 데이터를 전송하는 로직을 나중에 구현합니다.
        console.log({ basicInfo, dealFlows, products, notes });
        alert("견적 데이터가 준비되었습니다. 콘솔 창을 확인하세요.");
    };

    // 엑셀 다운로드 핸들러
    const handleDownloadExcel = async () => {
        if (products.length === 0) {
            alert("다운로드할 제품이 없습니다.");
            return;
        }

        try {
            const response = await fetch("/api/download", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ products }),
            });

            if (!response.ok) {
                throw new Error("다운로드 실패");
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "cost.xlsx";
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);
            alert("엑셀 다운로드 중 오류가 발생했습니다.");
        }
    };

    return (
        <div className="p-8 container mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 등록
            </h1>

            {/* 제품코드 자동완성(콤보박스)을 위한 datalist */}
            <datalist id="product-list">
                {loaderData.products.map((p: any) => (
                    <option key={p.code} value={p.code}>
                        {p.description}
                    </option>
                ))}
            </datalist>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* 0. 기본 프로젝트 정보 (상단 추가) */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            사업명
                        </label>
                        <input
                            type="text"
                            name="projectName"
                            value={basicInfo.projectName}
                            onChange={handleBasicInfoChange}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="예: 차세대 인프라 구축"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            예상 분기
                        </label>
                        <input
                            type="text"
                            name="expectedQuarter"
                            value={basicInfo.expectedQuarter}
                            onChange={handleBasicInfoChange}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="예: FY25Q1"
                        />
                    </div>
                </div>

                {/* 1. 담당자 및 영업 요약 정보 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    {/* 고객사 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <span className="mr-2">🏢</span> 고객사 정보
                        </h4>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                고객사명
                            </label>
                            <input
                                type="text"
                                name="clientCompany"
                                value={basicInfo.clientCompany}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                담당자 이름
                            </label>
                            <input
                                type="text"
                                name="clientName"
                                value={basicInfo.clientName}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                이메일
                            </label>
                            <input
                                type="email"
                                name="clientEmail"
                                value={basicInfo.clientEmail}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                연락처
                            </label>
                            <input
                                type="text"
                                name="clientPhone"
                                value={basicInfo.clientPhone}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                    </div>

                    {/* 파트너사 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <span className="mr-2">🤝</span> 파트너사 정보
                        </h4>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                파트너사명
                            </label>
                            <input
                                type="text"
                                name="partnerCompany"
                                value={basicInfo.partnerCompany}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                담당자 이름
                            </label>
                            <input
                                type="text"
                                name="partnerName"
                                value={basicInfo.partnerName}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                이메일
                            </label>
                            <input
                                type="email"
                                name="partnerEmail"
                                value={basicInfo.partnerEmail}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                연락처
                            </label>
                            <input
                                type="text"
                                name="partnerPhone"
                                value={basicInfo.partnerPhone}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                    </div>

                    {/* 영업 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <span className="mr-2">👤</span> 영업 정보
                        </h4>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                AM 이름
                            </label>
                            <input
                                type="text"
                                name="amName"
                                value={basicInfo.amName}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                계약방식
                            </label>
                            <input
                                type="text"
                                name="contractType"
                                value={basicInfo.contractType}
                                onChange={handleBasicInfoChange}
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1 flex justify-between items-center">
                                <span>Deal Flow</span>
                                <button
                                    type="button"
                                    onClick={handleAddDealFlow}
                                    className="text-blue-500 hover:text-blue-700 font-bold px-1 rounded bg-blue-50 dark:bg-blue-900/30"
                                >
                                    +
                                </button>
                            </label>
                            <div className="space-y-2">
                                {dealFlows.map((flow, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center gap-2"
                                    >
                                        {idx > 0 && (
                                            <span className="text-gray-400">
                                                ➔
                                            </span>
                                        )}
                                        <input
                                            type="text"
                                            value={flow}
                                            onChange={(e) =>
                                                handleDealFlowChange(
                                                    idx,
                                                    e.target.value,
                                                )
                                            }
                                            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm"
                                            placeholder={`단계 ${idx + 1}`}
                                        />
                                        {dealFlows.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleRemoveDealFlow(idx)
                                                }
                                                className="text-red-500 hover:text-red-700 font-bold px-1"
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. 제품 상세 테이블 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                            <span className="mr-2">📦</span> 제품 상세
                        </h3>
                        <button
                            type="button"
                            onClick={handleAddProduct}
                            className="bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                        >
                            + 제품 추가
                        </button>
                    </div>
                    <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-600">
                        <table className="w-full text-sm text-left table-fixed min-w-[1450px]">
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
                                    <th className="p-2 font-semibold text-center w-28">
                                        달러원가($)
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
                                        원화net(₩)
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
                                    <th className="p-2 font-semibold text-right w-20">
                                        마진%
                                    </th>
                                    <th className="p-2 font-semibold text-center w-20">
                                        년차
                                    </th>
                                    <th className="p-2 font-semibold text-center w-16">
                                        관리
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((prod, idx) => {
                                    // 실시간 계산 로직
                                    const lpd = Number(prod.lpd) || 0;
                                    const lpw = Number(prod.lpw) || 0;
                                    const qty = Number(prod.수량) || 0;
                                    const period = Number(prod.기간) || 0;
                                    const dcDollar = Number(prod.DC달러) || 0;
                                    const exchangeRate = Number(prod.환율) || 0;
                                    const dcWon = Number(prod.DC원화) || 0;

                                    const dollarPpc =
                                        lpd * (1 - dcDollar / 100);
                                    const dollarCost = lpd * qty * period;
                                    const dollarNet = dollarPpc * qty * period;
                                    const wonNet = dollarNet * exchangeRate;

                                    // 공급가: lpw * 수량 * 기간 * (1 - DC원화/100) -> 반올림 3자리(천 단위로 맞춤)
                                    const rawSupplyPrice =
                                        lpw * qty * period * (1 - dcWon / 100);
                                    const supplyPrice =
                                        Math.round(rawSupplyPrice / 1000) *
                                        1000;

                                    // 마진: 공급가 - 원화net
                                    const margin = supplyPrice - wonNet;

                                    // 마진율: (마진 / 공급가) * 100
                                    const marginPercent = supplyPrice
                                        ? (
                                              (margin / supplyPrice) *
                                              100
                                          ).toFixed(1)
                                        : "0.0";

                                    return (
                                        <tr
                                            key={idx}
                                            className="border-b last:border-b-0 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 divide-x divide-gray-200 dark:divide-gray-600"
                                        >
                                            <td className="p-2">
                                                <input
                                                    type="text"
                                                    list="product-list"
                                                    value={prod.제품코드}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "제품코드",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm"
                                                    placeholder="선택 또는 입력"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    value={prod.수량}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "수량",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    value={prod.기간}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "기간",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-center"
                                                />
                                            </td>
                                            <td className="p-2 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                                $
                                                {dollarCost.toLocaleString(
                                                    undefined,
                                                    {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    },
                                                )}
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={prod.DC달러}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "DC달러",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                />
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
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={prod.환율}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "환율",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                />
                                            </td>
                                            <td className="p-2 text-right text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                                                ₩
                                                {Math.round(
                                                    wonNet,
                                                ).toLocaleString()}
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={prod.DC원화}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "DC원화",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-right"
                                                />
                                            </td>
                                            <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                ₩{supplyPrice.toLocaleString()}
                                            </td>
                                            <td className="p-2 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/50">
                                                ₩
                                                {Math.round(
                                                    margin,
                                                ).toLocaleString()}
                                            </td>
                                            <td className="p-2 text-right font-bold text-blue-600 dark:text-blue-400 bg-gray-50 dark:bg-gray-800/50">
                                                {marginPercent}%
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    value={prod.년차}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "년차",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm text-center"
                                                />
                                            </td>
                                            <td className="p-2 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleRemoveProduct(idx)
                                                    }
                                                    className="text-red-500 hover:text-red-700 font-bold transition-colors"
                                                    title="삭제"
                                                >
                                                    삭제
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {products.length === 0 && (
                            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                                추가된 제품이 없습니다.
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. 비고 리스트 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                            <span className="mr-2">📝</span> 비고
                        </h3>
                        <button
                            type="button"
                            onClick={handleAddNote}
                            className="bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                        >
                            + 비고 추가
                        </button>
                    </div>
                    <div className="space-y-2">
                        {notes.map((note, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                                <span className="text-gray-400 mt-2 text-sm">
                                    •
                                </span>
                                <textarea
                                    value={note}
                                    onChange={(e) =>
                                        handleNoteChange(idx, e.target.value)
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[40px] resize-y"
                                    placeholder="비고 내용을 입력하세요"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleRemoveNote(idx)}
                                    className="text-red-500 hover:text-red-700 font-bold p-2 mt-1 whitespace-nowrap"
                                >
                                    삭제
                                </button>
                            </div>
                        ))}
                        {notes.length === 0 && (
                            <div className="text-center text-gray-500 dark:text-gray-400 py-4 border border-dashed border-gray-300 dark:border-gray-600 rounded">
                                추가된 비고가 없습니다.
                            </div>
                        )}
                    </div>
                </div>

                {/* 제출 버튼 */}
                <div className="flex justify-end gap-3 pt-4">
                    <button
                        type="button"
                        className="px-6 py-2.5 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={handleDownloadExcel}
                        className="px-6 py-2.5 rounded border border-green-600 text-green-600 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-900/30 font-medium transition-colors"
                    >
                        원가표/견적서 다운로드
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-colors"
                    >
                        견적 등록하기
                    </button>
                </div>
            </form>
        </div>
    );
}
