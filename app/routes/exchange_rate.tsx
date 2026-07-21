import { useState, useEffect } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/exchange_rate";
import { TrendingUp, Coins, Save, CheckCircle2, AlertCircle } from "lucide-react";

export function shouldRevalidate() {
    return true;
}

export async function loader({ request }: Route.LoaderArgs) {
    // exchange_rate 테이블이 없으면 생성 (이중 안전장치)
    db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_rate (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rate REAL NOT NULL,
            timestamp INTEGER NOT NULL
        );
    `);

    const stmt = db.prepare("SELECT rate, timestamp FROM exchange_rate ORDER BY timestamp DESC LIMIT 1");
    const lastRate = stmt.get() as { rate: number; timestamp: number } | undefined;
    return {
        rate: lastRate ? lastRate.rate : 0,
        timestamp: lastRate ? lastRate.timestamp : null,
    };
}

export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const rateStr = formData.get("rate");
    
    if (!rateStr) {
        return { error: "환율 값을 입력해 주세요." };
    }

    const rate = parseFloat(rateStr as string);
    if (isNaN(rate) || rate <= 0) {
        return { error: "유효한 환율 값을 입력해 주세요. (0보다 큰 실수)" };
    }

    try {
        const stmt = db.prepare("INSERT INTO exchange_rate (rate, timestamp) VALUES (?, ?)");
        stmt.run(rate, Date.now());
        return { success: true };
    } catch (err) {
        return { error: "데이터베이스 저장 중 오류가 발생했습니다." };
    }
}

export default function ExchangeRate({ loaderData }: Route.ComponentProps) {
    const actionData = useActionData() as any;
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const [toast, setToast] = useState<{
        message: string;
        type: "error" | "success";
    } | null>(null);

    useEffect(() => {
        if (actionData) {
            if (actionData.error) {
                setToast({ message: actionData.error, type: "error" });
            } else if (actionData.success) {
                setToast({ message: "환율 정보가 성공적으로 업데이트되었습니다.", type: "success" });
            }
        }
    }, [actionData]);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const formattedDate = loaderData.timestamp
        ? new Date(loaderData.timestamp).toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
          })
        : "기록 없음";

    return (
        <div className="p-8 container mx-auto max-w-2xl">
            <h1 className="text-3xl font-bold mb-6 dark:text-white flex items-center">
                <Coins className="w-8 h-8 mr-2.5 text-yellow-500" /> 환율 관리
            </h1>

            {/* 현재 기준 환율 표시 카드 */}
            <div className="mb-8 bg-gradient-to-br from-blue-500 to-indigo-600 text-white p-6 rounded-2xl shadow-lg border border-blue-400 dark:border-blue-500/30">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-semibold text-blue-100 uppercase tracking-wider">
                        현재 기본 적용 환율
                    </span>
                    <TrendingUp className="w-5 h-5 text-blue-100" />
                </div>
                <div className="text-4xl font-extrabold flex items-baseline gap-1.5">
                    <span>{loaderData.rate.toLocaleString("ko-KR", { minimumFractionDigits: 2 })}</span>
                    <span className="text-xl font-normal text-blue-200">KRW / USD</span>
                </div>
                <p className="text-xs text-blue-100/80 mt-4 flex items-center">
                    마지막 수정 시각: {formattedDate}
                </p>
            </div>

            {/* 새로운 환율 등록 폼 */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow border border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center">
                    <Save className="w-5 h-5 mr-2 text-blue-500" /> 새로운 기본 환율 등록
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    여기서 등록한 환율은 견적 생성(`quoting.tsx`) 및 견적 편집(`home.tsx`) 시 새로 추가되는 모든 제품 라인의 디폴트 환율값으로 바인딩됩니다.
                </p>

                <Form method="post" className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                            환율 값 (원)
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                name="rate"
                                step="0.01"
                                min="0.01"
                                required
                                placeholder="예: 1350.50"
                                className="w-full pl-3 pr-16 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg transition-shadow"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <span className="text-gray-500 dark:text-gray-400 font-semibold text-sm">KRW / USD</span>
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full inline-flex items-center justify-center rounded-xl text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 h-12 shadow-md disabled:opacity-75 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? "등록 중..." : "환율 저장하기"}
                    </button>
                </Form>
            </div>

            {/* Toast 피드백 알림 */}
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
