import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/partners";
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
    Building2,
} from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
    const stmt = db.prepare("SELECT id, name, grade FROM partners");
    const partners = stmt.all();
    return { partners };
}

export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const id = formData.get("id");
    const name = formData.get("name");
    const grade = formData.get("grade");

    if (intent === "add") {
        if (!name) {
            return { error: "파트너사 이름이 필요합니다.", intent: "add" };
        }
        try {
            const stmt = db.prepare(
                "INSERT INTO partners (name, grade) VALUES (?, ?)",
            );
            stmt.run(name, grade || "");
            return { success: true, intent: "add" };
        } catch (error) {
            return { error: "추가 중 오류가 발생했습니다.", intent: "add" };
        }
    } else if (intent === "delete") {
        if (!id) {
            return { error: "삭제할 ID가 필요합니다.", intent: "delete" };
        }
        try {
            const stmt = db.prepare("DELETE FROM partners WHERE id = ?");
            stmt.run(Number(id));
            return { success: true, intent: "delete" };
        } catch (error) {
            return { error: "삭제 중 오류가 발생했습니다.", intent: "delete" };
        }
    } else if (intent === "edit") {
        if (!id || !name) {
            return {
                error: "수정할 ID와 파트너사 이름이 필요합니다.",
                intent: "edit",
            };
        }
        try {
            const stmt = db.prepare(
                "UPDATE partners SET name = ?, grade = ? WHERE id = ?",
            );
            stmt.run(name, grade || "", Number(id));
            return { success: true, intent: "edit" };
        } catch (error) {
            return { error: "수정 중 오류가 발생했습니다.", intent: "edit" };
        }
    }
    return { error: "알 수 없는 액션입니다." };
}

export default function Partners({ loaderData }: Route.ComponentProps) {
    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: loaderData.partners,
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
                setToast({ message: msg, type: "success" });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        name: "",
        grade: "",
    });

    const handleEditClick = (partner: any) => {
        setEditingId(partner.id);
        setEditForm({
            name: partner.name || "",
            grade: partner.grade || "",
        });
    };

    const handleSave = (id: number) => {
        fetcher.submit(
            {
                intent: "edit",
                id: id.toString(),
                name: editForm.name,
                grade: editForm.grade,
            },
            { method: "post" },
        );
        setEditingId(null);
    };

    const handleDelete = (id: number) => {
        if (window.confirm("정말로 이 파트너사를 삭제하시겠습니까?")) {
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
                파트너사 목록
            </h1>

            {/* 파트너사 추가 폼 영역 */}
            <div className="mb-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <Building2 className="w-5 h-5 mr-2 text-blue-500" /> 새
                    파트너사 추가
                </h2>
                <addFetcher.Form
                    method="post"
                    ref={formRef}
                    className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
                >
                    {/* 폼 제출 시 등록 액션임을 서버에 알리는 숨김 필드 */}
                    <input type="hidden" name="intent" value="add" />
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            파트너사명
                        </label>
                        <input
                            type="text"
                            name="name"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: 에티버스"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            등급
                        </label>
                        <input
                            type="text"
                            name="grade"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                            placeholder="예: Premier"
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

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("파트너사명", "name")}
                            {renderTh("등급", "grade")}
                            <th className="p-3 w-36 text-center align-middle font-semibold">
                                관리
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedData.map((partner: any) => {
                            const isEditing = editingId === partner.id;

                            return (
                                <tr
                                    key={partner.id}
                                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 divide-x divide-gray-200 dark:divide-gray-700"
                                >
                                    {isEditing ? (
                                        <>
                                            <td className="p-3">
                                                <input
                                                    type="text"
                                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    value={editForm.name}
                                                    onChange={(e) =>
                                                        setEditForm({
                                                            ...editForm,
                                                            name: e.target
                                                                .value,
                                                        })
                                                    }
                                                />
                                            </td>
                                            <td className="p-3">
                                                <input
                                                    type="text"
                                                    className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    value={editForm.grade}
                                                    onChange={(e) =>
                                                        setEditForm({
                                                            ...editForm,
                                                            grade: e.target
                                                                .value,
                                                        })
                                                    }
                                                />
                                            </td>
                                            <td className="p-3 text-center space-x-2 whitespace-nowrap">
                                                <button
                                                    onClick={() =>
                                                        handleSave(partner.id)
                                                    }
                                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-600 text-white hover:bg-green-700 h-7 px-2.5 shadow"
                                                >
                                                    <Save className="w-3 h-3 mr-1" />{" "}
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDelete(partner.id)
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
                                                {partner.name}
                                            </td>
                                            <td className="p-4">
                                                {partner.grade}
                                            </td>
                                            <td className="p-4 text-center">
                                                <button
                                                    onClick={() =>
                                                        handleEditClick(partner)
                                                    }
                                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-7 px-3 shadow-sm"
                                                >
                                                    <Edit2 className="w-3 h-3 mr-1" />{" "}
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
                                    colSpan={3}
                                    className="p-6 text-center text-gray-500 dark:text-gray-400"
                                >
                                    등록된 파트너사가 없습니다.
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
