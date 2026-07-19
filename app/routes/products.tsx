import { Fragment, useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/products";
import { useTableFeatures } from "./useTableFeatures";
import {
    Plus,
    Save,
    Trash2,
    X,
    AlertCircle,
    CheckCircle2,
    PackageSearch,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
    Edit2,
    ArchiveRestore,
} from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
    const stmt = db.prepare(
        "SELECT id, code, description, lpd, lpw, vendor, available FROM products",
    );
    const products = stmt.all();
    return { products };
}

// 수정 및 추가 데이터를 DB에 반영하는 Action 함수
export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const id = formData.get("id");
    const code = formData.get("code");
    const description = formData.get("description");
    const lpd = formData.get("lpd");
    const lpw = formData.get("lpw");
    const vendor = formData.get("vendor");

    // intent 값에 따라 DB 작업을 분기합니다.
    if (intent === "add") {
        if (!code) {
            return { error: "제품 코드가 필요합니다." };
        }
        try {
            const stmt = db.prepare(`
                INSERT INTO products (code, description, lpd, lpw, vendor, available)
                VALUES (?, ?, ?, ?, ?, 1)
            `);
            stmt.run(code, description, Number(lpd), Number(lpw), vendor || "");
            return { success: true, intent: "add" };
        } catch (error) {
            return {
                error: "제품 추가 중 오류가 발생했습니다. (코드가 이미 존재할 수 있습니다.)",
                intent: "add",
            };
        }
    } else if (intent === "delete") {
        if (!id) {
            return { error: "제품 ID가 필요합니다." };
        }
        try {
            const stmt = db.prepare("UPDATE products SET available = 0 WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "delete" };
        } catch (error) {
            return {
                error: "제품 삭제 중 오류가 발생했습니다.",
                intent: "delete",
            };
        }
    } else if (intent === "restore") {
        if (!id) {
            return { error: "제품 ID가 필요합니다." };
        }
        try {
            const stmt = db.prepare("UPDATE products SET available = 1 WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "restore" };
        } catch (error) {
            return {
                error: "제품 복구 중 오류가 발생했습니다.",
                intent: "restore",
            };
        }
    } else {
        // 'edit'
        if (!id) {
            return { error: "제품 ID가 필요합니다." };
        }
        try {
            const stmt = db.prepare(`
                UPDATE products
                SET description = ?, lpd = ?, lpw = ?, vendor = ?
                WHERE id = ?
            `);
            stmt.run(description, Number(lpd), Number(lpw), vendor || "", Number(id));
            return { success: true, intent: "edit" };
        } catch (error) {
            return {
                error: "업데이트 중 오류가 발생했습니다.",
                intent: "edit",
            };
        }
    }
}

export default function Products({ loaderData }: Route.ComponentProps) {
    const [showAvailableOnly, setShowAvailableOnly] = useState(true);

    // 사용 여부 필터를 적용한 제품 리스트
    const filteredProducts = loaderData.products.filter(
        (p: any) => p.available === (showAvailableOnly ? 1 : 0)
    );

    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: filteredProducts,
    });

    // 백그라운드 데이터 전송을 위한 훅
    const fetcher = useFetcher();

    // 새 제품 추가를 위한 별도의 fetcher 훅 및 폼 참조
    const addFetcher = useFetcher();
    const formRef = useRef<HTMLFormElement>(null);

    const [toast, setToast] = useState<{
        message: string;
        type: "error" | "success";
    } | null>(null);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    useEffect(() => {
        if (addFetcher.state === "idle" && addFetcher.data) {
            if (addFetcher.data.error) {
                setToast({ message: addFetcher.data.error, type: "error" });
            } else if (
                addFetcher.data.success &&
                addFetcher.data.intent === "add"
            ) {
                setToast({
                    message: "성공적으로 추가되었습니다.",
                    type: "success",
                });
                formRef.current?.reset();
            }
        }
    }, [addFetcher.state, addFetcher.data]);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.error) {
                setToast({ message: fetcher.data.error, type: "error" });
            } else if (fetcher.data.success) {
                let msg = "성공적으로 처리되었습니다.";
                if (fetcher.data.intent === "edit")
                    msg = "성공적으로 수정되었습니다.";
                if (fetcher.data.intent === "delete")
                    msg = "성공적으로 삭제(비활성화)되었습니다.";
                if (fetcher.data.intent === "restore")
                    msg = "성공적으로 복구되었습니다.";
                setToast({ message: msg, type: "success" });
            }
        }
    }, [fetcher.state, fetcher.data]);

    // 수정 상태 관리 (id 기준)
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        description: "",
        vendor: "",
        lpd: 0,
        lpw: 0,
    });

    const handleEditClick = (product: any) => {
        setEditingId(product.id);
        setEditForm({
            description: product.description || "",
            vendor: product.vendor || "",
            lpd: product.lpd || 0,
            lpw: product.lpw || 0,
        });
    };

    const handleSave = (id: number, code: string) => {
        // fetcher를 통해 페이지 이동 없이 POST 요청 전송
        fetcher.submit(
            {
                intent: "edit",
                id: id.toString(),
                code,
                description: editForm.description,
                vendor: editForm.vendor,
                lpd: editForm.lpd.toString(),
                lpw: editForm.lpw.toString(),
            },
            { method: "post" },
        );
        setEditingId(null);
    };

    const handleDelete = (id: number) => {
        if (window.confirm("정말로 이 제품을 삭제(비활성화)하시겠습니까?")) {
            fetcher.submit({ intent: "delete", id: id.toString() }, { method: "post" });
            setEditingId(null);
        }
    };

    const handleRestore = (id: number) => {
        if (window.confirm("이 제품을 다시 사용 가능한 상태로 복구하시겠습니까?")) {
            fetcher.submit({ intent: "restore", id: id.toString() }, { method: "post" });
        }
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
                        <span className="ml-1 text-blue-500 text-right flex items-center">
                            {direction === "desc" ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronUp className="w-4 h-4" />
                            )}
                            {sortRules.length > 1 && (
                                <sup className="text-[10px] ml-0.5">
                                    {ruleIndex + 1}
                                </sup>
                            )}
                        </span>
                    ) : (
                        <span className="ml-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-right flex items-center">
                            <ChevronsUpDown className="w-4 h-4" />
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
                    className="w-full text-xs font-normal px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-500 transition-shadow"
                />
            </th>
        );
    };

    return (
        <div className="p-8 container mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                제품 관리
            </h1>

            {/* 제품 추가 폼 영역 */}
            <div className="mb-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <PackageSearch className="w-5 h-5 mr-2 text-blue-500" /> 새
                    제품 추가
                </h2>
                <addFetcher.Form
                    method="post"
                    ref={formRef}
                    className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end"
                >
                    {/* 폼 제출 시 등록 액션임을 서버에 알리는 숨김 필드 */}
                    <input type="hidden" name="intent" value="add" />
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            벤더
                        </label>
                        <select
                            name="vendor"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                        >
                            <option value="">벤더 선택</option>
                            <option value="Broadcom">Broadcom</option>
                            <option value="Omnissa">Omnissa</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            제품코드
                        </label>
                        <input
                            type="text"
                            name="code"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: VCF-NEW-CODE"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            설명
                        </label>
                        <input
                            type="text"
                            name="description"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="제품 설명"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            LP 달러 ($)
                        </label>
                        <input
                            type="number"
                            name="lpd"
                            defaultValue={0}
                            step="any"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            LP 원화 (₩)
                        </label>
                        <input
                            type="number"
                            name="lpw"
                            defaultValue={0}
                            step="any"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                        />
                    </div>
                    <div>
                        <button
                            type="submit"
                            disabled={addFetcher.state === "submitting"}
                            className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 shadow disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {addFetcher.state === "submitting" ? (
                                "추가 중..."
                            ) : (
                                <>
                                    <Plus className="w-4 h-4 mr-1.5" /> 추가하기
                                </>
                            )}
                        </button>
                    </div>
                </addFetcher.Form>
            </div>

            {/* 필터 탭/토글 영역 */}
            <div className="flex justify-end gap-2 mb-4">
                <button
                    type="button"
                    onClick={() => setShowAvailableOnly(true)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
                        showAvailableOnly
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-white text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                    <CheckCircle2 className="w-4 h-4" /> 사용 가능 제품
                </button>
                <button
                    type="button"
                    onClick={() => setShowAvailableOnly(false)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all flex items-center gap-1.5 ${
                        !showAvailableOnly
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-white text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                    <ArchiveRestore className="w-4 h-4" /> 사용 불가능 제품 (삭제됨)
                </button>
            </div>

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("벤더", "vendor")}
                            {renderTh("제품코드", "code")}
                            {renderTh("설명", "description")}
                            {renderTh("LP 달러", "lpd")}
                            {renderTh("LP 원화", "lpw")}
                            <th className="p-3 w-28 text-center align-middle font-semibold">
                                관리
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedData.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-500">
                                    해당되는 제품이 없습니다.
                                </td>
                            </tr>
                        ) : (
                            processedData.map((product: any) => {
                                const isEditing = editingId === product.id;

                                return (
                                    <tr
                                        key={product.id}
                                        className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 divide-x divide-gray-200 dark:divide-gray-700"
                                    >
                                        {isEditing ? (
                                            <>
                                                <td className="p-3">
                                                    <select
                                                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        value={editForm.vendor}
                                                        onChange={(e) =>
                                                            setEditForm({
                                                                ...editForm,
                                                                vendor: e.target
                                                                    .value,
                                                            })
                                                        }
                                                    >
                                                        <option value="">
                                                            선택
                                                        </option>
                                                        <option value="Broadcom">
                                                            Broadcom
                                                        </option>
                                                        <option value="Omnissa">
                                                            Omnissa
                                                        </option>
                                                    </select>
                                                </td>
                                                <td className="p-4 bg-gray-50 dark:bg-gray-800/50 font-mono">
                                                    {product.code}
                                                </td>
                                                <td className="p-3">
                                                    <input
                                                        type="text"
                                                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        value={editForm.description}
                                                        onChange={(e) =>
                                                            setEditForm({
                                                                ...editForm,
                                                                description:
                                                                    e.target.value,
                                                            })
                                                        }
                                                    />
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center justify-end">
                                                        <span className="mr-1 text-gray-500">
                                                            $
                                                        </span>
                                                        <input
                                                            type="number"
                                                            className="w-full max-w-[100px] px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                                            value={editForm.lpd}
                                                            onChange={(e) =>
                                                                setEditForm({
                                                                    ...editForm,
                                                                    lpd: Number(
                                                                        e.target
                                                                            .value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center justify-end">
                                                        <span className="mr-1 text-gray-500">
                                                            ₩
                                                        </span>
                                                        <input
                                                            type="number"
                                                            className="w-full max-w-[120px] px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                                            value={editForm.lpw}
                                                            onChange={(e) =>
                                                                setEditForm({
                                                                    ...editForm,
                                                                    lpw: Number(
                                                                        e.target
                                                                            .value,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                </td>
                                                <td className="p-3 text-center space-x-2 whitespace-nowrap">
                                                    <button
                                                        onClick={() =>
                                                            handleSave(product.id, product.code)
                                                        }
                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-600 text-white hover:bg-green-700 h-7 px-2.5 shadow"
                                                    >
                                                        <Save className="w-3 h-3 mr-1" />{" "}
                                                        저장
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            handleDelete(
                                                                product.id,
                                                            )
                                                        }
                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 bg-red-600 text-white hover:bg-red-700 h-7 px-2.5 shadow"
                                                    >
                                                        <Trash2 className="w-3 h-3 mr-1" />{" "}
                                                        삭제
                                                    </button>
                                                    <button
                                                        onClick={() =>
                                                            setEditingId(null)
                                                        }
                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-7 px-2.5"
                                                    >
                                                        <X className="w-3 h-3 mr-1" />{" "}
                                                        취소
                                                    </button>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="p-4">
                                                    {product.vendor}
                                                </td>
                                                <td className="p-4 font-mono">
                                                    {product.code}
                                                </td>
                                                <td className="p-4">
                                                    {product.description}
                                                </td>
                                                <td className="p-4 font-medium text-right text-gray-900 dark:text-white">
                                                    ${product.lpd?.toLocaleString()}
                                                </td>
                                                <td className="p-4 font-medium text-right text-gray-900 dark:text-white">
                                                    ₩{product.lpw?.toLocaleString()}
                                                </td>
                                                <td className="p-4 text-center">
                                                    {product.available === 1 ? (
                                                        <button
                                                            onClick={() =>
                                                                handleEditClick(product)
                                                            }
                                                            className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-7 px-3 shadow-sm"
                                                        >
                                                            <Edit2 className="w-3 h-3 mr-1" />{" "}
                                                            수정
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() =>
                                                                handleRestore(product.id)
                                                            }
                                                            className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-300 dark:hover:bg-green-900/40 border border-green-200 dark:border-green-800 h-7 px-3 shadow-sm"
                                                        >
                                                            <CheckCircle2 className="w-3 h-3 mr-1" />{" "}
                                                            복구
                                                        </button>
                                                    )}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

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
