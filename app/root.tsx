import { useState, useEffect } from "react";
import {
    isRouteErrorResponse,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    NavLink,
    createCookie,
    Form,
    redirect,
    useSubmit,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
    },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
    },
];

// 애플리케이션 전체의 기본 메타 태그를 설정합니다.
export function meta({}: Route.MetaArgs) {
    return [
        { title: "McQuote" },
        {
            name: "description",
            content: "에티버스 SDI사업본부 견적 관리 시스템입니다.",
        },
        { name: "author", content: "신동한" },
    ];
}

const navItems = [
    { path: "/", label: "견적 목록" },
    { path: "/quoting", label: "견적 등록" },
    { path: "/products", label: "제품 목록" },
    { path: "/ams", label: "AM 목록" },
    { path: "/partners", label: "파트너사 목록" },
    { path: "/contacts", label: "파트너사 담당자 목록" },
    { path: "/dist", label: "총판 담당자 목록" },
];

// 1. 보안이 강화된 HTTP-Only 쿠키 설정
export const authCookie = createCookie("mcquote_auth", {
    maxAge: 60 * 60 * 24 * 7, // 7일 유지
    httpOnly: true, // 자바스크립트에서 접근 불가 (보안 핵심!)
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
});

// 2. 브라우저 접속 시 서버에서 쿠키를 확인하여 로그인 상태 파악
export async function loader({ request }: Route.LoaderArgs) {
    const cookieString = request.headers.get("Cookie");
    const authValue = await authCookie.parse(cookieString);
    return { isAuthenticated: authValue === "yes" };
}

// 3. 서버 액션에서만 비밀번호를 검증 (클라이언트에 소스가 유출되지 않음)
export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "logout") {
        return redirect("/", {
            headers: {
                "Set-Cookie": await authCookie.serialize("", { maxAge: 0 }),
            },
        });
    }

    const password = formData.get("password");
    if (password === "VMwareSDI!") {
        return redirect("/", {
            headers: { "Set-Cookie": await authCookie.serialize("yes") },
        });
    }

    return { error: "비밀번호가 일치하지 않습니다." };
}

export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <Meta />
                <Links />
                {/* 깜빡임(FOUC) 방지를 위한 초기 테마 설정 스크립트 */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            try {
                                if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                                    document.documentElement.classList.add('dark');
                                } else {
                                    document.documentElement.classList.remove('dark');
                                }
                            } catch (_) {}
                        `,
                    }}
                />
            </head>
            <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen">
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App({ loaderData, actionData }: Route.ComponentProps) {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [mounted, setMounted] = useState(false);
    const submit = useSubmit();

    useEffect(() => {
        setMounted(true);
        setIsDarkMode(document.documentElement.classList.contains("dark"));
    }, []);

    const toggleTheme = () => {
        const nextDark = !isDarkMode;
        setIsDarkMode(nextDark);
        if (nextDark) {
            document.documentElement.classList.add("dark");
            localStorage.setItem("theme", "dark");
        } else {
            document.documentElement.classList.remove("dark");
            localStorage.setItem("theme", "light");
        }
    };

    const handleLogout = () => {
        submit({ intent: "logout" }, { method: "post" });
    };

    // 로그인 상태가 아닐 때 (로그인 폼 렌더링)
    if (!loaderData.isAuthenticated) {
        return (
            <div className="flex items-center justify-center min-h-screen transition-colors">
                <Form
                    method="post"
                    className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-sm border border-gray-200 dark:border-gray-700"
                >
                    <h1 className="text-2xl font-bold mb-6 text-center text-gray-800 dark:text-white">
                        McQuote 접속
                    </h1>
                    {actionData?.error && (
                        <p className="text-red-500 text-sm font-medium mb-4 text-center">
                            {actionData.error}
                        </p>
                    )}
                    <input
                        type="password"
                        name="password"
                        className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md mb-6 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="비밀번호를 입력하세요"
                        autoFocus
                    />
                    <button
                        type="submit"
                        name="intent"
                        value="login"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-md transition-colors"
                    >
                        접속하기
                    </button>
                </Form>
            </div>
        );
    }

    // 로그인 성공 시 (정상 라우터 화면 렌더링)
    return (
        <>
            <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-50">
                <nav className="container mx-auto px-4 flex items-center justify-between">
                    <div className="overflow-x-auto w-full no-scrollbar">
                        <ul className="flex space-x-8 py-4 whitespace-nowrap">
                            {navItems.map((item) => (
                                <li key={item.path}>
                                    <NavLink
                                        to={item.path}
                                        className={({ isActive }) =>
                                            isActive
                                                ? "font-bold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 pb-4"
                                                : "text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 pb-4 transition-colors"
                                        }
                                    >
                                        {item.label}
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="flex items-center ml-6 flex-shrink-0 space-x-3">
                        <button
                            onClick={handleLogout}
                            className="text-sm px-3 py-1.5 rounded-md font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="로그아웃"
                        >
                            로그아웃
                        </button>
                        <button
                            onClick={toggleTheme}
                            className="p-2 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center w-10 h-10 shadow-sm border border-gray-200 dark:border-gray-600"
                            title="테마 변경"
                        >
                            {mounted ? (isDarkMode ? "☀️" : "🌙") : "🌙"}
                        </button>
                    </div>
                </nav>
            </header>
            <main>
                <Outlet />
            </main>
        </>
    );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    let message = "Oops!";
    let details = "An unexpected error occurred.";
    let stack: string | undefined;

    if (isRouteErrorResponse(error)) {
        message = error.status === 404 ? "404" : "Error";
        details =
            error.status === 404
                ? "The requested page could not be found."
                : error.statusText || details;
    } else if (import.meta.env.DEV && error && error instanceof Error) {
        details = error.message;
        stack = error.stack;
    }

    return (
        <main className="pt-16 p-4 container mx-auto">
            <h1>{message}</h1>
            <p>{details}</p>
            {stack && (
                <pre className="w-full p-4 overflow-x-auto">
                    <code>{stack}</code>
                </pre>
            )}
        </main>
    );
}
