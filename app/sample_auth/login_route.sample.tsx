/**
 * ==============================================================================
 * 로그인 페이지 라우트 샘플 코드 (login.tsx 로 활용 가능)
 * ==============================================================================
 * 
 * 📌 [설명]
 * 이 파일은 사용자가 로그인할 수 있는 화면 UI와, 폼 제출 시 백엔드 action에서
 * remix-auth의 authenticator.authenticate()를 통해 로그인 인증을 처리하는 샘플입니다.
 * 
 * ==============================================================================
 */

import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticator } from "./auth.server.sample";

// 1. Loader: 이미 로그인되어 있는 사용자가 /login 에 들어오면 /home 으로 즉시 리다이렉트
export async function loader({ request }: any) {
    return await authenticator.isAuthenticated(request, {
        successRedirect: "/home",
    });
}

// 2. Action: <form method="post"> 제출 시 로그인 시도
export async function action({ request }: any) {
    try {
        // "user-pass" 전략을 실행하여 인증 성공 시 /home으로 리다이렉트, 실패 시 예외 던짐
        return await authenticator.authenticate("user-pass", request, {
            successRedirect: "/home",
            failureRedirect: "/login", // 실패 시 다시 로그인 페이지로
        });
    } catch (error: any) {
        // remix-auth 실패 메시지 또는 예외 반환
        return { error: error.message || "로그인에 실패했습니다." };
    }
}

// 3. UI 컴포넌트 샘플 (MCQuote 다크모드/Vanilla CSS 스타일 반영)
export default function LoginSample() {
    const actionData = useFetcher().data;
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8">
                {/* 헤더 타이틀 */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        MCQuote 로그인
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        시스템 이용을 위해 계정 정보를 입력하세요.
                    </p>
                </div>

                {/* 에러 메시지 표시 */}
                {actionData?.error && (
                    <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-950/60 dark:border-red-800 dark:text-red-300">
                        ⚠️ {actionData.error}
                    </div>
                )}

                {/* 로그인 폼 제출 */}
                <form method="post" className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            아이디
                        </label>
                        <input
                            type="text"
                            name="username"
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="아이디를 입력하세요"
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            비밀번호
                        </label>
                        <input
                            type="password"
                            name="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="비밀번호를 입력하세요"
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full py-3 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        로그인
                    </button>
                </form>
            </div>
        </div>
    );
}
