import { useState } from "react";
import { Form } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/stats";

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    let startDate = url.searchParams.get("startDate");
    let endDate = url.searchParams.get("endDate");

    // 1. 기간 기본값 설정 (현재 달의 1일 ~ 마지막 날)
    const now = new Date();
    if (!startDate || !endDate) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const lastDay = new Date(y, now.getMonth() + 1, 0); // 다음 달의 0번째 날 = 이번 달의 마지막 날

        startDate = startDate || `${y}-${m}-01`;
        endDate =
            endDate ||
            `${y}-${m}-${String(lastDay.getDate()).padStart(2, "0")}`;
    }

    // 날짜 문자열을 DB 조회를 위한 Unix Timestamp(밀리초)로 변환
    const startTimestamp = new Date(`${startDate}T00:00:00`).getTime();
    const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();

    // 2. 파트너사별 통계 (내림차순, 0건 제외)
    const partnerStats = db
        .prepare(
            `
        SELECT p.id as partner_id, p.name as partner_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN partners p ON q.partner_id = p.id
        WHERE q.updated_at >= ? AND q.updated_at <= ?
        GROUP BY p.id, p.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(startTimestamp, endTimestamp);

    // 3. 파트너사 담당자별 통계 (내림차순, 0건 제외)
    const partnerContactStats = db
        .prepare(
            `
        SELECT pc.partner_id, pc.id as contact_id, pc.name as contact_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        WHERE q.updated_at >= ? AND q.updated_at <= ?
        GROUP BY pc.partner_id, pc.id, pc.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(startTimestamp, endTimestamp);

    // 4. 총판 담당자별 통계 (내림차순, 0건 제외)
    const distContactStats = db
        .prepare(
            `
        SELECT dc.id as dist_contact_id, dc.name as dist_contact_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        WHERE q.updated_at >= ? AND q.updated_at <= ?
        GROUP BY dc.id, dc.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(startTimestamp, endTimestamp);

    // UI 렌더링 편의를 위해 파트너 담당자 목록을 파트너 ID 기준으로 그룹화합니다.
    const contactsByPartner = partnerContactStats.reduce(
        (acc: any, row: any) => {
            if (!acc[row.partner_id]) acc[row.partner_id] = [];
            acc[row.partner_id].push(row);
            return acc;
        },
        {},
    );

    // 5. 벤더별 통계 (내림차순, 0건 제외)
    const vendorStats = db
        .prepare(
            `
        SELECT q.vendor as vendor_name, COUNT(q.id) as quote_count
        FROM quotes q
        WHERE q.updated_at >= ? AND q.updated_at <= ? AND q.vendor IS NOT NULL AND q.vendor != ''
        GROUP BY q.vendor
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(startTimestamp, endTimestamp);

    // 6. 벤더 담당자(AM)별 통계 (내림차순, 0건 제외)
    const amStats = db
        .prepare(
            `
        SELECT q.vendor as vendor_name, a.id as am_id, a.name as am_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN ams a ON q.am_id = a.id
        WHERE q.updated_at >= ? AND q.updated_at <= ? AND q.vendor IS NOT NULL AND q.vendor != ''
        GROUP BY q.vendor, a.id, a.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(startTimestamp, endTimestamp);

    // UI 렌더링 편의를 위해 벤더 담당자(AM) 목록을 벤더명 기준으로 그룹화합니다.
    const amsByVendor = amStats.reduce((acc: any, row: any) => {
        if (!acc[row.vendor_name]) acc[row.vendor_name] = [];
        acc[row.vendor_name].push(row);
        return acc;
    }, {});

    return {
        startDate,
        endDate,
        partnerStats,
        contactsByPartner,
        distContactStats,
        vendorStats,
        amsByVendor,
    };
}

export default function Stats({ loaderData }: Route.ComponentProps) {
    const {
        startDate,
        endDate,
        partnerStats,
        contactsByPartner,
        distContactStats,
        vendorStats,
        amsByVendor,
    } = loaderData;
    const [expandedPartners, setExpandedPartners] = useState<Set<number>>(
        new Set(),
    );
    const [expandedVendors, setExpandedVendors] = useState<Set<string>>(
        new Set(),
    );

    const togglePartner = (id: number) => {
        setExpandedPartners((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const toggleVendor = (name: string) => {
        setExpandedVendors((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(name)) newSet.delete(name);
            else newSet.add(name);
            return newSet;
        });
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">통계</h1>

            {/* 구역 1: 날짜 기간 선택 필터 */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 mb-6 flex flex-col md:flex-row md:items-end gap-4">
                <Form method="get" className="flex items-end gap-4 w-full">
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            시작 날짜
                        </label>
                        <input
                            type="date"
                            name="startDate"
                            defaultValue={startDate}
                            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium">
                        ~
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                            종료 날짜
                        </label>
                        <input
                            type="date"
                            name="endDate"
                            defaultValue={endDate}
                            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:[color-scheme:dark]"
                        />
                    </div>
                    <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded transition-colors shadow-sm"
                    >
                        조회하기
                    </button>
                </Form>
            </div>

            {/* 구역 2: 통계 테이블 영역 (가로 3분할) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 왼쪽: 파트너사 별 견적 건수 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center border-b dark:border-gray-700 pb-3">
                        <span className="mr-2">🤝</span> 파트너사별 횟수
                    </h2>
                    <div className="space-y-2">
                        {(partnerStats as any[]).map((partner) => (
                            <div
                                key={partner.partner_id}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                            >
                                <div
                                    className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                                    onClick={() =>
                                        togglePartner(partner.partner_id)
                                    }
                                >
                                    <span className="font-medium text-gray-800 dark:text-gray-200">
                                        {partner.partner_name}
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 py-1 px-3 rounded-full text-sm font-bold">
                                            {partner.quote_count}건
                                        </span>
                                        <span className="text-gray-400 text-xs">
                                            {expandedPartners.has(
                                                partner.partner_id,
                                            )
                                                ? "▲"
                                                : "▼"}
                                        </span>
                                    </div>
                                </div>

                                {/* 파트너사 담당자별 통계 (펼침 영역) */}
                                {expandedPartners.has(partner.partner_id) &&
                                    contactsByPartner[partner.partner_id] && (
                                        <div className="bg-white dark:bg-gray-800 p-3 border-t border-gray-200 dark:border-gray-700">
                                            <ul className="space-y-1">
                                                {contactsByPartner[
                                                    partner.partner_id
                                                ].map((contact: any) => (
                                                    <li
                                                        key={contact.contact_id}
                                                        className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 pl-4 py-1 border-l-2 border-blue-200 dark:border-blue-800 mb-1"
                                                    >
                                                        <span>
                                                            ↳{" "}
                                                            {
                                                                contact.contact_name
                                                            }
                                                        </span>
                                                        <span className="font-medium">
                                                            {
                                                                contact.quote_count
                                                            }
                                                            건
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                            </div>
                        ))}
                        {partnerStats.length === 0 && (
                            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                                조회된 데이터가 없습니다.
                            </p>
                        )}
                    </div>
                </div>

                {/* 가운데: 벤더별 견적 건수 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center border-b dark:border-gray-700 pb-3">
                        <span className="mr-2">🏢</span> 벤더별 횟수
                    </h2>
                    <div className="space-y-2">
                        {(vendorStats as any[]).map((vendor) => (
                            <div
                                key={vendor.vendor_name}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                            >
                                <div
                                    className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 hover:bg-purple-50 dark:hover:bg-gray-600 cursor-pointer transition-colors"
                                    onClick={() =>
                                        toggleVendor(vendor.vendor_name)
                                    }
                                >
                                    <span className="font-medium text-gray-800 dark:text-gray-200">
                                        {vendor.vendor_name}
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <span className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 py-1 px-3 rounded-full text-sm font-bold">
                                            {vendor.quote_count}건
                                        </span>
                                        <span className="text-gray-400 text-xs">
                                            {expandedVendors.has(
                                                vendor.vendor_name,
                                            )
                                                ? "▲"
                                                : "▼"}
                                        </span>
                                    </div>
                                </div>

                                {/* 벤더 담당자(AM)별 통계 (펼침 영역) */}
                                {expandedVendors.has(vendor.vendor_name) &&
                                    amsByVendor[vendor.vendor_name] && (
                                        <div className="bg-white dark:bg-gray-800 p-3 border-t border-gray-200 dark:border-gray-700">
                                            <ul className="space-y-1">
                                                {amsByVendor[
                                                    vendor.vendor_name
                                                ].map((am: any) => (
                                                    <li
                                                        key={am.am_id}
                                                        className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 pl-4 py-1 border-l-2 border-purple-200 dark:border-purple-800 mb-1"
                                                    >
                                                        <span>
                                                            ↳ {am.am_name}
                                                        </span>
                                                        <span className="font-medium">
                                                            {am.quote_count}건
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                            </div>
                        ))}
                        {vendorStats.length === 0 && (
                            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                                조회된 데이터가 없습니다.
                            </p>
                        )}
                    </div>
                </div>

                {/* 오른쪽: 총판 담당자 별 견적 건수 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center border-b dark:border-gray-700 pb-3">
                        <span className="mr-2">👤</span> 총판 담당자별 횟수
                    </h2>
                    <ul className="space-y-2">
                        {(distContactStats as any[]).map((dist) => (
                            <li
                                key={dist.dist_contact_id}
                                className="flex justify-between items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700"
                            >
                                <span className="font-medium text-gray-800 dark:text-gray-200">
                                    {dist.dist_contact_name}
                                </span>
                                <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 py-1 px-3 rounded-full text-sm font-bold">
                                    {dist.quote_count}건
                                </span>
                            </li>
                        ))}
                        {distContactStats.length === 0 && (
                            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                                조회된 데이터가 없습니다.
                            </p>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
