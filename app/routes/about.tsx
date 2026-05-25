import { Link } from "react-router";
import type { Route } from "./+types/about";

export function meta({}: Route.MetaArgs) {
    return [
        { title: "About Us" },
        { name: "description", content: "Learn more about our application." },
    ];
}

export default function About() {
    return (
        <main className="pt-16 p-4 container mx-auto">
            <h1 className="text-3xl font-bold mb-4 dark:text-white">
                About Page
            </h1>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
                이곳은 새롭게 추가된 About 페이지입니다!
            </p>

            <div className="flex gap-4">
                <Link
                    to="/"
                    className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 inline-block transition-colors"
                >
                    👈 Home으로 돌아가기
                </Link>

                {/* 파일 다운로드는 일반 <a> 태그를 사용하여 브라우저 기본 동작을 유도합니다 */}
                <a
                    href="/api/download"
                    className="bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700 inline-block transition-colors shadow-sm"
                >
                    📊 샘플 엑셀 다운로드
                </a>
            </div>
        </main>
    );
}
