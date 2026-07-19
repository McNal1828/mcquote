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
