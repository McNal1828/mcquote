import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/ams";
import { useTableFeatures } from "./useTableFeatures";
import {
    Plus,
    Save,
    Trash2,
    X,
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
    Edit2,
    UserCircle,
    ArchiveRestore,
} from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
    const stmt = db.prepare(
        "SELECT id, name, position, job_type, email, phone, assigned_clients, vendor, available FROM ams",
    );
    const rawAms = stmt.all();

    // JSON 배열로 저장된 담당고객 목록을 콤마(,)로 구분된 문자열로 변환하여 화면(검색/정렬)에서 쓰기 쉽게 만듭니다.
    const ams = rawAms.map((am: any) => {
        let clients = [];
        try {
            clients = JSON.parse(am.assigned_clients || "[]");
        } catch (e) {
            // 파싱 실패 시 무시
        }
        return {
            ...am,
            assigned_clients: Array.isArray(clients) ? clients.join(", ") : "",
        };
    });

    return { ams };
}

export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const id = formData.get("id");
    const name = formData.get("name") as string;
    const position = (formData.get("position") as string) || "";
    const job_type = (formData.get("job_type") as string) || "";
    const email = (formData.get("email") as string) || "";
    const phone = (formData.get("phone") as string) || "";
    const assigned_clients_str =
        (formData.get("assigned_clients") as string) || "";
    const vendor = (formData.get("vendor") as string) || "";

    // 콤마로 입력받은 문자열을 다시 JSON 배열 텍스트로 변환
    const clientsArray = assigned_clients_str
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    const assigned_clients_json = JSON.stringify(clientsArray);

    if (intent === "add") {
        if (!name) {
            return { error: "AM 이름이 필요합니다.", intent: "add" };
        }
        try {
            const stmt = db.prepare(`
                INSERT INTO ams (name, position, job_type, email, phone, assigned_clients, vendor, available) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `);
            stmt.run(
                name,
                position,
                job_type,
                email,
                phone,
                assigned_clients_json,
                vendor,
            );
            return { success: true, intent: "add" };
        } catch (error) {
            return { error: "추가 중 오류가 발생했습니다.", intent: "add" };
        }
    } else if (intent === "delete") {
        if (!id) {
            return { error: "삭제할 ID가 필요합니다.", intent: "delete" };
        }
        try {
            const stmt = db.prepare("UPDATE ams SET available = 0 WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "delete" };
        } catch (error) {
            return { error: "삭제 중 오류가 발생했습니다.", intent: "delete" };
        }
    } else if (intent === "restore") {
        if (!id) {
            return { error: "복구할 ID가 필요합니다.", intent: "restore" };
        }
        try {
            const stmt = db.prepare("UPDATE ams SET available = 1 WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "restore" };
        } catch (error) {
            return { error: "복구 중 오류가 발생했습니다.", intent: "restore" };
        }
    } else if (intent === "edit") {
        if (!id || !name) {
            return { error: "수정할 ID와 이름이 필요합니다.", intent: "edit" };
        }
        try {
            const stmt = db.prepare(`
                UPDATE ams 
                SET name = ?, position = ?, job_type = ?, email = ?, phone = ?, assigned_clients = ?, vendor = ? 
                WHERE id = ?
            `);
            stmt.run(
                name,
                position,
                job_type,
                email,
                phone,
                assigned_clients_json,
                vendor,
                Number(id),
            );
            return { success: true, intent: "edit" };
        } catch (error) {
            return { error: "수정 중 오류가 발생했습니다.", intent: "edit" };
        }
    }
    return { error: "알 수 없는 액션입니다." };
}

export default function Ams({ loaderData }: Route.ComponentProps) {
    const [showAvailableOnly, setShowAvailableOnly] = useState(true);

    // 사용 여부 필터를 적용한 AM 리스트
    const filteredAms = loaderData.ams.filter(
        (am: any) => am.available === (showAvailableOnly ? 1 : 0)
    );

    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: filteredAms,
    });

    const fetcher = useFetcher();
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
                    msg = "성공적으로 삭제되었습니다.";
                if (fetcher.data.intent === "restore")
                    msg = "성공적으로 복구되었습니다.";
                setToast({ message: msg, type: "success" });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        name: "",
        position: "",
        job_type: "",
        email: "",
        phone: "",
        assigned_clients: "",
        vendor: "",
    });

    const handleEditClick = (am: any) => {
        setEditingId(am.id);
        setEditForm({
            name: am.name || "",
            position: am.position || "",
            job_type: am.job_type || "",
            email: am.email || "",
            phone: am.phone || "",
            assigned_clients: am.assigned_clients || "",
            vendor: am.vendor || "",
        });
    };

    const handleSave = (id: number) => {
        fetcher.submit(
            {
                intent: "edit",
                id: id.toString(),
                ...editForm,
            },
            { method: "post" },
        );
        setEditingId(null);
    };

    const handleDelete = (id: number) => {
        if (window.confirm("정말로 이 AM을 삭제하시겠습니까?")) {
            fetcher.submit(
                { intent: "delete", id: id.toString() },
                { method: "post" },
            );
            setEditingId(null);
        }
    };

    const handleRestore = (id: number) => {
        fetcher.submit(
            { intent: "restore", id: id.toString() },
            { method: "post" },
        );
        setEditingId(null);
    };

    const renderTh = (label: string, sortKey: string) => {
        const ruleIndex = sortRules.findIndex((rule) => rule.key === sortKey);
        const isSorted = ruleIndex !== -1;
        const direction = isSorted ? sortRules[ruleIndex].direction : null;
        const filterValue = filters[sortKey] || "";

        return (
            <th key={sortKey} className="p-3 align-top min-w-[120px]">
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
            <h1 className="text-3xl font-bold mb-6 dark:text-white">AM 목록</h1>

            {/* 새 AM 추가 폼 영역 */}
            <div className="mb-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <UserCircle className="w-5 h-5 mr-2 text-blue-500" /> 새 AM
                    추가
                </h2>
                <addFetcher.Form
                    method="post"
                    ref={formRef}
                    className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 items-end"
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
                            AM명
                        </label>
                        <input
                            type="text"
                            name="name"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: 홍길동"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            직급
                        </label>
                        <input
                            type="text"
                            name="position"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: 부장"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            구분
                        </label>
                        <input
                            type="text"
                            name="job_type"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: 영업"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            이메일
                        </label>
                        <input
                            type="email"
                            name="email"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="example@example.com"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            전화번호
                        </label>
                        <input
                            type="text"
                            name="phone"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="010-0000-0000"
                        />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            담당고객 (콤마로 구분)
                        </label>
                        <input
                            type="text"
                            name="assigned_clients"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: 삼성전자, LG전자, SK하이닉스"
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
                    <CheckCircle2 className="w-4 h-4" /> 사용 중 AM
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
                    <ArchiveRestore className="w-4 h-4" /> 삭제된 AM
                </button>
            </div>

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("벤더", "vendor")}
                            {renderTh("AM명", "name")}
                            {renderTh("직급", "position")}
                            {renderTh("구분", "job_type")}
                            {renderTh("이메일", "email")}
                            {renderTh("전화번호", "phone")}
                            {renderTh("담당고객", "assigned_clients")}
                            <th className="p-3 w-36 text-center align-middle font-semibold">
                                관리
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedData.map((am: any) => {
                            const isEditing = editingId === am.id;
                            const handleFieldChange = (
                                field: string,
                                value: string,
                            ) => {
                                setEditForm((prev) => ({
                                    ...prev,
                                    [field]: value,
                                }));
                            };

                            return (
                                <tr
                                    key={am.id}
                                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 divide-x divide-gray-200 dark:divide-gray-700"
                                >
                                    {isEditing ? (
                                        <>
                                            <td className="p-3">
                                                <select
                                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    value={editForm.vendor}
                                                    onChange={(e) =>
                                                        handleFieldChange(
                                                            "vendor",
                                                            e.target.value,
                                                        )
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
                                            {[
                                                "name",
                                                "position",
                                                "job_type",
                                                "email",
                                                "phone",
                                            ].map((field) => (
                                                <td key={field} className="p-3">
                                                    <input
                                                        type="text"
                                                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                        value={
                                                            (editForm as any)[
                                                                field
                                                            ]
                                                        }
                                                        onChange={(e) =>
                                                            handleFieldChange(
                                                                field,
                                                                e.target.value,
                                                            )
                                                        }
                                                    />
                                                </td>
                                            ))}
                                            <td className="p-3">
                                                <input
                                                    type="text"
                                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    value={
                                                        editForm.assigned_clients
                                                    }
                                                    onChange={(e) =>
                                                        handleFieldChange(
                                                            "assigned_clients",
                                                            e.target.value,
                                                        )
                                                    }
                                                    placeholder="고객A, 고객B..."
                                                />
                                            </td>
                                            <td className="p-3 text-center space-x-2 whitespace-nowrap">
                                                <button
                                                    onClick={() =>
                                                        handleSave(am.id)
                                                    }
                                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-600 text-white hover:bg-green-700 h-7 px-2.5 shadow"
                                                >
                                                    <Save className="w-3 h-3 mr-1" />{" "}
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDelete(am.id)
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
                                            <td className="p-4">{am.vendor}</td>
                                            <td className="p-4">{am.name}</td>
                                            <td className="p-4">
                                                {am.position}
                                            </td>
                                            <td className="p-4">
                                                {am.job_type}
                                            </td>
                                            <td className="p-4">{am.email}</td>
                                            <td className="p-4">{am.phone}</td>
                                            <td className="p-4">
                                                {am.assigned_clients}
                                            </td>
                                            <td className="p-4 text-center">
                                                {am.available === 1 ? (
                                                    <button
                                                        onClick={() =>
                                                            handleEditClick(am)
                                                        }
                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-7 px-3 shadow-sm"
                                                    >
                                                        <Edit2 className="w-3 h-3 mr-1" />{" "}
                                                        수정
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() =>
                                                            handleRestore(am.id)
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
                        })}
                        {processedData.length === 0 && (
                            <tr>
                                <td
                                    colSpan={8}
                                    className="p-6 text-center text-gray-500 dark:text-gray-400"
                                >
                                    등록된 AM이 없습니다.
                                </td>
                            </tr>
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
