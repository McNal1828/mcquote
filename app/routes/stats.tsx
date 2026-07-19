import { useState, useEffect } from "react";
import { Form } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/stats";
import {
    Users,
    Building2,
    UserCheck,
    ChevronDown,
    ChevronUp,
    Banknote,
    FileText,
    PieChart,
    TrendingUp,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

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

    // 조회 기간 조건 (생성일 또는 수정일 중 하나라도 기간에 포함되면 조회)
    const timeFilter =
        "((q.created_at >= ? AND q.created_at <= ?) OR (q.updated_at >= ? AND q.updated_at <= ?))";
    const timeParams = [
        startTimestamp,
        endTimestamp,
        startTimestamp,
        endTimestamp,
    ];

    // 2. 파트너사별 통계 (내림차순, 0건 제외)
    const partnerStats = db
        .prepare(
            `
        SELECT p.id as partner_id, p.name as partner_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN partners p ON q.partner_id = p.id
        WHERE ${timeFilter}
        GROUP BY p.id, p.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(...timeParams);

    // 3. 파트너사 담당자별 통계 (내림차순, 0건 제외)
    const partnerContactStats = db
        .prepare(
            `
        SELECT pc.partner_id, pc.id as contact_id, pc.name as contact_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        WHERE ${timeFilter}
        GROUP BY pc.partner_id, pc.id, pc.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(...timeParams);

    // 4. 총판 담당자별 통계 (내림차순, 0건 제외)
    const distContactStats = db
        .prepare(
            `
        SELECT dc.id as dist_contact_id, dc.name as dist_contact_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        WHERE ${timeFilter}
        GROUP BY dc.id, dc.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(...timeParams);

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
        SELECT qv.vendor as vendor_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN quote_vendors qv ON q.id = qv.quote_id
        WHERE ${timeFilter} AND qv.vendor IS NOT NULL AND qv.vendor != ''
        GROUP BY qv.vendor
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(...timeParams);

    // 6. 벤더 담당자(AM)별 통계 (내림차순, 0건 제외)
    const amStats = db
        .prepare(
            `
        SELECT qv.vendor as vendor_name, a.id as am_id, a.name as am_name, COUNT(q.id) as quote_count
        FROM quotes q
        JOIN ams a ON q.am_id = a.id
        JOIN quote_vendors qv ON q.id = qv.quote_id
        WHERE ${timeFilter} AND qv.vendor IS NOT NULL AND qv.vendor != ''
        GROUP BY qv.vendor, a.id, a.name
        HAVING quote_count > 0
        ORDER BY quote_count DESC
    `,
        )
        .all(...timeParams);

    // UI 렌더링 편의를 위해 벤더 담당자(AM) 목록을 벤더명 기준으로 그룹화합니다.
    const amsByVendor = amStats.reduce((acc: any, row: any) => {
        if (!acc[row.vendor_name]) acc[row.vendor_name] = [];
        acc[row.vendor_name].push(row);
        return acc;
    }, {});

    // 7. 대시보드 요약 지표 및 월별 매출 추이 계산을 위한 전체 데이터 조회 (SQL SUM 최적화)
    const rawQuotes = db
        .prepare(
            `
        SELECT 
            q.id,
            q.created_at,
            q.updated_at,
            q.is_ordered,
            q.is_lost,
            (SELECT IFNULL(SUM(l.supply_price), 0)
             FROM quote_groups g
             JOIN quote_lines l ON g.id = l.group_id
             WHERE g.quote_id = q.id AND g."default" = 1) as total_supply_price
        FROM quotes q
        WHERE ${timeFilter}
    `,
        )
        .all(...timeParams) as any[];

    let totalRevenue = 0;
    let totalOrdered = 0;
    let totalLost = 0;
    let totalPending = 0;
    const monthlyDataMap: Record<string, any> = {};

    rawQuotes.forEach((q) => {
        const revenue = q.total_supply_price || 0;

        // 오더된 건들(is_ordered === 1)에 대해서만 총 공급가 및 매출 추이 계산
        if (q.is_ordered) {
            totalRevenue += revenue;
            totalOrdered++;

            const d = new Date(q.updated_at);
            const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!monthlyDataMap[mKey]) {
                monthlyDataMap[mKey] = { month: mKey, revenue: 0, count: 0 };
            }
            monthlyDataMap[mKey].revenue += revenue;
            monthlyDataMap[mKey].count += 1;
        } else if (q.is_lost) {
            totalLost++;
        } else {
            totalPending++;
        }
    });

    const monthlyTrend = Object.values(monthlyDataMap).sort((a: any, b: any) =>
        a.month.localeCompare(b.month),
    );
    const winRate =
        rawQuotes.length > 0
            ? ((totalOrdered / rawQuotes.length) * 100).toFixed(1)
            : "0.0";

    const summary = {
        totalQuotes: rawQuotes.length,
        totalRevenue,
        totalOrdered,
        totalLost,
        totalPending,
        winRate,
    };

    return {
        startDate,
        endDate,
        partnerStats,
        contactsByPartner,
        distContactStats,
        vendorStats,
        amsByVendor,
        summary,
        monthlyTrend,
    };
}

export default function Stats({ loaderData }: Route.ComponentProps) {
    const {
        startDate,
        endDate,
        partnerStats,
        distContactStats,
        vendorStats,
        summary,
        monthlyTrend,
    } = loaderData;
    const contactsByPartner: Record<string | number, any> = loaderData.contactsByPartner || {};
    const amsByVendor: Record<string, any> = loaderData.amsByVendor || {};
    const [expandedPartners, setExpandedPartners] = useState<Set<number>>(
        new Set(),
    );
    const [expandedVendors, setExpandedVendors] = useState<Set<string>>(
        new Set(),
    );
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

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

    // 차트용 커스텀 툴팁 (shadcn 스타일)
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-lg shadow-lg">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
                        {label}월
                    </p>
                    <div className="flex flex-col gap-1 text-sm">
                        <p className="text-blue-600 dark:text-blue-400 font-medium">
                            매출: ₩{payload[0].value.toLocaleString()}
                        </p>
                        <p className="text-gray-500 dark:text-gray-400">
                            견적 건수: {payload[0].payload.count}건
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            {/* 상단: 타이틀 및 날짜 필터 */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h1 className="text-3xl font-bold dark:text-white">
                    통계 대시보드
                </h1>
                <Form
                    method="get"
                    className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                    <input
                        type="date"
                        name="startDate"
                        defaultValue={startDate}
                        className="bg-transparent px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none dark:[color-scheme:dark]"
                    />
                    <span className="text-gray-400 text-sm">~</span>
                    <input
                        type="date"
                        name="endDate"
                        defaultValue={endDate}
                        className="bg-transparent px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none dark:[color-scheme:dark]"
                    />
                    <button
                        type="submit"
                        className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    >
                        조회
                    </button>
                </Form>
            </div>

            {/* 구역 1: 핵심 요약 지표 (Summary Cards) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            총 공급가 (매출)
                        </h3>
                        <Banknote className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        ₩{summary.totalRevenue.toLocaleString()}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        조회 기간 내 누적 금액
                    </p>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            총 견적 건수
                        </h3>
                        <FileText className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {summary.totalQuotes}건
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="text-blue-500 font-medium">
                            오더 {summary.totalOrdered}
                        </span>
                        <span className="text-red-500 font-medium">
                            실주 {summary.totalLost}
                        </span>
                        <span className="text-yellow-500 font-medium">
                            진행중 {summary.totalPending}
                        </span>
                    </div>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            수주 성공률 (Win Rate)
                        </h3>
                        <PieChart className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                        {summary.winRate}%
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        전체 견적 대비 오더 완료 비율
                    </p>
                </div>
            </div>

            {/* 구역 2: 월별 매출 추이 차트 */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm mb-6">
                <h3 className="text-base font-bold mb-6 dark:text-white flex items-center">
                    <TrendingUp className="w-5 h-5 mr-2 text-blue-500" /> 월별
                    매출 추이
                </h3>
                <div className="h-[300px] w-full">
                    {mounted ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={monthlyTrend}
                                margin={{
                                    top: 0,
                                    right: 0,
                                    left: 10,
                                    bottom: 0,
                                }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="#e5e7eb"
                                />
                                <XAxis
                                    dataKey="month"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: "#6b7280" }}
                                    dy={10}
                                />
                                <YAxis
                                    yAxisId="left"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: "#6b7280" }}
                                    tickFormatter={(value) =>
                                        value >= 100000000
                                            ? `${(value / 100000000).toFixed(0)}억`
                                            : `${(value / 10000).toFixed(0)}만`
                                    }
                                />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ fill: "rgba(0,0,0,0.05)" }}
                                />
                                <Bar
                                    yAxisId="left"
                                    dataKey="revenue"
                                    fill="#3b82f6"
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={50}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                            차트를 불러오는 중...
                        </div>
                    )}
                </div>
            </div>

            {/* 구역 3: 통계 테이블 영역 (가로 3분할) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 왼쪽: 파트너사 별 견적 건수 */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center border-b dark:border-gray-700 pb-3">
                        <Users className="w-5 h-5 mr-2 text-blue-500" />{" "}
                        파트너사별 횟수
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
                                            ) ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
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
                        <Building2 className="w-5 h-5 mr-2 text-purple-500" />{" "}
                        벤더별 횟수
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
                                            ) ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
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
                        <UserCheck className="w-5 h-5 mr-2 text-green-500" />{" "}
                        총판 담당자별 횟수
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
