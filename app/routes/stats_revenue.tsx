import { useState, useEffect, useMemo } from "react";
import { Form, redirect } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/stats_revenue";
import {
    Users,
    Building2,
    UserCheck,
    ChevronDown,
    ChevronUp,
    TrendingUp,
    PlusCircle,
    Edit3,
    CheckCircle,
    AlertTriangle,
    Clock,
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";

export function shouldRevalidate() {
    return true;
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const startYearParam = url.searchParams.get("startYear");
    const startMonthParam = url.searchParams.get("startMonth");
    const endYearParam = url.searchParams.get("endYear");
    const endMonthParam = url.searchParams.get("endMonth");

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;

    // 파라미터가 하나라도 누락되면 기본값(현재년월)으로 즉시 리다이렉트 처리하여 동기화
    if (!startYearParam || !startMonthParam || !endYearParam || !endMonthParam) {
        url.searchParams.set("startYear", String(curYear));
        url.searchParams.set("startMonth", String(curMonth));
        url.searchParams.set("endYear", String(curYear));
        url.searchParams.set("endMonth", String(curMonth));
        return redirect(url.pathname + url.search);
    }

    const startYear = parseInt(startYearParam, 10);
    const startMonth = parseInt(startMonthParam, 10);
    const endYear = parseInt(endYearParam, 10);
    const endMonth = parseInt(endMonthParam, 10);

    const startInt = startYear * 100 + startMonth;
    const endInt = endYear * 100 + endMonth;

    // 조회 기간 조건 (매출년도/매출월이 기간 내에 해당하는 라인 조회)
    const timeFilter = "(ql.year * 100 + ql.month) >= ? AND (ql.year * 100 + ql.month) <= ?";
    const timeParams = [startInt, endInt];

    // qg."default" = 1 조건 필수 반영 (대표/기본 탭 견적만 계산)
    const defaultGroupJoin = 'JOIN quote_groups qg ON ql.group_id = qg.id AND qg."default" = 1';

    // 2. 파트너사별 통계 (내림차순, 0건 제외)
    const partnerStats = db
        .prepare(
            `
        SELECT p.id as partner_id, p.name as partner_name, COUNT(ql.id) as quote_count
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
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
        SELECT pc.partner_id, pc.id as contact_id, pc.name as contact_name, COUNT(ql.id) as quote_count
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
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
        SELECT dc.id as dist_contact_id, dc.name as dist_contact_name, COUNT(ql.id) as quote_count
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
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
        SELECT qv.vendor as vendor_name, COUNT(ql.id) as quote_count
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
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
        SELECT qv.vendor as vendor_name, a.id as am_id, a.name as am_name, COUNT(ql.id) as quote_count
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
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

    // 7. 견적 라인 상세 데이터 조회 (실시간 연산을 위한 필드 확장 및 상세 테이블용 조인 추가)
    const rawLines = db
        .prepare(
            `
        SELECT 
            ql.id,
            ql.year,
            ql.month,
            ql.supply_price,
            ql.margin,
            ql.stage,
            p_prod.code as product_code,
            q.partner_id,
            q.dist_contact_id,
            q.client_company,
            pt.name as partner_name,
            dc.name as dist_contact_name,
            (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = q.id) as vendors
        FROM quote_lines ql
        ${defaultGroupJoin}
        JOIN quotes q ON qg.quote_id = q.id
        LEFT JOIN partners pt ON q.partner_id = pt.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        LEFT JOIN products p_prod ON ql.product_id = p_prod.id
        WHERE ${timeFilter}
    `,
        )
        .all(...timeParams) as any[];

    // 원본 데이터 기준으로 초기 요약 데이터(분모용) 계산 (단계별 건수 집계)
    let totalBillIssued = 0;      // 100% (계산서 발행 완료)
    let totalOrdered = 0;         // 99% (오더 완료)
    let totalOrderExpected = 0;   // 50%, 75% (오더 예정)
    let totalPending = 0;         // 10%, 25% (진행 중)

    rawLines.forEach((l) => {
        if (l.stage === 100) totalBillIssued++;
        else if (l.stage === 99) totalOrdered++;
        else if (l.stage === 50 || l.stage === 75) totalOrderExpected++;
        else if (l.stage === 10 || l.stage === 25) totalPending++;
    });

    const summary = {
        totalLines: rawLines.length,
        totalBillIssued,
        totalOrdered,
        totalOrderExpected,
        totalPending,
    };

    return {
        startYear,
        startMonth,
        endYear,
        endMonth,
        startInt,
        endInt,
        partnerStats,
        contactsByPartner,
        distContactStats,
        vendorStats,
        amsByVendor,
        summary,
        rawLines,
    };
}

export default function StatsRevenue({ loaderData }: Route.ComponentProps) {
    const {
        startYear,
        startMonth,
        endYear,
        endMonth,
        startInt,
        endInt,
        partnerStats,
        distContactStats,
        vendorStats,
        summary,
        rawLines,
    } = loaderData;
    const contactsByPartner: Record<string | number, any> = loaderData.contactsByPartner || {};
    const amsByVendor: Record<string, any> = loaderData.amsByVendor || {};

    const [expandedPartners, setExpandedPartners] = useState<Set<number>>(new Set());
    const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
    const [mounted, setMounted] = useState(false);

    // 필터링 상태 (체크박스 활성화 상태)
    const [activePartners, setActivePartners] = useState<Set<number>>(() => new Set((partnerStats as any[]).map((p: any) => p.partner_id)));
    const [activeVendors, setActiveVendors] = useState<Set<string>>(() => new Set((vendorStats as any[]).map((v: any) => v.vendor_name)));
    const [activeDistContacts, setActiveDistContacts] = useState<Set<number>>(() => new Set((distContactStats as any[]).map((d: any) => d.dist_contact_id)));

    useEffect(() => {
        setMounted(true);
    }, []);

    // loaderData 변경 시(페이지 전환 혹은 날짜 변경 시) 활성 필터 상태를 최신화(초기화)합니다.
    useEffect(() => {
        setActivePartners(new Set((partnerStats as any[]).map((p: any) => p.partner_id)));
        setActiveVendors(new Set((vendorStats as any[]).map((v: any) => v.vendor_name)));
        setActiveDistContacts(new Set((distContactStats as any[]).map((d: any) => d.dist_contact_id)));
    }, [partnerStats, vendorStats, distContactStats]);

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

    // 개별 체크박스 토글 핸들러들
    const handlePartnerCheckbox = (id: number) => {
        setActivePartners((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const handleVendorCheckbox = (name: string) => {
        setActiveVendors((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(name)) newSet.delete(name);
            else newSet.add(name);
            return newSet;
        });
    };

    const handleDistContactCheckbox = (id: number) => {
        setActiveDistContacts((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    // 일괄 선택/해제 핸들러들
    const handleAllPartners = (select: boolean) => {
        if (select) {
            setActivePartners(new Set((partnerStats as any[]).map((p: any) => p.partner_id)));
        } else {
            setActivePartners(new Set());
        }
    };

    const handleAllVendors = (select: boolean) => {
        if (select) {
            setActiveVendors(new Set((vendorStats as any[]).map((v: any) => v.vendor_name)));
        } else {
            setActiveVendors(new Set());
        }
    };

    const handleAllDistContacts = (select: boolean) => {
        if (select) {
            setActiveDistContacts(new Set((distContactStats as any[]).map((d: any) => d.dist_contact_id)));
        } else {
            setActiveDistContacts(new Set());
        }
    };

    // 실시간 필터링된 견적 라인 데이터
    const filteredLines = useMemo(() => {
        return (rawLines as any[]).filter((l) => {
            // 1. 파트너 필터
            if (!activePartners.has(l.partner_id)) return false;
            // 2. 총판 담당자 필터
            if (!activeDistContacts.has(l.dist_contact_id)) return false;
            // 3. 벤더 필터
            const vList = l.vendors ? l.vendors.split(",") : [];
            if (vList.length > 0) {
                const hasActiveVendor = vList.some((v: string) => activeVendors.has(v));
                if (!hasActiveVendor) return false;
            }
            return true;
        });
    }, [rawLines, activePartners, activeVendors, activeDistContacts]);

    // 필터링 적용된 실시간 요약 통계 계산 (단계별 건수)
    const currentSummary = useMemo(() => {
        let totalBillIssued = 0;      // 100% (계산서 발행 완료)
        let totalOrdered = 0;         // 99% (오더 완료)
        let totalOrderExpected = 0;   // 50%, 75% (오더 예정)
        let totalPending = 0;         // 10%, 25% (진행 중)

        filteredLines.forEach((l) => {
            if (l.stage === 100) totalBillIssued++;
            else if (l.stage === 99) totalOrdered++;
            else if (l.stage === 50 || l.stage === 75) totalOrderExpected++;
            else if (l.stage === 10 || l.stage === 25) totalPending++;
        });

        return {
            totalLines: filteredLines.length,
            totalBillIssued,
            totalOrdered,
            totalOrderExpected,
            totalPending,
        };
    }, [filteredLines]);

    // 필터링 적용된 실시간 월별 매출 및 마진 추이 차트 데이터 계산
    const currentMonthlyTrend = useMemo(() => {
        const monthlyDataMap: Record<string, any> = {};

        filteredLines.forEach((l) => {
            const mKey = `${l.year}-${String(l.month).padStart(2, "0")}`;
            if (!monthlyDataMap[mKey]) {
                monthlyDataMap[mKey] = { month: mKey, supplyPriceSum: 0, marginSum: 0 };
            }
            monthlyDataMap[mKey].supplyPriceSum += l.supply_price || 0;
            monthlyDataMap[mKey].marginSum += l.margin || 0;
        });

        return Object.values(monthlyDataMap).sort((a: any, b: any) =>
            a.month.localeCompare(b.month),
        );
    }, [filteredLines]);

    // 비율 헬퍼
    const getRatioText = (current: number, total: number) => {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        return `/ ${total}건 (${percent}%)`;
    };

    // 금액 포맷터 헬퍼
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat("ko-KR").format(value) + "원";
    };

    const formatCurrencyBrief = (value: number) => {
        if (Math.abs(value) >= 100000000) {
            const eok = (value / 100000000).toFixed(2);
            return `${eok}억원`;
        }
        if (Math.abs(value) >= 10000) {
            const man = (value / 10000).toFixed(0);
            return `${man}만원`;
        }
        return `${value}원`;
    };

    // 차트용 커스텀 툴팁
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const supplyVal = payload[0]?.value || 0;
            const marginVal = payload[1]?.value || 0;
            const marginRate = supplyVal > 0 ? ((marginVal / supplyVal) * 100).toFixed(1) : "0.0";

            return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-lg shadow-lg">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
                        {label}월
                    </p>
                    <div className="flex flex-col gap-1.5 text-xs">
                        <p className="text-blue-600 dark:text-blue-400 font-medium">
                            매출액: {formatCurrency(supplyVal)} ({formatCurrencyBrief(supplyVal)})
                        </p>
                        <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                            마진액: {formatCurrency(marginVal)} ({formatCurrencyBrief(marginVal)})
                        </p>
                        <p className="text-purple-600 dark:text-purple-400 font-semibold border-t dark:border-gray-700 pt-1.5 mt-1">
                            마진율 (매출 대비): {marginRate}%
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
                <div>
                    <h1 className="text-3xl font-bold dark:text-white">
                        파트너 매출 분석 대시보드
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        매출 및 단계별 통계
                    </p>
                </div>
                <Form
                    method="get"
                    className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                    <div className="flex items-center gap-1">
                        <select
                            name="startYear"
                            defaultValue={startYear}
                            className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                            {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                                <option key={y} value={y}>{y}년</option>
                            ))}
                        </select>
                        <select
                            name="startMonth"
                            defaultValue={startMonth}
                            className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{m}월</option>
                            ))}
                        </select>
                    </div>
                    <span className="text-gray-400 text-sm">~</span>
                    <div className="flex items-center gap-1">
                        <select
                            name="endYear"
                            defaultValue={endYear}
                            className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                            {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                                <option key={y} value={y}>{y}년</option>
                            ))}
                        </select>
                        <select
                            name="endMonth"
                            defaultValue={endMonth}
                            className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-800 dark:text-gray-200 focus:ring-1 focus:ring-blue-500"
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{m}월</option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-semibold transition-colors"
                    >
                        조회
                    </button>
                </Form>
            </div>

            {/* 구역 1: 4대 핵심 요약 지표 (영업 단계별 라인 건수) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                {/* 1. 계산서 발행 완료 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            계산서 발행 완료 (100%)
                        </h3>
                        <CheckCircle className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {currentSummary.totalBillIssued}건
                    </div>
                </div>

                {/* 2. 오더 완료 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            오더 완료 (99%)
                        </h3>
                        <PlusCircle className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {currentSummary.totalOrdered}건
                    </div>
                </div>

                {/* 3. 오더 예정 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            오더 예정 (50%, 75%)
                        </h3>
                        <Clock className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {currentSummary.totalOrderExpected}건
                    </div>
                </div>

                {/* 4. 진행 중 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            진행 중 (10%, 25%)
                        </h3>
                        <Edit3 className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {currentSummary.totalPending}건
                    </div>
                </div>
            </div>

            {/* 구역 2: 월별 매출 추이 차트 (이중 바 차트) */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm mb-6">
                <h3 className="text-base font-bold mb-6 dark:text-white flex items-center">
                    <TrendingUp className="w-5 h-5 mr-2 text-blue-500" /> 월별 매출 추이
                </h3>
                <div className="h-[350px] w-full">
                    {mounted ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={currentMonthlyTrend}
                                margin={{
                                    top: 10,
                                    right: 10,
                                    left: 20,
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
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 12, fill: "#6b7280" }}
                                    tickFormatter={(val) => formatCurrencyBrief(val)}
                                />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ fill: "rgba(0,0,0,0.02)" }}
                                />
                                <Legend />
                                <Bar
                                    dataKey="supplyPriceSum"
                                    name="매출액"
                                    fill="#3b82f6"
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={30}
                                />
                                <Bar
                                    dataKey="marginSum"
                                    name="마진액"
                                    fill="#10b981"
                                    radius={[4, 4, 0, 0]}
                                    maxBarSize={30}
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
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col">
                    <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3 mb-4">
                        <h2 className="text-xl font-bold dark:text-white flex items-center">
                            <Users className="w-5 h-5 mr-2 text-blue-500" />{" "}
                            파트너사별 횟수
                        </h2>
                        <div className="text-xs flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleAllPartners(true)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                전체선택
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                                type="button"
                                onClick={() => handleAllPartners(false)}
                                className="text-red-600 dark:text-red-400 hover:underline font-medium"
                            >
                                전체해제
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto max-h-[450px] pr-1">
                        {(partnerStats as any[]).map((partner) => (
                            <div
                                key={partner.partner_id}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                            >
                                <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50/50 dark:hover:bg-gray-600/50 transition-colors">
                                    <div className="flex items-center gap-2.5">
                                        <input
                                            type="checkbox"
                                            checked={activePartners.has(partner.partner_id)}
                                            onChange={() => handlePartnerCheckbox(partner.partner_id)}
                                            className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer"
                                        />
                                        <span
                                            onClick={() => togglePartner(partner.partner_id)}
                                            className="font-medium text-gray-800 dark:text-gray-200 cursor-pointer hover:underline"
                                        >
                                            {partner.partner_name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 py-1 px-3 rounded-full text-sm font-bold">
                                            {partner.quote_count}건
                                        </span>
                                        <span
                                            onClick={() => togglePartner(partner.partner_id)}
                                            className="text-gray-400 text-xs cursor-pointer p-1"
                                        >
                                            {expandedPartners.has(partner.partner_id) ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {/* 파트너사 담당자별 통계 (펼침 영역) */}
                                {expandedPartners.has(partner.partner_id) && (
                                    <div className="bg-white dark:bg-gray-800 p-3 border-t border-gray-200 dark:border-gray-700">
                                        {contactsByPartner[partner.partner_id] && contactsByPartner[partner.partner_id].length > 0 ? (
                                            <ul className="space-y-1">
                                                {contactsByPartner[partner.partner_id].map((contact: any) => (
                                                    <li
                                                        key={contact.contact_id}
                                                        className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 pl-4 py-1 border-l-2 border-blue-200 dark:border-blue-800 mb-1"
                                                    >
                                                        <span>↳ {contact.contact_name}</span>
                                                        <span className="font-medium">{contact.quote_count}건</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 pl-4 py-1">
                                                ↳ 등록된 담당자의 견적 건이 없습니다.
                                            </p>
                                        )}
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
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col">
                    <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3 mb-4">
                        <h2 className="text-xl font-bold dark:text-white flex items-center">
                            <Building2 className="w-5 h-5 mr-2 text-purple-500" />{" "}
                            벤더별 횟수
                        </h2>
                        <div className="text-xs flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleAllVendors(true)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                전체선택
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                                type="button"
                                onClick={() => handleAllVendors(false)}
                                className="text-red-600 dark:text-red-400 hover:underline font-medium"
                            >
                                전체해제
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto max-h-[450px] pr-1">
                        {(vendorStats as any[]).map((vendor) => (
                            <div
                                key={vendor.vendor_name}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                            >
                                <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 hover:bg-purple-50/50 dark:hover:bg-gray-600/50 transition-colors">
                                    <div className="flex items-center gap-2.5">
                                        <input
                                            type="checkbox"
                                            checked={activeVendors.has(vendor.vendor_name)}
                                            onChange={() => handleVendorCheckbox(vendor.vendor_name)}
                                            className="w-4 h-4 rounded text-purple-600 border-gray-300 focus:ring-purple-500 cursor-pointer"
                                        />
                                        <span
                                            onClick={() => toggleVendor(vendor.vendor_name)}
                                            className="font-medium text-gray-800 dark:text-gray-200 cursor-pointer hover:underline"
                                        >
                                            {vendor.vendor_name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 py-1 px-3 rounded-full text-sm font-bold">
                                            {vendor.quote_count}건
                                        </span>
                                        <span
                                            onClick={() => toggleVendor(vendor.vendor_name)}
                                            className="text-gray-400 text-xs cursor-pointer p-1"
                                        >
                                            {expandedVendors.has(vendor.vendor_name) ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                        </span>
                                    </div>
                                </div>

                                {/* 벤더 담당자(AM)별 통계 (펼침 영역) */}
                                {expandedVendors.has(vendor.vendor_name) && (
                                    <div className="bg-white dark:bg-gray-800 p-3 border-t border-gray-200 dark:border-gray-700">
                                        {amsByVendor[vendor.vendor_name] && amsByVendor[vendor.vendor_name].length > 0 ? (
                                            <ul className="space-y-1">
                                                {amsByVendor[vendor.vendor_name].map((am: any) => (
                                                    <li
                                                        key={am.am_id}
                                                        className="flex justify-between items-center text-sm text-gray-600 dark:text-gray-400 pl-4 py-1 border-l-2 border-purple-200 dark:border-purple-800 mb-1"
                                                    >
                                                        <span>↳ {am.am_name}</span>
                                                        <span className="font-medium">{am.quote_count}건</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 pl-4 py-1">
                                                ↳ 등록된 담당 영업사원(AM)의 견적 건이 없습니다.
                                            </p>
                                        )}
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
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col">
                    <div className="flex justify-between items-center border-b dark:border-gray-700 pb-3 mb-4">
                        <h2 className="text-xl font-bold dark:text-white flex items-center">
                            <UserCheck className="w-5 h-5 mr-2 text-green-500" />{" "}
                            총판 담당자별 횟수
                        </h2>
                        <div className="text-xs flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleAllDistContacts(true)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                전체선택
                            </button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button
                                type="button"
                                onClick={() => handleAllDistContacts(false)}
                                className="text-red-600 dark:text-red-400 hover:underline font-medium"
                            >
                                전체해제
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto max-h-[450px] pr-1">
                        {(distContactStats as any[]).map((dist) => (
                            <div
                                key={dist.dist_contact_id}
                                className="flex justify-between items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-green-50/20 dark:hover:bg-gray-600/50 transition-colors"
                            >
                                <div className="flex items-center gap-2.5">
                                    <input
                                        type="checkbox"
                                        checked={activeDistContacts.has(dist.dist_contact_id)}
                                        onChange={() => handleDistContactCheckbox(dist.dist_contact_id)}
                                        className="w-4 h-4 rounded text-green-600 border-gray-300 focus:ring-green-500 cursor-pointer"
                                    />
                                    <span className="font-medium text-gray-800 dark:text-gray-200">
                                        {dist.dist_contact_name}
                                    </span>
                                </div>
                                <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 py-1 px-3 rounded-full text-sm font-bold">
                                    {dist.quote_count}건
                                </span>
                            </div>
                        ))}
                        {distContactStats.length === 0 && (
                            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                                조회된 데이터가 없습니다.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* 구역 4: 상세 견적 라인 목록 테이블 */}
            <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="border-b dark:border-gray-700 pb-3 mb-4">
                    <h2 className="text-xl font-bold dark:text-white flex items-center">
                        <Building2 className="w-5 h-5 mr-2 text-blue-500" />{" "}
                        상세 매출 라인 내역
                    </h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                                <th className="px-4 py-3 font-semibold text-center w-[80px]">매출년</th>
                                <th className="px-4 py-3 font-semibold text-center w-[80px]">매출월</th>
                                <th className="px-4 py-3 font-semibold">파트너사</th>
                                <th className="px-4 py-3 font-semibold">고객사</th>
                                <th className="px-4 py-3 font-semibold">담당자</th>
                                <th className="px-4 py-3 font-semibold text-center w-[80px]">단계</th>
                                <th className="px-4 py-3 font-semibold">제품</th>
                                <th className="px-4 py-3 font-semibold text-right">매출액</th>
                                <th className="px-4 py-3 font-semibold text-right">마진</th>
                                <th className="px-4 py-3 font-semibold text-center w-[100px]">마진율</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredLines.map((line: any) => {
                                const marginRate = line.supply_price > 0 ? ((line.margin / line.supply_price) * 100).toFixed(1) : "0.0";
                                return (
                                    <tr key={line.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 text-gray-700 dark:text-gray-300">
                                        <td className="px-4 py-3.5 text-center">{line.year}년</td>
                                        <td className="px-4 py-3.5 text-center">{line.month}월</td>
                                        <td className="px-4 py-3.5 font-medium">{line.partner_name || "-"}</td>
                                        <td className="px-4 py-3.5">{line.client_company || "-"}</td>
                                        <td className="px-4 py-3.5">{line.dist_contact_name || "-"}</td>
                                        <td className="px-4 py-3.5 text-center">
                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${line.stage === 100 ? "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300" :
                                                line.stage === 99 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" :
                                                    line.stage >= 50 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300" :
                                                        "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                                }`}>
                                                {line.stage}%
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 font-medium" title={line.product_code || "-"}>
                                            {line.product_code || "-"}
                                        </td>
                                        <td className="px-4 py-3.5 text-right font-medium text-gray-900 dark:text-white">
                                            {formatCurrency(line.supply_price)}
                                        </td>
                                        <td className="px-4 py-3.5 text-right font-medium text-emerald-600 dark:text-emerald-400">
                                            {formatCurrency(line.margin)}
                                        </td>
                                        <td className="px-4 py-3.5 text-center font-semibold text-purple-600 dark:text-purple-400">
                                            {marginRate}%
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredLines.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                        조회된 매출 상세 라인이 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
