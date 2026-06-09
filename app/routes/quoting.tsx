import { useState } from "react";
import {
    useSubmit,
    redirect,
    useActionData,
    useNavigation,
} from "react-router";
import db from "../db.server";
import type { Route } from "./+types/quoting";

export async function loader({ request }: Route.LoaderArgs) {
    // 제품(products) 목록을 DB에서 불러옵니다.
    const stmt = db.prepare("SELECT code, description, lpd, lpw FROM products");
    const products = stmt.all();

    const partners = db
        .prepare("SELECT id, name FROM partners ORDER BY name ASC")
        .all();
    const partnerContacts = db
        .prepare(
            "SELECT id, partner_id, name, email, phone FROM partner_contacts ORDER BY name ASC",
        )
        .all();
    const ams = db.prepare("SELECT id, name FROM ams ORDER BY name ASC").all();
    return { products, partners, partnerContacts, ams };
}

export async function action({ request }: Route.ActionArgs) {
    // 클라이언트에서 JSON 형태로 전송한 데이터를 파싱합니다.
    const data = await request.json();
    const { basicInfo, dealFlows, products, notes, calcMode } = data;
    const now = Date.now();
    const quote_type = calcMode === "PPC" ? 0 : 1;

    try {
        const stmt = db.prepare(`
            INSERT INTO quotes (
                client_company, client_contact_name, client_contact_email, client_contact_phone,
                project_name, quote_type, products, created_at, updated_at, 
                contract_type, deal_flow, stage, note,
                partner_id, partner_contact_id, am_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            basicInfo.clientCompany,
            basicInfo.clientName,
            basicInfo.clientEmail,
            basicInfo.clientPhone,
            basicInfo.projectName,
            quote_type,
            JSON.stringify(products),
            now,
            now,
            basicInfo.contractType,
            JSON.stringify(dealFlows),
            1,
            JSON.stringify(notes),
            basicInfo.partnerId ? Number(basicInfo.partnerId) : null,
            basicInfo.partnerContactId
                ? Number(basicInfo.partnerContactId)
                : null,
            basicInfo.amId ? Number(basicInfo.amId) : null,
        );

        // 성공적으로 저장되면 홈(견적 목록) 페이지로 이동합니다.
        return redirect("/");
    } catch (error) {
        console.error("견적 등록 실패:", error);
        return { error: "견적 등록 중 오류가 발생했습니다." };
    }
}

export default function Quoting({ loaderData }: Route.ComponentProps) {
    const submit = useSubmit();
    const actionData = useActionData<{ error?: string }>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    // 1. 기본 및 담당자/영업 정보 상태 관리
    const [basicInfo, setBasicInfo] = useState({
        projectName: "",
        clientCompany: "",
        clientName: "",
        clientEmail: "",
        clientPhone: "",
        partnerId: "",
        partnerContactId: "",
        partnerCompany: "",
        partnerName: "",
        partnerEmail: "",
        partnerPhone: "",
        amName: "",
        amId: "",
        contractType: "",
    });

    // Deal Flow 상태 관리 (배열로 관리하여 여러 단계 추가 가능)
    const [dealFlows, setDealFlows] = useState<string[]>([""]);

    // 2. 제품 상세 목록 상태 관리
    const [products, setProducts] = useState([
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

    // 3. 비고 상태 관리
    const [notes, setNotes] = useState<string[]>([""]);

    // 4. 계산 기준 모드 상태 관리 (기본값: DC원화 기준)
    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN">("DC");

    // 기본 정보 입력 핸들러
    const handleBasicInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setBasicInfo((prev) => {
            const next = { ...prev, [name]: value };

            if (name === "partnerCompany") {
                const matchedPartner = loaderData.partners.find(
                    (p: any) => p.name === value,
                );
                next.partnerId = matchedPartner ? matchedPartner.id : "";
            } else if (name === "partnerName") {
                const matchedContact = loaderData.partnerContacts.find(
                    (c: any) =>
                        c.name === value &&
                        (!next.partnerId || c.partner_id == next.partnerId),
                );
                if (matchedContact) {
                    next.partnerContactId = matchedContact.id;
                    next.partnerEmail = matchedContact.email || "";
                    next.partnerPhone = matchedContact.phone || "";
                    if (!next.partnerId) {
                        const p = loaderData.partners.find(
                            (p: any) => p.id === matchedContact.partner_id,
                        );
                        if (p) {
                            next.partnerCompany = p.name;
                            next.partnerId = p.id;
                        }
                    }
                } else {
                    next.partnerContactId = "";
                }
            } else if (name === "amName") {
                const matchedAm = loaderData.ams.find(
                    (a: any) => a.name === value,
                );
                next.amId = matchedAm ? matchedAm.id : "";
            }
            return next;
        });
    };

    // 제품 테이블 행(Row) 추가/삭제/변경 핸들러
    const handleAddProduct = () => {
        setProducts((prev) => [
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
                    updatedProduct.제품설명 = matched.description || "";
                }
            }

            // 역산 로직 추가 (원화PPC 또는 마진율 변경 시 DC원화 재계산)
            // TODO: 선택된 calcMode에 따라 입력 필드 제어 및 역산 로직도 추후 분기 처리가 필요할 수 있습니다.
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

    // 계산 기준 변경 핸들러 (모드 변경 시 이전 기준의 계산값을 바탕으로 새로운 기준의 입력 상태를 동기화)
    const handleCalcModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMode = e.target.value as "PPC" | "DC" | "MARGIN";

        setProducts((prev) =>
            prev.map((prod) => {
                // 1. 기존 calcMode를 바탕으로 현재 화면에 렌더링되고 있는 최종 '공급가'를 계산합니다.
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
                    if (inputMarginPercent < 100) {
                        supplyPrice =
                            Math.round(
                                wonNet / (1 - inputMarginPercent / 100) / 1000,
                            ) * 1000;
                    } else {
                        supplyPrice = 0;
                    }
                }

                // 2. 도출된 '공급가'를 바탕으로 나머지 파생 변수들을 역산합니다.
                let currentWonPpc =
                    qty * period > 0 ? supplyPrice / (qty * period) : 0;

                // 원화 PPC 기준으로 변경될 경우, 도출된 원화PPC를 반올림하고 공급가를 재조정합니다.
                if (newMode === "PPC") {
                    currentWonPpc = Math.round(currentWonPpc);
                    supplyPrice = currentWonPpc * qty * period;
                }

                const currentMargin = supplyPrice - wonNet;
                const currentMarginPercent = supplyPrice
                    ? ((currentMargin / supplyPrice) * 100).toFixed(1)
                    : "0.0";

                const baseTotalLpw = lpw * qty * period;
                let currentDcWon = dcWon;
                if (baseTotalLpw > 0) {
                    const rawDcWon = (1 - supplyPrice / baseTotalLpw) * 100;
                    currentDcWon = Math.trunc(rawDcWon * 100) / 100;
                }

                // 3. 역산된 최신 값들을 state에 덮어씌워, 모드 전환 시 이전 상태값(입력값)이 튀는 것을 방지합니다.
                return {
                    ...prod,
                    원화PPC: currentWonPpc,
                    마진율: currentMarginPercent,
                    DC원화: currentDcWon,
                };
            }),
        );

        setCalcMode(newMode);
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

        // 제출하기 직전에 화면에 보여지는 실시간 계산값들을 products 배열에 완전히 덮어씌웁니다.
        const finalProducts = products.map((prod) => {
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

        // 현재 가지고 있는 모든 상태를 묶어서 서버 액션(JSON 형식)으로 제출합니다.
        submit(
            { basicInfo, dealFlows, products: finalProducts, notes, calcMode },
            { method: "post", encType: "application/json" },
        );
    };

    // 엑셀 다운로드 핸들러
    const downloadFile = async (type: string, filename: string) => {
        // 서버 API에 type 파라미터를 넘겨 어떤 파일을 만들지 구분할 수 있습니다.
        const response = await fetch(`/api/download?type=${type}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                products,
                partnerCompany: basicInfo.partnerCompany,
                partnerName: basicInfo.partnerName,
                clientCompany: basicInfo.clientCompany,
                projectName: basicInfo.projectName,
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

    const handleDownloadExcel = async () => {
        if (products.length === 0) {
            alert("다운로드할 제품이 없습니다.");
            return;
        }

        try {
            // 오늘 날짜를 한국 시간 기준 YYMMDD 포맷으로 추출 (예: 260609)
            const now = new Date();
            const kstDateString = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(now);
            const [yyyy, mm, dd] = kstDateString.split("-");
            const dateStr = `${yyyy.slice(2)}${mm}${dd}`;

            // 파트너사, 담당자, 고객사, 프로젝트명, 날짜를 하이픈(-)으로 조합
            // (빈 칸이거나 입력되지 않은 값은 filter(Boolean)으로 깔끔하게 제외합니다)
            const prefix = [
                basicInfo.partnerCompany?.trim(),
                basicInfo.partnerName?.trim(),
                basicInfo.clientCompany?.trim(),
                basicInfo.projectName?.trim(),
                dateStr,
            ]
                .filter(Boolean)
                .join("-");

            // 동시에 여러 파일 다운로드 실행
            await Promise.all([
                downloadFile("cost", `${prefix}-원가표.xlsx`),
                downloadFile("quote", `${prefix}-견적서.xlsx`),
            ]);
        } catch (error) {
            console.error(error);
            alert("엑셀 다운로드 중 오류가 발생했습니다.");
        }
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 등록
            </h1>

            {/* 서버 저장 실패 시 에러 메시지 표시 */}
            {actionData?.error && (
                <div className="mb-6 p-4 bg-red-100 text-red-700 border border-red-400 rounded">
                    {actionData.error}
                </div>
            )}

            {/* 파트너사 및 담당자 자동완성(콤보박스)을 위한 datalist */}
            <datalist id="partner-list">
                {loaderData.partners.map((p: any) => (
                    <option key={p.id} value={p.name} />
                ))}
            </datalist>
            <datalist id="contact-list">
                {loaderData.partnerContacts
                    .filter(
                        (c: any) =>
                            !basicInfo.partnerId ||
                            c.partner_id == basicInfo.partnerId,
                    )
                    .map((c: any) => (
                        <option key={c.id} value={c.name} />
                    ))}
            </datalist>
            <datalist id="am-list">
                {loaderData.ams.map((a: any) => (
                    <option key={a.id} value={a.name} />
                ))}
            </datalist>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* 0. 기본 프로젝트 정보 (상단 추가) */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 grid grid-cols-1 gap-4">
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
                                list="partner-list"
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
                                list="contact-list"
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
                                list="am-list"
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
                        <div className="flex items-center gap-4">
                            {/* 계산 기준 선택 영역 */}
                            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded border border-gray-200 dark:border-gray-600">
                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 ml-2">
                                    계산 기준:
                                </span>
                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                    <input
                                        type="radio"
                                        name="calcMode"
                                        value="PPC"
                                        checked={calcMode === "PPC"}
                                        onChange={handleCalcModeChange}
                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        PPC
                                    </span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                    <input
                                        type="radio"
                                        name="calcMode"
                                        value="DC"
                                        checked={calcMode === "DC"}
                                        onChange={handleCalcModeChange}
                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        DC원화
                                    </span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                    <input
                                        type="radio"
                                        name="calcMode"
                                        value="MARGIN"
                                        checked={calcMode === "MARGIN"}
                                        onChange={handleCalcModeChange}
                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">
                                        마진
                                    </span>
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={handleAddProduct}
                                className="bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/50 px-3 py-1.5 rounded text-sm font-medium transition-colors"
                            >
                                + 제품 추가
                            </button>
                        </div>
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

                                    // 1. 기준 공급가 (DC원화 바탕)
                                    let supplyPrice =
                                        Math.round(
                                            (lpw *
                                                qty *
                                                period *
                                                (1 - dcWon / 100)) /
                                                1000,
                                        ) * 1000;

                                    // 2. 선택된 계산 기준(calcMode)에 따른 공급가(supplyPrice) 덮어쓰기
                                    if (
                                        calcMode === "PPC" &&
                                        (prod as any).원화PPC !== undefined
                                    ) {
                                        supplyPrice =
                                            Number((prod as any).원화PPC) *
                                            qty *
                                            period;
                                    } else if (
                                        calcMode === "MARGIN" &&
                                        (prod as any).마진율 !== undefined
                                    ) {
                                        const inputMarginPercent = Number(
                                            (prod as any).마진율,
                                        );
                                        if (inputMarginPercent < 100) {
                                            supplyPrice =
                                                Math.round(
                                                    wonNet /
                                                        (1 -
                                                            inputMarginPercent /
                                                                100) /
                                                        1000,
                                                ) * 1000;
                                        } else {
                                            supplyPrice = 0;
                                        }
                                    }

                                    // 3. 결정된 공급가를 바탕으로 나머지 파생 변수 일괄 계산 (중복 로직 제거)
                                    const wonPpc =
                                        qty * period > 0
                                            ? supplyPrice / (qty * period)
                                            : 0;
                                    const margin = supplyPrice - wonNet;
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
                                                <select
                                                    value={prod.제품코드}
                                                    onChange={(e) =>
                                                        handleProductChange(
                                                            idx,
                                                            "제품코드",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white text-sm"
                                                >
                                                    <option value="">
                                                        제품 선택
                                                    </option>
                                                    {loaderData.products.map(
                                                        (p: any) => (
                                                            <option
                                                                key={p.code}
                                                                value={p.code}
                                                            >
                                                                {p.code} -{" "}
                                                                {p.description}
                                                            </option>
                                                        ),
                                                    )}
                                                </select>
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
                                            {calcMode === "PPC" ? (
                                                <td className="p-2">
                                                    <input
                                                        type="number"
                                                        value={
                                                            (prod as any)
                                                                .원화PPC !==
                                                            undefined
                                                                ? (prod as any)
                                                                      .원화PPC
                                                                : Math.round(
                                                                      wonPpc,
                                                                  )
                                                        }
                                                        onChange={(e) =>
                                                            handleProductChange(
                                                                idx,
                                                                "원화PPC",
                                                                e.target.value,
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
                                            {calcMode === "DC" ? (
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
                                            ) : (
                                                <td className="p-2 text-right text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                    {prod.DC원화}%
                                                </td>
                                            )}
                                            <td className="p-2 text-right font-medium text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
                                                ₩{supplyPrice.toLocaleString()}
                                            </td>
                                            <td className="p-2 text-right text-green-600 dark:text-green-400 bg-gray-50 dark:bg-gray-800/50">
                                                ₩
                                                {Math.round(
                                                    margin,
                                                ).toLocaleString()}
                                            </td>
                                            {calcMode === "MARGIN" ? (
                                                <td className="p-2">
                                                    <div className="flex items-center">
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={
                                                                (prod as any)
                                                                    .마진율 !==
                                                                undefined
                                                                    ? (
                                                                          prod as any
                                                                      ).마진율
                                                                    : marginPercent
                                                            }
                                                            onChange={(e) =>
                                                                handleProductChange(
                                                                    idx,
                                                                    "마진율",
                                                                    e.target
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
                                                    {marginPercent}%
                                                </td>
                                            )}
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
                        disabled={isSubmitting}
                        className={`px-6 py-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-colors ${isSubmitting ? "opacity-70 cursor-not-allowed" : ""}`}
                    >
                        {isSubmitting ? "등록 중..." : "견적 등록하기"}
                    </button>
                </div>
            </form>
        </div>
    );
}
