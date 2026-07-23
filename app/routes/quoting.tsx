import { useState, useEffect } from "react";
import {
    useSubmit,
    useActionData,
    useNavigation,
    useNavigate,
} from "react-router";
import db from "../db.server";
import crypto from "crypto";
import { getFinalProducts, createEmptyProductRow, calculateReverseDCWon } from "~/utils/calculator";
import { sendGasRequest } from "~/utils/gasService";
import ProductTable from "~/components/ProductTable";
import type { Route } from "./+types/quoting";
import {
    Building2,
    Users,
    UserCircle,
    Package,
    FileText,
    Plus,
    Save,
    Trash2,
    X,
    Download,
    AlertCircle,
    CheckCircle2,
} from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
    // 제품(products) 목록 중 사용 가능한 것만 DB에서 불러옵니다.
    const stmt = db.prepare(
        "SELECT id, code, description, lpd, lpw, vendor FROM products WHERE available = 1",
    );
    const products = stmt.all();

    const partners = db
        .prepare("SELECT id, name, vendor FROM partners WHERE available = 1 ORDER BY name ASC")
        .all();
    const partnerContacts = db
        .prepare(
            "SELECT id, partner_id, name, email, phone FROM partner_contacts ORDER BY name ASC",
        )
        .all();
    const ams = db
        .prepare("SELECT id, name, vendor FROM ams ORDER BY name ASC")
        .all();
    const distContacts = db
        .prepare(
            "SELECT id, name, position FROM dist_contacts ORDER BY name ASC",
        )
        .all();

    // 가장 최신 환율 정보 조회
    const lastRateRow = db.prepare("SELECT rate FROM exchange_rate ORDER BY timestamp DESC LIMIT 1").get() as { rate: number } | undefined;
    const defaultExchangeRate = lastRateRow ? lastRateRow.rate : 0;

    return { products, partners, partnerContacts, ams, distContacts, defaultExchangeRate };
}

