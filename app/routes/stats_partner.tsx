import { useState, useEffect, useMemo } from "react";
import { Form, redirect } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/stats_partner";
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
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

export function shouldRevalidate() {
    return true;
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const startDateParam = url.searchParams.get("startDate");
    const endDateParam = url.searchParams.get("endDate");

    // 파라미터가 누락되면 기본값(이전 달 1일 ~ 이번 달 말일, 최소 2달 확보)으로 주소창 강제 동기화 리다이렉트
    if (!startDateParam || !endDateParam) {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const lastDay = new Date(y, now.getMonth() + 1, 0);

        // 이전 달의 1일 계산
        const prevMonthDate = new Date(y, now.getMonth() - 1, 1);
        const py = prevMonthDate.getFullYear();
        const pm = String(prevMonthDate.getMonth() + 1).padStart(2, "0");

        url.searchParams.set("startDate", `${py}-${pm}-01`);
        url.searchParams.set("endDate", `${y}-${m}-${String(lastDay.getDate()).padStart(2, "0")}`);
        return redirect(url.pathname + url.search);
    }

    const startDate = startDateParam;
    const endDate = endDateParam;

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

    // 7. 견적 상세 데이터 조회 (실시간 연산을 위한 필드 확장)
    const rawQuotes = db
        .prepare(
            `
        SELECT 
            q.id,
            q.created_at,
            q.updated_at,
            q.is_ordered,
            q.is_lost,
            q.partner_id,
            p.name as partner_name,
            q.dist_contact_id,
            (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = q.id) as vendors,
            CASE WHEN q.is_lost = 1 THEN 0 ELSE COALESCE((
                SELECT SUM(ql.supply_price)
                FROM quote_lines ql
                JOIN quote_groups qg ON ql.group_id = qg.id
                WHERE qg.quote_id = q.id AND qg."default" = 1
            ), 0) END as total_price
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        WHERE ${timeFilter}
    `,
        )
        .all(...timeParams) as any[];

    // 원본 데이터 기준으로 초기 요약 데이터(분모용) 계산
    let totalNew = 0;
    let totalModified = 0;
    let totalOrdered = 0;
    let totalLost = 0;
    let totalPending = 0;

    rawQuotes.forEach((q) => {
        const isNew = q.created_at >= startTimestamp && q.created_at <= endTimestamp;
        const isModified = !isNew && (q.updated_at >= startTimestamp && q.updated_at <= endTimestamp);

        if (isNew) totalNew++;
        else if (isModified) totalModified++;

        if (q.is_ordered) totalOrdered++;
        else if (q.is_lost) totalLost++;
        else totalPending++;
    });

    const summary = {
        totalQuotes: rawQuotes.length,
        totalNew,
        totalModified,
        totalOrdered,
        totalLost,
        totalPending,
    };

    return {
        startDate,
        endDate,
        startTimestamp,
        endTimestamp,
        partnerStats,
        contactsByPartner,
        distContactStats,
        vendorStats,
        amsByVendor,
        summary,
        rawQuotes,
    };
}

