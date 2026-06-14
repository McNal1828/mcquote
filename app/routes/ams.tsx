import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/ams";
import { useTableFeatures } from "./useTableFeatures";

export async function loader({ request }: Route.LoaderArgs) {
    const stmt = db.prepare(
        "SELECT id, name, position, job_type, email, phone, assigned_clients, vendor FROM ams",
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
                INSERT INTO ams (name, position, job_type, email, phone, assigned_clients, vendor) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
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
            const stmt = db.prepare("DELETE FROM ams WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "delete" };
        } catch (error) {
            return { error: "삭제 중 오류가 발생했습니다.", intent: "delete" };
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
    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: loaderData.ams,
    });

    const fetcher = useFetcher();
    const addFetcher = useFetcher();
    const formRef = useRef<HTMLFormElement>(null);

    // AM 추가 성공 시 입력 폼 초기화
    useEffect(() => {
        if (
            addFetcher.state === "idle" &&
            addFetcher.data?.success &&
            addFetcher.data?.intent === "add"
        ) {
            formRef.current?.reset();
        }
    }, [addFetcher.state, addFetcher.data]);

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
            <h1 className="text-3xl font-bold mb-6 dark:text-white">AM 목록</h1>

            {/* 새 AM 추가 폼 영역 */}
            <div className="mb-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <span className="mr-2">➕</span> 새 AM 추가
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="예: 삼성전자, LG전자, SK하이닉스"
                        />
                    </div>
                    <div>
                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors"
                        >
                            {addFetcher.state === "submitting"
                                ? "추가 중..."
                                : "추가하기"}
                        </button>
                    </div>
                </addFetcher.Form>
                {addFetcher.data?.error && addFetcher.data.intent === "add" && (
                    <p className="mt-3 text-red-500 text-sm font-medium">
                        {addFetcher.data.error}
                    </p>
                )}
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
                                                    className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 font-medium transition-colors"
                                                >
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDelete(am.id)
                                                    }
                                                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
                                                >
                                                    삭제
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        setEditingId(null)
                                                    }
                                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium transition-colors"
                                                >
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
                                                <button
                                                    onClick={() =>
                                                        handleEditClick(am)
                                                    }
                                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                                                >
                                                    수정
                                                </button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                        {processedData.length === 0 && (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="p-6 text-center text-gray-500 dark:text-gray-400"
                                >
                                    등록된 AM이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
