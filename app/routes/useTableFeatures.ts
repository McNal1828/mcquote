import { useState, useMemo } from "react";

export type SortDirection = "desc" | "asc";
export type SortRule = { key: string; direction: SortDirection };

interface UseTableFeaturesProps<T> {
    data: T[]; // 원본 데이터 배열
    filterFormatters?: Record<string, (val: any, row: T) => string>; // 화면에 보이는 포맷으로 변환해 주는 함수들
}

export function useTableFeatures<T extends Record<string, any>>({
    data,
    filterFormatters,
}: UseTableFeaturesProps<T>) {
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [sortRules, setSortRules] = useState<SortRule[]>([]);

    const handleFilterChange = (key: string, value: string) => {
        setFilters((prev) => ({
            ...prev,
            [key]: value,
        }));
    };

    const handleSort = (key: string) => {
        setSortRules((prev) => {
            const existingRuleIndex = prev.findIndex(
                (rule) => rule.key === key,
            );
            if (existingRuleIndex === -1) {
                return [...prev, { key, direction: "desc" }];
            }

            const existingRule = prev[existingRuleIndex];
            if (existingRule.direction === "desc") {
                const newRules = [...prev];
                newRules[existingRuleIndex] = { key, direction: "asc" };
                return newRules;
            } else {
                return prev.filter((rule) => rule.key !== key);
            }
        });
    };

    // 원본 데이터가 바뀌거나, 검색어, 정렬 룰이 바뀔 때만 재계산하도록 useMemo로 최적화합니다.
    const processedData = useMemo(() => {
        // 1. 필터(검색) 로직 적용
        const filtered = data.filter((row) => {
            return Object.entries(filters).every(([key, filterValue]) => {
                if (!filterValue) return true;

                let cellValue = row[key];
                // 외부에서 주입받은 포맷터가 있다면 검색 전에 값을 변환합니다.
                if (filterFormatters && filterFormatters[key]) {
                    cellValue = filterFormatters[key](cellValue, row);
                }

                if (cellValue == null) return false;
                return String(cellValue)
                    .toLowerCase()
                    .includes(filterValue.toLowerCase());
            });
        });

        // 2. 다중 정렬 로직 적용
        return filtered.sort((a, b) => {
            for (const rule of sortRules) {
                let valA = a[rule.key];
                let valB = b[rule.key];

                if (valA == null) valA = "";
                if (valB == null) valB = "";

                if (typeof valA === "string" && typeof valB === "string") {
                    const cmp = valA.localeCompare(valB);
                    if (cmp !== 0) return rule.direction === "asc" ? cmp : -cmp;
                } else {
                    if (valA < valB) return rule.direction === "asc" ? -1 : 1;
                    if (valA > valB) return rule.direction === "asc" ? 1 : -1;
                }
            }
            return 0;
        });
    }, [data, filters, sortRules, filterFormatters]);

    return {
        processedData,
        filters,
        sortRules,
        handleFilterChange,
        handleSort,
    };
}