export default function StatsPartner({ loaderData }: Route.ComponentProps) {
    const {
        startDate,
        endDate,
        startTimestamp,
        endTimestamp,
        partnerStats,
        distContactStats,
        vendorStats,
        summary,
        rawQuotes,
    } = loaderData;
    const contactsByPartner: Record<string | number, any> = loaderData.contactsByPartner || {};
    const amsByVendor: Record<string, any> = loaderData.amsByVendor || {};

    const [expandedPartners, setExpandedPartners] = useState<Set<number>>(new Set());
    const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
    const [mounted, setMounted] = useState(false);
    const [activeMetric, setActiveMetric] = useState<"count" | "price">("count");

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

    // 실시간 필터링된 견적 데이터
    const filteredQuotes = useMemo(() => {
        return (rawQuotes as any[]).filter((q) => {
            // 1. 파트너 필터
            if (!activePartners.has(q.partner_id)) return false;
            // 2. 총판 담당자 필터
            if (!activeDistContacts.has(q.dist_contact_id)) return false;
            // 3. 벤더 필터
            const vList = q.vendors ? q.vendors.split(",") : [];
            if (vList.length > 0) {
                const hasActiveVendor = vList.some((v: string) => activeVendors.has(v));
                if (!hasActiveVendor) return false;
            }
            return true;
        });
    }, [rawQuotes, activePartners, activeVendors, activeDistContacts]);

    // 필터링 적용된 실시간 요약 통계 계산
    const currentSummary = useMemo(() => {
        let totalNew = 0;
        let totalModified = 0;
        let totalOrdered = 0;
        let totalLost = 0;
        let totalPending = 0;

        filteredQuotes.forEach((q) => {
            const isNew = q.created_at >= startTimestamp && q.created_at <= endTimestamp;
            const isModified = !isNew && (q.updated_at >= startTimestamp && q.updated_at <= endTimestamp);

            if (isNew) totalNew++;
            else if (isModified) totalModified++;

            if (q.is_ordered) totalOrdered++;
            else if (q.is_lost) totalLost++;
            else totalPending++;
        });

        return {
            totalQuotes: filteredQuotes.length,
            totalNew,
            totalModified,
            totalOrdered,
            totalLost,
            totalPending,
        };
    }, [filteredQuotes, startTimestamp, endTimestamp]);

    // 필터링된 견적 내에 속해 있는 고유한 파트너사 목록 추출 (정렬 적용)
    const partnerNames = useMemo(() => {
        const names = new Set<string>();
        filteredQuotes.forEach((q) => {
            if (q.partner_name) {
                names.add(q.partner_name);
            }
        });
        return Array.from(names).sort();
    }, [filteredQuotes]);

    // 필터링 적용된 실시간 월별 파트너별 견적 건수 및 공급가액 추이 차트 데이터 계산
    const currentMonthlyTrend = useMemo(() => {
        const monthlyDataMap: Record<string, any> = {};

        filteredQuotes.forEach((q) => {
            const isNew = q.created_at >= startTimestamp && q.created_at <= endTimestamp;
            const isModified = !isNew && (q.updated_at >= startTimestamp && q.updated_at <= endTimestamp);

            let d: Date | null = null;
            if (isNew) {
                d = new Date(q.created_at);
            } else if (isModified) {
                d = new Date(q.updated_at);
            }

            if (d && q.partner_name) {
                const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                if (!monthlyDataMap[mKey]) {
                    monthlyDataMap[mKey] = {
                        month: mKey,
                    };
                }

                // 영업 상태 분류 (오더 완료, 실주, 진행 중)
                let status = "pending";
                if (q.is_ordered === 1) {
                    status = "ordered";
                } else if (q.is_lost === 1) {
                    status = "lost";
                }

                const countKey = `${q.partner_name}_count`;
                const priceKey = `${q.partner_name}_price`;
                
                const statusCountKey = `${q.partner_name}_${status}_count`;
                const statusPriceKey = `${q.partner_name}_${status}_price`;

                // 총합 합산
                monthlyDataMap[mKey][countKey] = (monthlyDataMap[mKey][countKey] || 0) + 1;
                monthlyDataMap[mKey][priceKey] = (monthlyDataMap[mKey][priceKey] || 0) + (q.total_price || 0);

                // 상태별 세부 합산
                monthlyDataMap[mKey][statusCountKey] = (monthlyDataMap[mKey][statusCountKey] || 0) + 1;
                monthlyDataMap[mKey][statusPriceKey] = (monthlyDataMap[mKey][statusPriceKey] || 0) + (q.total_price || 0);
            }
        });

        // 빈 파트너사의 지표값을 0으로 동화시켜 왜곡을 원천 방지 및 상세 상태도 0으로 동화
        const result = Object.values(monthlyDataMap).map((item: any) => {
            partnerNames.forEach((name) => {
                const countKey = `${name}_count`;
                const priceKey = `${name}_price`;
                if (item[countKey] === undefined) item[countKey] = 0;
                if (item[priceKey] === undefined) item[priceKey] = 0;

                ["pending", "ordered", "lost"].forEach((status) => {
                    const statusCountKey = `${name}_${status}_count`;
                    const statusPriceKey = `${name}_${status}_price`;
                    if (item[statusCountKey] === undefined) item[statusCountKey] = 0;
                    if (item[statusPriceKey] === undefined) item[statusPriceKey] = 0;
                });
            });
            return item;
        });

        return result.sort((a: any, b: any) =>
            a.month.localeCompare(b.month),
        );
    }, [filteredQuotes, partnerNames, startTimestamp, endTimestamp]);

    // 전체 파트너사별 건수 및 금액 누적 총합을 구해 각각 내림차순 순위 추출
    const topPartnersInfo = useMemo(() => {
        const counts: Record<string, number> = {};
        const prices: Record<string, number> = {};
        
        filteredQuotes.forEach((q) => {
            if (q.partner_name) {
                counts[q.partner_name] = (counts[q.partner_name] || 0) + 1;
                prices[q.partner_name] = (prices[q.partner_name] || 0) + (q.total_price || 0);
            }
        });

        const sortedByCount = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        const sortedByPrice = Object.keys(prices).sort((a, b) => prices[b] - prices[a]);

        return {
            countTop: sortedByCount.slice(0, 7),
            countOthers: sortedByCount.slice(7),
            priceTop: sortedByPrice.slice(0, 7),
            priceOthers: sortedByPrice.slice(7),
        };
    }, [filteredQuotes]);

    // 활성 지표(건수/금액)에 따른 동적 상위 7개사와 기타 파트너사 목록
    const activeTopPartners = useMemo(() => {
        return activeMetric === "count" ? topPartnersInfo.countTop : topPartnersInfo.priceTop;
    }, [activeMetric, topPartnersInfo]);

    const activeOthers = useMemo(() => {
        return activeMetric === "count" ? topPartnersInfo.countOthers : topPartnersInfo.priceOthers;
    }, [activeMetric, topPartnersInfo]);

    // 차트에서 동적으로 그릴 파트너사 목록 (상위 7개사 + 기타)
    const chartPartners = useMemo(() => {
        const list = [...activeTopPartners];
        if (activeOthers.length > 0) {
            list.push("기타");
        }
        return list;
    }, [activeTopPartners, activeOthers]);

    // 월별 데이터를 상위 7개사와 '기타'로 합산 가공한 최종 차트용 데이터 배열
    const finalChartData = useMemo(() => {
        return currentMonthlyTrend.map((monthItem: any) => {
            const newItem: any = { month: monthItem.month };
            
            // 1. 상위 7개 파트너사는 데이터 그대로 이관
            activeTopPartners.forEach((name) => {
                const suffix = activeMetric === "count" ? "count" : "price";
                newItem[name] = monthItem[`${name}_${suffix}`] || 0;
                
                // 툴팁 연동용 개별 상태 수치 복사
                newItem[`${name}_ordered_count`] = monthItem[`${name}_ordered_count`] || 0;
                newItem[`${name}_pending_count`] = monthItem[`${name}_pending_count`] || 0;
                newItem[`${name}_lost_count`] = monthItem[`${name}_lost_count`] || 0;
                newItem[`${name}_ordered_price`] = monthItem[`${name}_ordered_price`] || 0;
                newItem[`${name}_pending_price`] = monthItem[`${name}_pending_price`] || 0;
                newItem[`${name}_lost_price`] = monthItem[`${name}_lost_price`] || 0;
            });

            // 2. 8위 이하 기타 파트너사는 '기타' 키 하위로 전부 합산 집계
            if (activeOthers.length > 0) {
                const suffix = activeMetric === "count" ? "count" : "price";
                let othersSum = 0;
                let othersOrderedCount = 0;
                let othersPendingCount = 0;
                let othersLostCount = 0;
                let othersOrderedPrice = 0;
                let othersPendingPrice = 0;
                let othersLostPrice = 0;

                activeOthers.forEach((name) => {
                    othersSum += monthItem[`${name}_${suffix}`] || 0;
                    othersOrderedCount += monthItem[`${name}_ordered_count`] || 0;
                    othersPendingCount += monthItem[`${name}_pending_count`] || 0;
                    othersLostCount += monthItem[`${name}_lost_count`] || 0;
                    othersOrderedPrice += monthItem[`${name}_ordered_price`] || 0;
                    othersPendingPrice += monthItem[`${name}_pending_price`] || 0;
                    othersLostPrice += monthItem[`${name}_lost_price`] || 0;
                });

                newItem["기타"] = othersSum;
                newItem["기타_ordered_count"] = othersOrderedCount;
                newItem["기타_pending_count"] = othersPendingCount;
                newItem["기타_lost_count"] = othersLostCount;
                newItem["기타_ordered_price"] = othersOrderedPrice;
                newItem["기타_pending_price"] = othersPendingPrice;
                newItem["기타_lost_price"] = othersLostPrice;
            }

            return newItem;
        });
    }, [currentMonthlyTrend, activeTopPartners, activeOthers, activeMetric]);

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
            const rowData = payload[0].payload;

            // 값이 존재하는 파트너사를 기여도 순(내림차순)으로 나열
            const items = payload
                .map((p: any) => {
                    const name = p.name;
                    const value = p.value || 0;
                    const color = p.color;

                    // 상태별 수치 추출
                    const ordered = rowData[`${name}_ordered_count`] || 0;
                    const pending = rowData[`${name}_pending_count`] || 0;
                    const lost = rowData[`${name}_lost_count`] || 0;

                    const orderedPrice = rowData[`${name}_ordered_price`] || 0;
                    const pendingPrice = rowData[`${name}_pending_price`] || 0;
                    const lostPrice = rowData[`${name}_lost_price`] || 0;

                    return {
                        name,
                        value,
                        color,
                        ordered,
                        pending,
                        lost,
                        orderedPrice,
                        pendingPrice,
                        lostPrice,
                    };
                })
                .filter((item: any) => item.value > 0)
                .sort((a: any, b: any) => b.value - a.value);

            const total = items.reduce((sum: number, item: any) => sum + item.value, 0);

            return (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-lg shadow-lg min-w-[280px] max-h-[400px] overflow-y-auto">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 mb-2 border-b dark:border-gray-700 pb-1">
                        {label}월 파트너 견적 분석
                    </p>
                    <div className="flex flex-col gap-3 text-xs">
                        {items.map((item: any) => (
                            <div key={item.name} className="border-b border-gray-100 dark:border-gray-700/50 pb-2 last:border-b-0 last:pb-0">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="flex items-center gap-1.5 font-bold">
                                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                                        <span className="text-gray-800 dark:text-gray-200">{item.name}</span>
                                    </span>
                                    <span className="font-bold text-gray-900 dark:text-white">
                                        {activeMetric === "count" 
                                            ? `${item.value}건` 
                                            : formatCurrency(item.value)
                                        }
                                    </span>
                                </div>
                                <div className="pl-4 flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                                    <div className="flex justify-between">
                                        <span>• 오더 완료:</span>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            {activeMetric === "count" 
                                                ? `${item.ordered}건` 
                                                : formatCurrency(item.orderedPrice)
                                            }
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>• 진행 중:</span>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            {activeMetric === "count" 
                                                ? `${item.pending}건` 
                                                : formatCurrency(item.pendingPrice)
                                            }
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>• 실주:</span>
                                        <span className="font-medium text-gray-700 dark:text-gray-300">
                                            {activeMetric === "count" 
                                                ? `${item.lost}건` 
                                                : formatCurrency(item.lostPrice)
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div className="flex justify-between items-center border-t dark:border-gray-700 pt-2 mt-1 font-bold text-blue-600 dark:text-blue-400">
                            <span>전체 합계</span>
                            <span>
                                {activeMetric === "count" 
                                    ? `${total}건` 
                                    : formatCurrency(total)
                                }
                            </span>
                        </div>
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
                        파트너 견적 분석 대시보드
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        견적 건수 및 진행 현황 확인
                    </p>
                </div>
                <Form
                    method="get"
                    className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                    <input
                        type="date"
                        name="startDate"
                        key={startDate}
                        defaultValue={startDate}
                        className="bg-transparent px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none dark:[color-scheme:dark]"
                    />
                    <span className="text-gray-400 text-sm">~</span>
                    <input
                        type="date"
                        name="endDate"
                        key={endDate}
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

            {/* 구역 1: 5대 핵심 요약 지표 (Summary Cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-6">
                {/* 1. 신규 견적 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            신규 견적 건수
                        </h3>
                        <PlusCircle className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                        <span>{currentSummary.totalNew}건</span>
                        <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {getRatioText(currentSummary.totalNew, currentSummary.totalQuotes)}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        조회 기간 내 최초 작성된 건
                    </p>
                </div>

                {/* 2. 수정 견적 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            수정 견적 건수
                        </h3>
                        <Edit3 className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                        <span>{currentSummary.totalModified}건</span>
                        <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {getRatioText(currentSummary.totalModified, currentSummary.totalQuotes)}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        이전 생성 건 중 기간 내 수정된 건
                    </p>
                </div>

                {/* 3. 진행 중 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            진행 중인 건
                        </h3>
                        <Clock className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                        <span>{currentSummary.totalPending}건</span>
                        <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {getRatioText(currentSummary.totalPending, currentSummary.totalQuotes)}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        오더 및 실주가 결정되지 않은 건
                    </p>
                </div>

                {/* 4. 오더 완료 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            오더 완료
                        </h3>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                        <span>{currentSummary.totalOrdered}건</span>
                        <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {getRatioText(currentSummary.totalOrdered, currentSummary.totalQuotes)}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        성공적으로 수주 완료된 건
                    </p>
                </div>

                {/* 5. 실주 */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                            실주 (Lost)
                        </h3>
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                        <span>{currentSummary.totalLost}건</span>
                        <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {getRatioText(currentSummary.totalLost, currentSummary.totalQuotes)}
                        </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                        최종 실주(실패) 처리된 건
                    </p>
                </div>
            </div>

            {/* 구역 2: 월별 파트너사 견적 추이 차트 (Stacked Area Chart) */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm mb-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h3 className="text-base font-bold dark:text-white flex items-center mb-0">
                        <TrendingUp className="w-5 h-5 mr-2 text-blue-500" /> 월별 파트너 견적 추이
                    </h3>
                    
                    {/* 토글 버튼 */}
                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg text-xs">
                        <button
                            type="button"
                            onClick={() => setActiveMetric("count")}
                            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                                activeMetric === "count"
                                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            }`}
                        >
                            건수 기준
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveMetric("price")}
                            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                                activeMetric === "price"
                                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            }`}
                        >
                            금액 기준
                        </button>
                    </div>
                </div>
                
                <div className="h-[300px] w-full">
                    {mounted ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                                data={finalChartData}
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
                                    tickFormatter={(val) => 
                                        activeMetric === "count" ? val : formatCurrencyBrief(val)
                                    }
                                />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '3 3' }}
                                />
                                {(() => {
                                    const COLORS = [
                                        "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
                                        "#ec4899", "#14b8a6"
                                    ];
                                    return chartPartners.map((name, index) => {
                                        const color = name === "기타" ? "#9ca3af" : COLORS[index % COLORS.length];
                                        return (
                                            <Area
                                                key={name}
                                                type="monotone"
                                                dataKey={name}
                                                name={name}
                                                stackId="1"
                                                stroke={color}
                                                fill={color}
                                                fillOpacity={0.2}
                                            />
                                        );
                                    });
                                })()}
                            </AreaChart>
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
        </div>
    );
}
