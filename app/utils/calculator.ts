export function getFinalProducts(
    productsToProcess: any[] | Record<string, any[]>,
    currentMode: string,
): any {
    if (Array.isArray(productsToProcess)) {
        return productsToProcess.map((prod) => {
            const lpd = Number(prod.lpd) || 0;
            const lpw = Number(prod.lpw) || 0;
            const qty = Number(prod.수량) || 0;
            const period = Number(prod.기간) || 0;
            const dcDollar = Number(prod.DC달러) || 0;
            const exchangeRate = Number(prod.환율) || 0;
            let dcWon = Number(prod.DC원화) || 0;

            const dollarPpc = lpd * (1 - dcDollar / 100);
            const dollarCost = lpd * qty * period;
            const dollarNet = dollarPpc * qty * period;
            const wonNet = dollarNet * exchangeRate;

            const baseUnitLpw = Math.round((lpw * period) / 1000) * 1000;
            let supplyPrice = 0;

            if (currentMode === "MANUAL") {
                // 수동 모드: 사용자가 입력한 달러net과 공급가를 절대적 기준으로 채택하여 마진/마진율 역산
                const manualDollarNet = prod.달러net !== undefined && prod.달러net !== null
                    ? Number(prod.달러net)
                    : (prod.netdollar !== undefined && prod.netdollar !== null ? Number(prod.netdollar) : dollarNet);
                const manualSupplyPrice = prod.공급가 !== undefined && prod.공급가 !== null
                    ? Number(prod.공급가)
                    : (prod.supply_price !== undefined && prod.supply_price !== null ? Number(prod.supply_price) : 0);

                const calcDollarPpc = (qty * period > 0) ? (manualDollarNet / (qty * period)) : 0;
                const calcWonNet = manualDollarNet * exchangeRate;
                const calcMargin = manualSupplyPrice - calcWonNet;
                const calcMarginPercent = manualSupplyPrice > 0
                    ? ((calcMargin / manualSupplyPrice) * 100).toFixed(1)
                    : "0.0";
                const calcWonPpc = (qty * period > 0) ? Math.round(manualSupplyPrice / (qty * period)) : 0;

                return {
                    ...prod,
                    DC원화: dcWon,
                    달러PPC: calcDollarPpc,
                    달러원가: dollarCost,
                    달러net: manualDollarNet,
                    netdollar: manualDollarNet,
                    공급가: manualSupplyPrice,
                    마진: calcMargin,
                    원화PPC: calcWonPpc,
                    마진율: calcMarginPercent,
                };
            }

            if (currentMode === "PPC" && prod.원화PPC !== undefined) {
                supplyPrice = Number(prod.원화PPC) * qty * period;
            } else if (currentMode === "MARGIN" && prod.마진율 !== undefined) {
                const inputMarginPercent = Number(prod.마진율);
                let tempSupply = 0;
                if (inputMarginPercent < 100) {
                    tempSupply =
                        Math.round(
                            wonNet / (1 - inputMarginPercent / 100) / 1000,
                        ) * 1000;
                }
                const baseTotalLpw = lpw * qty * period;
                if (baseTotalLpw > 0) {
                    const rawDcWon = (1 - tempSupply / baseTotalLpw) * 100;
                    dcWon = Math.trunc(rawDcWon * 100) / 100;
                }

                // 마진% 기준일 경우, 역산된 DC원화를 바탕으로 공급가를 순방향으로 다시 도출
                const discountedUnitLpw =
                    Math.round((baseUnitLpw * (1 - dcWon / 100)) / 1000) * 1000;
                supplyPrice = discountedUnitLpw * qty;
            } else {
                const discountedUnitLpw =
                    Math.round((baseUnitLpw * (1 - dcWon / 100)) / 1000) * 1000;
                supplyPrice = discountedUnitLpw * qty;
            }

            const wonPpc = qty * period > 0 ? supplyPrice / (qty * period) : 0;
            const margin = supplyPrice - wonNet;
            const marginPercent = supplyPrice
                ? ((margin / supplyPrice) * 100).toFixed(1)
                : "0.0";

            return {
                ...prod,
                DC원화: dcWon, // 재계산된 DC원화 저장
                달러PPC: dollarPpc,
                달러원가: dollarCost,
                달러net: dollarNet,
                netdollar: dollarNet,
                공급가: supplyPrice,
                마진: margin,
                원화PPC:
                    currentMode === "PPC" && prod.원화PPC !== undefined
                        ? prod.원화PPC
                        : Math.round(wonPpc),
                마진율:
                    currentMode === "MARGIN" && prod.마진율 !== undefined
                        ? prod.마진율
                        : marginPercent,
            };
        });
    } else {
        const processed: Record<string, any[]> = {};
        for (const [groupName, prods] of Object.entries(productsToProcess)) {
            processed[groupName] = getFinalProducts(prods, currentMode);
        }
        return processed;
    }
}

// 빈 제품 행 객체를 생성하는 공통 팩토리 함수
export function createEmptyProductRow(defaultRate?: number) {
    const nowSeoul = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const currentYear = nowSeoul.getFullYear();
    const currentMonth = nowSeoul.getMonth() + 1;

    return {
        제품코드: "",
        제품설명: "",
        lpd: 0,
        lpw: 0,
        수량: 1,
        기간: 1,
        DC달러: 0,
        환율: defaultRate || 0,
        DC원화: 0,
        공급가: 0,
        마진: 0,
        년차: currentYear,
        원화PPC: 0,
        마진율: "0.0",
        매출월: currentMonth,
        stage: 10,
    };
}

// 원화PPC 또는 마진율 변경 시 DC원화 역산 수식 공통화 함수
export function calculateReverseDCWon(
    field: string,
    value: any,
    product: any,
): number | null {
    const lpd = Number(product.lpd) || 0;
    const lpw = Number(product.lpw) || 0;
    const qty = Number(product.수량) || 0;
    const period = Number(product.기간) || 0;
    const dcDollar = Number(product.DC달러) || 0;
    const exchangeRate = Number(product.환율) || 0;
    const baseTotalLpw = lpw * qty * period;

    if (baseTotalLpw <= 0) return null;

    let targetSupply: number | null = null;
    if (field === "원화PPC") {
        targetSupply = (Number(value) || 0) * qty * period;
    } else if (field === "마진율") {
        const inputMarginPercent = Number(value) || 0;
        if (inputMarginPercent < 100) {
            const dollarPpc = lpd * (1 - dcDollar / 100);
            const wonNet = dollarPpc * qty * period * exchangeRate;
            targetSupply =
                Math.round(
                    wonNet /
                        (1 - inputMarginPercent / 100) /
                        1000,
                ) * 1000;
        }
    }

    if (targetSupply !== null) {
        const rawDcWon = (1 - targetSupply / baseTotalLpw) * 100;
        return Math.trunc(rawDcWon * 100) / 100;
    }
    return null;
}
