import { Fragment, useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/products";
import { useTableFeatures } from "./useTableFeatures";

export async function loader({ request }: Route.LoaderArgs) {
    const stmt = db.prepare("SELECT code, description, lpd, lpw FROM products");
    const products = stmt.all();
    return { products };
}

// 수정 및 추가 데이터를 DB에 반영하는 Action 함수
export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const code = formData.get("code");
    const description = formData.get("description");
    const lpd = formData.get("lpd");
    const lpw = formData.get("lpw");

    if (!code) {
        return { error: "제품 코드가 필요합니다." };
    }

    // intent 값에 따라 DB에 추가(INSERT) 또는 수정(UPDATE)을 수행합니다.
    if (intent === "add") {
        try {
            const stmt = db.prepare(`
                INSERT INTO products (code, description, lpd, lpw)
                VALUES (?, ?, ?, ?)
            `);
            stmt.run(code, description, Number(lpd), Number(lpw));
            return { success: true, intent: "add" };
        } catch (error) {
            return {
                error: "제품 추가 중 오류가 발생했습니다. (코드가 이미 존재할 수 있습니다.)",
                intent: "add",
            };
        }
    } else if (intent === "delete") {
        try {
            const stmt = db.prepare("DELETE FROM products WHERE code = ?");
            stmt.run(code);
            return { success: true, intent: "delete" };
        } catch (error) {
            return {
                error: "제품 삭제 중 오류가 발생했습니다.",
                intent: "delete",
            };
        }
    } else {
        try {
            const stmt = db.prepare(`
                UPDATE products
                SET description = ?, lpd = ?, lpw = ?
                WHERE code = ?
            `);
            stmt.run(description, Number(lpd), Number(lpw), code);
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
    // 공통 테이블 정렬 및 필터 훅 사용
    const {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    } = useTableFeatures({
        data: loaderData.products,
    });

    // 백그라운드 데이터 전송을 위한 훅
    const fetcher = useFetcher();

    // 새 제품 추가를 위한 별도의 fetcher 훅 및 폼 참조
    const addFetcher = useFetcher();
    const formRef = useRef<HTMLFormElement>(null);

    // 제품 추가 성공 시 입력 폼 초기화
    useEffect(() => {
        if (
            addFetcher.state === "idle" &&
            addFetcher.data?.success &&
            addFetcher.data?.intent === "add"
        ) {
            formRef.current?.reset();
        }
    }, [addFetcher.state, addFetcher.data]);

    // 수정 상태 관리
    const [editingCode, setEditingCode] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({
        description: "",
        lpd: 0,
        lpw: 0,
    });

    const handleEditClick = (product: any) => {
        setEditingCode(product.code);
        setEditForm({
            description: product.description || "",
            lpd: product.lpd || 0,
            lpw: product.lpw || 0,
        });
    };

    const handleSave = (code: string) => {
        // fetcher를 통해 페이지 이동 없이 POST 요청 전송
        fetcher.submit(
            {
                intent: "edit",
                code,
                description: editForm.description,
                lpd: editForm.lpd.toString(),
                lpw: editForm.lpw.toString(),
            },
            { method: "post" },
        );
        setEditingCode(null);
    };

    const handleDelete = (code: string) => {
        if (window.confirm("정말로 이 제품을 삭제하시겠습니까?")) {
            fetcher.submit({ intent: "delete", code }, { method: "post" });
            setEditingCode(null);
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
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                제품 목록
            </h1>
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-700 border-b dark:border-gray-600 text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                            {renderTh("제품코드", "code")}
                            {renderTh("설명", "description")}
                            {renderTh("LP 달러", "lpd")}
                            {renderTh("LP 원화", "lpw")}
                            <th className="p-3 w-24 text-center align-middle font-semibold">
                                관리
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {processedData.map((product: any) => {
                            const isEditing = editingCode === product.code;

                            return (
                                <tr
                                    key={product.code}
                                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 divide-x divide-gray-200 dark:divide-gray-700"
                                >
                                    <td className="p-4">{product.code}</td>
                                    {isEditing ? (
                                        <>
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
                                                        handleSave(product.code)
                                                    }
                                                    className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 font-medium transition-colors"
                                                >
                                                    저장
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDelete(
                                                            product.code,
                                                        )
                                                    }
                                                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
                                                >
                                                    삭제
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        setEditingCode(null)
                                                    }
                                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium transition-colors"
                                                >
                                                    취소
                                                </button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="p-4">
                                                {product.description}
                                            </td>
                                            <td className="p-4 font-medium text-right">
                                                ${product.lpd?.toLocaleString()}
                                            </td>
                                            <td className="p-4 font-medium text-right">
                                                ₩{product.lpw?.toLocaleString()}
                                            </td>
                                            <td className="p-4 text-center">
                                                <button
                                                    onClick={() =>
                                                        handleEditClick(product)
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
                    </tbody>
                </table>
            </div>

            {/* 제품 추가 폼 영역 */}
            <div className="mt-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <span className="mr-2">➕</span> 새 제품 추가
                </h2>
                <addFetcher.Form
                    method="post"
                    ref={formRef}
                    className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end"
                >
                    {/* 폼 제출 시 등록 액션임을 서버에 알리는 숨김 필드 */}
                    <input type="hidden" name="intent" value="add" />
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            제품코드
                        </label>
                        <input
                            type="text"
                            name="code"
                            required
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        </div>
    );
}