export async function action({ request }: Route.ActionArgs) {
    // 클라이언트에서 JSON 형태로 전송한 데이터를 파싱합니다.
    const data = await request.json();
    const { basicInfo, dealFlows, products, notes, calcMode, defaultGroup } = data;
    const now = Date.now();
    const quote_type = calcMode === "PPC" ? 0 : 1;

    // 구글 시트 동기화를 위해 임시 수집할 대상을 담는 배열
    const defaultLinesToSync: Array<{
        id: number;
        년차: number;
        매출월: number;
        stage: number;
        공급가: number;
        마진: number;
    }> = [];

    try {
        const historyList = [
            {
                [now]: products,
            }
        ];
        const products_history = JSON.stringify(historyList);

        db.transaction(() => {
            const stmt = db.prepare(`
                INSERT INTO quotes (
                    client_company, client_contact_name, client_contact_email, client_contact_phone,
                    project_name, quote_type, created_at, updated_at, 
                    contract_type, deal_flow, stage, note,
                    partner_id, partner_contact_id, am_id, dist_contact_id,
                    products_history
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const info = stmt.run(
                basicInfo.clientCompany,
                basicInfo.clientName,
                basicInfo.clientEmail,
                basicInfo.clientPhone,
                basicInfo.projectName,
                quote_type,
                now,
                now,
                basicInfo.contractType,
                JSON.stringify(dealFlows),
                10, // 기본 stage (10 = 10%)
                JSON.stringify(notes),
                basicInfo.partnerId ? Number(basicInfo.partnerId) : null,
                basicInfo.partnerContactId ? Number(basicInfo.partnerContactId) : null,
                basicInfo.amId ? Number(basicInfo.amId) : null,
                basicInfo.distContactId ? Number(basicInfo.distContactId) : null,
                products_history,
            );

            const quoteId = info.lastInsertRowid;

            const insertVendor = db.prepare(`
                INSERT INTO quote_vendors (quote_id, vendor)
                VALUES (?, ?)
            `);
            if (basicInfo.vendor) {
                const selectedVendors = basicInfo.vendor.split(",");
                for (const v of selectedVendors) {
                    const cleanV = v.trim();
                    if (cleanV) {
                        insertVendor.run(quoteId, cleanV);
                    }
                }
            }

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

            // products = Record<string, any[]>
            for (const [groupName, prods] of Object.entries(products)) {
                if (!Array.isArray(prods)) continue;

                const groupUuid = crypto.randomUUID();
                const isDefault = groupName === defaultGroup ? 1 : 0;
                const groupInfo = insertGroup.run(quoteId, groupName, groupUuid, isDefault);
                const groupId = groupInfo.lastInsertRowid;

                prods.forEach((line: any, index: number) => {
                    const productCode = line.제품코드;
                    const productRow = selectProduct.get(productCode) as { id: number } | undefined;
                    const productId = productRow ? productRow.id : null;

                    const lineInfo = insertLine.run(
                        groupId,
                        index + 1, // line_number
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
                        Number(line.년차) || 1, // 매출년 (년차)
                        Number(line.원화PPC) || 0,
                        Number(line.매출월) || 1, // 매출월
                        Number(line.stage) || 10 // stage (라인별 단계 기본값 10%)
                    );

                    // 기본 그룹일 경우 구글 시트 동기화 대상에 추가
                    if (isDefault) {
                        defaultLinesToSync.push({
                            id: Number(lineInfo.lastInsertRowid),
                            년차: Number(line.년차) || 1,
                            매출월: Number(line.매출월) || 1,
                            stage: line.stage !== undefined && line.stage !== null && line.stage !== "" ? (Number(line.stage) / 100) : 0.1,
                            공급가: Number(line.공급가) || 0,
                            마진: Number(line.마진) || 0,
                            lpd: Number(line.lpd) || 0,
                            수량: Number(line.수량) || 1,
                            기간: Number(line.기간) || 1,
                            DC달러: Number(line.DC달러) || 0
                        });
                    }
                });
            }
        })();

        // DB 저장이 완벽하게 완료된 후(커밋 후) 구글 스프레드시트 비동기 동기화 전송
        if (defaultLinesToSync.length > 0) {
            const partnerName = db.prepare("SELECT name FROM partners WHERE id = ?").get(Number(basicInfo.partnerId))?.name || "";
            const contactName = db.prepare("SELECT name FROM partner_contacts WHERE id = ?").get(Number(basicInfo.partnerContactId))?.name || "";
            const amName = db.prepare("SELECT name FROM ams WHERE id = ?").get(Number(basicInfo.amId))?.name || "";
            const distName = db.prepare("SELECT name FROM dist_contacts WHERE id = ?").get(Number(basicInfo.distContactId))?.name || "";

            const syncPromises = defaultLinesToSync.map((line) => {
                const netdollar = line.lpd * line.수량 * line.기간 * (1 - line.DC달러 / 100);
                return sendGasRequest("add", {
                    id: line.id,
                    year: line.년차,
                    month: line.매출월,
                    vendor: basicInfo.vendor || "",
                    dist: distName,
                    am: amName,
                    partner: partnerName,
                    contact: contactName,
                    account: basicInfo.clientCompany || "",
                    stage: line.stage,
                    price: line.공급가,
                    margin: line.마진,
                    netdollar: netdollar
                });
            });

            const syncResults = await Promise.all(syncPromises);
            const hasFailure = syncResults.some(r => !r.success);
            if (hasFailure) {
                console.warn("일부 라인이 구글 시트에 동기화되지 못했습니다.");
                return { success: true, warning: "견적은 저장되었으나 구글 시트 동기화 중 일부 실패가 발생했습니다." };
            }
        }

        // 성공적으로 저장되면 성공 플래그를 반환합니다.
        return { success: true };
    } catch (error) {
        console.error("견적 등록 실패:", error);
        return { error: "견적 등록 중 오류가 발생했습니다." };
    }
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

interface SearchableSelectProps {
    label: string;
    options: { id: string | number; name: string }[];
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}

function SearchableSelect({ label, options, value, placeholder, onChange }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");

    const selectedOption = options.find((o) => o.id.toString() === value.toString());
    const displayName = selectedOption ? selectedOption.name : "";

    const filtered = options.filter((o) =>
        o.name.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        if (!isOpen) return;
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Clean dynamic class name for selector
            const sanitizedLabel = label.replace(/[^a-zA-Z0-9]/g, "");
            if (!target.closest(`.searchable-select-${sanitizedLabel}`)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [isOpen, label]);

    return (
        <div className={`relative searchable-select-${label.replace(/[^a-zA-Z0-9]/g, "")}`}>
            <label className="block text-xs font-medium text-gray-500 mb-1">
                {label}
            </label>
            <button
                type="button"
                onClick={() => {
                    setIsOpen(!isOpen);
                    setSearch("");
                }}
                className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white text-sm text-left flex justify-between items-center focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
                <span className={displayName ? "text-gray-800 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}>
                    {displayName || placeholder}
                </span>
                <span className="text-gray-400 text-xs">▼</span>
            </button>

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg max-h-60 overflow-hidden flex flex-col">
                    <div className="p-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="검색..."
                            className="w-full px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 max-h-48 py-1">
                        {filtered.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400 text-center">
                                검색 결과가 없습니다
                            </div>
                        ) : (
                            filtered.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(opt.id.toString());
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${opt.id.toString() === value.toString()
                                        ? "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold"
                                        : "text-gray-700 dark:text-gray-300"
                                        }`}
                                >
                                    {opt.name}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Quoting({ loaderData }: Route.ComponentProps) {
    const { defaultExchangeRate } = loaderData;

    const submit = useSubmit();
    const actionData = useActionData<{ error?: string; success?: boolean }>();
    const navigation = useNavigation();
    const navigate = useNavigate();
    const isSubmitting = navigation.state === "submitting";

    // 1. 기본 및 담당자/영업 정보 상태 관리
    const [basicInfo, setBasicInfo] = useState({
        projectName: "",
        vendor: "Broadcom",
        clientCompany: "",
        clientName: "",
        clientEmail: "",
        clientPhone: "",
        partnerId: "",
        partnerContactId: "",
        amId: "",
        distContactId: "",
        contractType: "",
    });

    // Deal Flow 상태 관리 (배열로 관리하여 여러 단계 추가 가능)
    const [dealFlows, setDealFlows] = useState<string[]>([""]);

    // 2. 제품 상세 목록 상태 관리
    const [products, setProducts] = useState<Record<string, any[]>>({
        "원가표1": [createEmptyProductRow(defaultExchangeRate)],
    });

    // 3. 비고 상태 관리
    const [notes, setNotes] = useState<string[]>([""]);

    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN">("DC");
    const [defaultGroup, setDefaultGroup] = useState<string>("원가표1");

    const [toast, setToast] = useState<{
        message: string;
        type: "error" | "success";
    } | null>(null);

    useEffect(() => {
        if (toast) {
            if (toast.message.includes("진행 중") || toast.message.includes("성공적으로 등록")) {
                return;
            }
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    useEffect(() => {
        if (isSubmitting) {
            setToast({ message: "견적 등록을 진행 중입니다...", type: "success" });
        }
    }, [isSubmitting]);

    useEffect(() => {
        if (actionData) {
            if (actionData.error) {
                setToast({ message: actionData.error, type: "error" });
            } else if (actionData.success) {
                setToast({
                    message: "견적이 성공적으로 등록되었습니다. 잠시 후 홈 화면으로 이동합니다.",
                    type: "success",
                });
                const timer = setTimeout(() => {
                    navigate("/");
                }, 1000);
                return () => clearTimeout(timer);
            }
        }
    }, [actionData, navigate]);

    const updateBasicInfoValue = (name: string, value: string) => {
        handleBasicInfoChange({
            target: { name, value }
        } as any);
    };

    // 기본 정보 입력 핸들러
    const handleBasicInfoChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => {
        const { name, value } = e.target;
        // 벤더가 변경될 경우, AM과 제품 목록을 초기화하여 충돌을 방지합니다.
        if (name === "vendor") {
            setBasicInfo((prev) => ({
                ...prev,
                vendor: value,
                amId: "",
            }));
            setProducts({ "원가표1": [createEmptyProductRow(defaultExchangeRate)] });
            return;
        }
        setBasicInfo((prev) => {
            const next = { ...prev, [name]: value };

            if (name === "partnerId") {
                next.partnerContactId = "";
            } else if (name === "partnerContactId") {
                const matchedContact = (loaderData.partnerContacts as any[]).find(
                    (c: any) => c.id.toString() === value,
                );
                if (matchedContact && !next.partnerId) {
                    const p = (loaderData.partners as any[]).find(
                        (p: any) => p.id === matchedContact.partner_id,
                    );
                    if (p) {
                        next.partnerId = p.id.toString();
                    }
                }
            }
            return next;
        });
    };

    const handleVendorChange = (vendorName: string, checked: boolean) => {
        // 제품 데이터가 입력되어 있으면 확인 요청
        const hasData = Object.values(products).some(prods =>
            prods.some(p => p.제품코드 || p.제품설명)
        );
        if (hasData && !window.confirm("벤더를 변경하면 입력한 제품 데이터가 초기화됩니다. 계속하시겠습니까?")) {
            return;
        }
        setBasicInfo((prev) => {
            const nextVendor = checked ? vendorName : "";
            return {
                ...prev,
                vendor: nextVendor,
                amId: "",
            };
        });
        setProducts({ "원가표1": [createEmptyProductRow(defaultExchangeRate)] });
        setDefaultGroup("원가표1");
    };

    // 그룹 추가/삭제/이름수정 핸들러
    const handleAddGroup = () => {
        setProducts((prev) => {
            let idx = 1;
            while (`원가표${idx}` in prev) {
                idx++;
            }
            const newGroupName = `원가표${idx}`;
            return {
                ...prev,
                [newGroupName]: [createEmptyProductRow(defaultExchangeRate)],
            };
        });
    };

    const handleRemoveGroup = (groupName: string) => {
        if (Object.keys(products).length <= 1) {
            alert("최소 하나의 그룹은 유지해야 합니다.");
            return;
        }
        if (window.confirm(`'${groupName}' 그룹을 삭제하시겠습니까?`)) {
            setProducts((prev) => {
                const next = { ...prev };
                delete next[groupName];
                return next;
            });
            if (defaultGroup === groupName) {
                const remaining = Object.keys(products).filter((k) => k !== groupName);
                if (remaining.length > 0) {
                    setDefaultGroup(remaining[0]);
                }
            }
        }
    };

    const handleRenameGroup = (oldName: string, newName: string) => {
        if (!newName.trim()) {
            alert("그룹 이름을 입력해주세요.");
            return;
        }
        if (oldName === newName) return;
        setProducts((prev) => {
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
        if (defaultGroup === oldName) {
            setDefaultGroup(newName);
        }
    };

    // 특정 그룹의 제품 행(Row) 추가/삭제/변경 핸들러
    const handleAddProduct = (groupName: string) => {
        setProducts((prev) => ({
            ...prev,
            [groupName]: [
                ...(prev[groupName] || []),
                createEmptyProductRow(defaultExchangeRate),
            ],
        }));
    };

    const handleRemoveProduct = (groupName: string, index: number) => {
        setProducts((prev) => ({
            ...prev,
            [groupName]: (prev[groupName] || []).filter((_, i) => i !== index),
        }));
    };

    const handleProductChange = (
        groupName: string,
        index: number,
        field: string,
        value: any,
    ) => {
        setProducts((prev) => {
            const groupProds = prev[groupName] ? [...prev[groupName]] : [];
            const updatedProduct = { ...groupProds[index], [field]: value };

            // 제품코드 선택 시 lpd, lpw 값 자동 불러오기
            if (field === "제품코드") {
                const matched = (loaderData.products as any[]).find(
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



    // 계산 기준 변경 핸들러 (모드 변경 시 이전 기준의 계산값을 바탕으로 새로운 기준의 입력 상태를 동기화)
    const handleCalcModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMode = e.target.value as "PPC" | "DC" | "MARGIN";
        setProducts((prev) => getFinalProducts(prev, calcMode));
        setCalcMode(newMode);
    };

    // 등록 버튼 클릭 시 호출
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // [기본 정보 적합성 검사]
        if (!basicInfo.projectName.trim()) {
            setToast({ message: "사업명을 입력해주세요.", type: "error" });
            return;
        }
        if (!basicInfo.clientCompany.trim()) {
            setToast({ message: "고객사명을 입력해주세요.", type: "error" });
            return;
        }
        if (!basicInfo.partnerId) {
            setToast({ message: "파트너사를 선택해주세요.", type: "error" });
            return;
        }
        if (!basicInfo.partnerContactId) {
            setToast({ message: "파트너사 담당자를 선택해주세요.", type: "error" });
            return;
        }
        if (!basicInfo.amId) {
            setToast({ message: "영업 담당자(AM)를 선택해주세요.", type: "error" });
            return;
        }
        if (!basicInfo.distContactId) {
            setToast({ message: "총판 담당자를 선택해주세요.", type: "error" });
            return;
        }

        // [제품 목록 적합성 검사]
        let hasProduct = false;
        for (const [groupName, prods] of Object.entries(products)) {
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

        // 제출하기 직전에 화면에 보여지는 실시간 계산값들을 products 배열에 완전히 덮어씌웁니다.
        const finalProducts = getFinalProducts(products, calcMode);

        // 제출 전, 빈 칸으로 남겨진 Deal Flow와 비고(Notes)를 깔끔하게 걸러냅니다.
        const finalNotes = notes.map((n) => n.trim()).filter((n) => n !== "");
        const finalDealFlows = dealFlows
            .map((f) => f.trim())
            .filter((f) => f !== "");

        // 다운로드를 먼저 자동 실행합니다.
        await handleDownloadExcel(finalProducts);

        // 현재 가지고 있는 모든 상태를 묶어서 서버 액션(JSON 형식)으로 제출합니다.
        submit(
            {
                basicInfo,
                dealFlows: finalDealFlows,
                products: finalProducts,
                notes: finalNotes,
                calcMode,
                defaultGroup,
            },
            { method: "post", encType: "application/json" },
        );
    };

    // 엑셀 다운로드 핸들러
    const downloadFile = async (
        type: string,
        filename: string,
        productsData: any[],
    ) => {
        // 서버 API에 type 파라미터를 넘겨 어떤 파일을 만들지 구분할 수 있습니다.
        const response = await fetch(`/api/download?type=${type}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                products: productsData,
                partnerCompany: (loaderData.partners as any[]).find((p: any) => p.id.toString() === basicInfo.partnerId)?.name || "",
                partnerName: (loaderData.partnerContacts as any[]).find((c: any) => c.id.toString() === basicInfo.partnerContactId)?.name || "",
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

    const handleDownloadExcel = async (productsData = products) => {
        const grouped = Array.isArray(productsData)
            ? { "원가표": productsData }
            : productsData;

        const totalProductsCount = Object.values(grouped).reduce((sum, prods) => sum + (prods?.length || 0), 0);
        if (totalProductsCount === 0) {
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
            const prefix = [
                ((loaderData.partners as any[]).find((p: any) => p.id.toString() === basicInfo.partnerId)?.name || "").trim(),
                ((loaderData.partnerContacts as any[]).find((c: any) => c.id.toString() === basicInfo.partnerContactId)?.name || "").trim(),
                basicInfo.clientCompany?.trim(),
                basicInfo.projectName?.trim(),
                dateStr,
            ]
                .filter(Boolean)
                .join("-");

            const finalGroupedProducts = getFinalProducts(grouped, calcMode);

            await Promise.all([
                downloadFile(
                    "cost",
                    `${prefix}-원가표.xlsx`,
                    finalGroupedProducts,
                ),
                downloadFile(
                    "quote",
                    `${prefix}-견적서.xlsx`,
                    finalGroupedProducts,
                ),
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

            <form
                onSubmit={handleSubmit}
                onKeyDown={(e) => {
                    if (
                        e.key === "Enter" &&
                        (e.target as HTMLElement).tagName !== "TEXTAREA"
                    ) {
                        e.preventDefault();
                    }
                }}
                className="space-y-6"
            >
                {/* 0. 기본 프로젝트 정보 (상단 추가) */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            사업명
                        </label>
                        <input
                            type="text"
                            name="projectName"
                            value={basicInfo.projectName}
                            onChange={handleBasicInfoChange}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="예: 차세대 인프라 구축"
                        />
                    </div>
                    <div className="w-full md:w-auto flex-shrink-0 min-w-[240px]">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            벤더
                        </label>
                        <div className="flex gap-6 items-center h-10 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 px-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="radio"
                                    name="vendor"
                                    checked={basicInfo.vendor === "Broadcom"}
                                    onChange={(e) => {
                                        if (e.target.checked) handleVendorChange("Broadcom", true);
                                    }}
                                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Broadcom</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="radio"
                                    name="vendor"
                                    checked={basicInfo.vendor === "Omnissa"}
                                    onChange={(e) => {
                                        if (e.target.checked) handleVendorChange("Omnissa", true);
                                    }}
                                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                />
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Omnissa</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* 1. 담당자 및 영업 요약 정보 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    {/* 고객사 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <Building2 className="w-5 h-5 mr-2 text-gray-500" />{" "}
                            고객사 정보
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

                    {/* 담당자 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <Users className="w-5 h-5 mr-2 text-gray-500" />{" "}
                            담당자 정보
                        </h4>
                        <SearchableSelect
                            label="파트너사명"
                            options={(loaderData.partners as any[] || []).filter(
                                (p: any) =>
                                    !basicInfo.vendor ||
                                    (p.vendor ? p.vendor.split(",").includes(basicInfo.vendor) : false)
                            )}
                            value={basicInfo.partnerId}
                            placeholder="파트너사 선택"
                            onChange={(val) => updateBasicInfoValue("partnerId", val)}
                        />
                        <SearchableSelect
                            label="담당자 이름"
                            options={(loaderData.partnerContacts as any[] || []).filter(
                                (c: any) =>
                                    !basicInfo.partnerId ||
                                    c.partner_id.toString() === basicInfo.partnerId,
                            )}
                            value={basicInfo.partnerContactId}
                            placeholder="담당자 선택"
                            onChange={(val) => updateBasicInfoValue("partnerContactId", val)}
                        />
                        <SearchableSelect
                            label="총판 담당자"
                            options={loaderData.distContacts as any[]}
                            value={basicInfo.distContactId}
                            placeholder="총판 담당자 선택"
                            onChange={(val) => updateBasicInfoValue("distContactId", val)}
                        />
                        <SearchableSelect
                            label="담당AM"
                            options={loaderData.ams
                                .filter(
                                    (a: any) =>
                                        !basicInfo.vendor ||
                                        basicInfo.vendor.split(",").includes(a.vendor),
                                )
                                .map((a: any) => ({
                                    id: a.id,
                                    name: a.vendor ? `${a.name} (${a.vendor})` : a.name,
                                }))}
                            value={basicInfo.amId}
                            placeholder="AM 선택"
                            onChange={(val) => updateBasicInfoValue("amId", val)}
                        />
                    </div>

                    {/* 영업 정보 */}
                    <div className="space-y-3">
                        <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center border-b dark:border-gray-700 pb-2">
                            <UserCircle className="w-5 h-5 mr-2 text-gray-500" />{" "}
                            영업 정보
                        </h4>
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
                <div className="space-y-6">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                                <Package className="w-5 h-5 mr-2 text-gray-500" />{" "}
                                제품 상세 설정
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
                                    onClick={handleAddGroup}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 h-8 px-3 shadow"
                                >
                                    <Plus className="w-4 h-4 mr-1" /> 그룹 추가
                                </button>
                            </div>
                        </div>
                    </div>

                    {Object.entries(products).map(([groupName, groupProducts]) => {
                        const finalProds = getFinalProducts(groupProducts, calcMode) as any[];

                        // 그룹별 합계 계산
                        const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                        const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                        const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                        return (
                            <div key={groupName} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 space-y-4">
                                <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3">
                                    <div className="flex items-center gap-4 w-1/2">
                                        <div className="w-60">
                                            <GroupNameInput
                                                value={groupName}
                                                onRename={(newName) => handleRenameGroup(groupName, newName)}
                                            />
                                        </div>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                            <input
                                                type="radio"
                                                name="defaultGroupSelection"
                                                checked={defaultGroup === groupName}
                                                onChange={() => setDefaultGroup(groupName)}
                                                className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                            />
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">기본 원가표</span>
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-4">
                                            <span>공급가 합계: <strong className="text-gray-800 dark:text-gray-200">₩{groupTotalSupply.toLocaleString()}</strong></span>
                                            <span>마진 합계: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleAddProduct(groupName)}
                                                className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                            >
                                                <Plus className="w-3.5 h-3.5 mr-1" /> 제품 추가
                                            </button>
                                            {Object.keys(products).length > 1 && (
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
                                    </div>
                                </div>

                                {groupProducts.length === 0 ? (
                                    <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                                        추가된 제품이 없습니다.
                                    </div>
                                ) : (
                                    <ProductTable
                                        rawProducts={groupProducts}
                                        finalProducts={finalProds}
                                        isEditable={true}
                                        calcMode={calcMode}
                                        masterProducts={loaderData.products}
                                        vendorFilter={basicInfo.vendor}
                                        onChangeProduct={(idx, field, value) => handleProductChange(groupName, idx, field, value)}
                                        onRemoveProduct={(idx) => handleRemoveProduct(groupName, idx)}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 3. 비고 리스트 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg">
                            <FileText className="w-5 h-5 mr-2 text-gray-500" />{" "}
                            비고
                        </h3>
                        <button
                            type="button"
                            onClick={handleAddNote}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 h-8 px-3 shadow-sm"
                        >
                            <Plus className="w-4 h-4 mr-1" /> 비고 추가
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
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] transition-shadow resize-y"
                                    placeholder="비고 내용을 입력하세요"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleRemoveNote(idx)}
                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 w-8 h-8 mt-1"
                                >
                                    <Trash2 className="w-4 h-4" />
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
                        onClick={() => window.history.back()}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-10 px-6"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => handleDownloadExcel(products)}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-white text-green-600 border border-green-600 hover:bg-green-50 dark:bg-gray-800 dark:text-green-400 dark:border-green-500 dark:hover:bg-green-900/30 h-10 px-6 shadow-sm"
                    >
                        <Download className="w-4 h-4 mr-1.5" /> 원가표/견적서
                        다운로드
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting || (actionData && !!actionData.success)}
                        className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 h-10 px-6 shadow ${(isSubmitting || (actionData && !!actionData.success)) ? "opacity-70 cursor-not-allowed" : ""}`}
                    >
                        {isSubmitting ? (
                            "등록 중..."
                        ) : (actionData && !!actionData.success) ? (
                            "등록 완료!"
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-1.5" /> 견적
                                등록하기
                            </>
                        )}
                    </button>
                </div>
            </form>

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
