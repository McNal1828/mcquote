import { useState, Fragment, useEffect, useRef } from "react";
import { useFetcher, useSearchParams, Link } from "react-router";
import crypto from "crypto";
import { getFinalProducts, createEmptyProductRow, calculateReverseDCWon } from "~/utils/calculator";
import { sendGasBatchRequest } from "~/utils/gasService";
import ProductTable from "~/components/ProductTable";
import type { Route } from "./+types/home";
import db from "../db.server";
import { logger } from "~/utils/logger";
import {
    Search,
    Calendar,
    Tag,
    Download,
    Package,
    Plus,
    Save,
    Trash2,
    X,
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
    FileSpreadsheet,
    Trophy,
} from "lucide-react";

export const handle = {
    breadcrumb: () => "홈페이지",
};

export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return {
        // 데이터 추가/삭제 시 즉각적인 화면 반영을 위해 브라우저 캐시를 비활성화합니다.
        "Cache-Control": "no-cache, no-store, must-revalidate",
    };
}

export async function action({ request }: Route.ActionArgs) {
    const data = await request.json();
    const {
        intent,
        quoteId,
        products,
        calcMode,
        notes,
        gasNote,
        projectName,
        isOrdered,
        isLost,
        originalUpdatedAt,
        defaultGroup,
        stage,
        syncToGas,
        payment_condition,
        billing_condition,
        quote_number,
        po_number,
    } = data;

    const paymentConditionNum = payment_condition !== undefined && payment_condition !== null ? Number(payment_condition) : null;
    const billingConditionNum = billing_condition !== undefined && billing_condition !== null ? Number(billing_condition) : null;
    const quoteNumberStr = quote_number !== undefined && quote_number !== null ? String(quote_number) : null;
    const poNumberStr = po_number !== undefined && po_number !== null ? String(po_number) : null;

    logger.info(`[Home Action] Received request: intent=${intent}, quoteId=${quoteId}`);

    if (intent === "delete") {
        try {
            logger.info(`[Home Action] Deleting Quote ID: ${quoteId}...`);
            // [구글 시트 연동] 삭제 전에 기존 디폴트 그룹의 라인 ID와 동기화 설정을 먼저 조회해둡니다.
            const currentQuote = db.prepare("SELECT sync_to_gas FROM quotes WHERE id = ?").get(Number(quoteId)) as { sync_to_gas: number } | undefined;
            const priorSyncToGas = currentQuote ? currentQuote.sync_to_gas : 1;

            const oldLines = db.prepare(`
                SELECT ql.id 
                FROM quote_lines ql
                JOIN quote_groups qg ON ql.group_id = qg.id
                WHERE qg.quote_id = ? AND qg."default" = 1
            `).all(Number(quoteId)) as Array<{ id: number }>;

            const stmt = db.prepare("DELETE FROM quotes WHERE id = ?");
            stmt.run(quoteId);

            // DB 커밋 성공 후 사용자가 연동해두었던 경우에만 구글 시트에서 기존 라인 일괄 삭제 요청
            if (priorSyncToGas === 1 && oldLines.length > 0) {
                const deleteIds = oldLines.map(line => line.id);
                await sendGasBatchRequest({ deleteIds });
            }

            logger.info(`[Home Action] Quote ID ${quoteId} deleted successfully and synced to Google Sheets.`);
            return { success: true, intent: "delete" };
        } catch (error: any) {
            logger.error(`[Home Action] Quote ID ${quoteId} delete failed: ${error.stack || error.message}`);
            return { error: "삭제 중 오류가 발생했습니다." };
        }
    }

    if (intent === "updateStage") {
        try {
            const targetQuoteId = Number(quoteId);
            const targetStage = Number(stage);
            let targetIsOrdered = 0;
            let targetIsLost = 0;
            if (targetStage === 0) {
                targetIsLost = 1;
            } else if (targetStage === 99 || targetStage === 100) {
                targetIsOrdered = 1;
            }

            logger.info(`[Home Action] Updating stage for Quote ID: ${targetQuoteId} to ${targetStage}% (Ordered: ${targetIsOrdered}, Lost: ${targetIsLost})...`);

            // 1. 구글 시트 연동 상태 및 기존 디폴트 그룹의 라인 ID 리스트를 미리 조회합니다.
            const currentQuote = db.prepare("SELECT sync_to_gas, project_code FROM quotes WHERE id = ?").get(targetQuoteId) as { sync_to_gas: number; project_code?: string } | undefined;
            const priorSyncToGas = currentQuote ? currentQuote.sync_to_gas : 1;

            const defaultLines = db.prepare(`
                SELECT ql.id 
                FROM quote_lines ql
                JOIN quote_groups qg ON ql.group_id = qg.id
                WHERE qg.quote_id = ? AND qg."default" = 1
            `).all(targetQuoteId) as Array<{ id: number }>;

            // 2. DB 업데이트 수행
            db.transaction(() => {
                db.prepare(`
                    UPDATE quotes 
                    SET stage = ?, is_ordered = ?, is_lost = ?, updated_at = ?,
                        payment_condition = COALESCE(?, payment_condition),
                        billing_condition = COALESCE(?, billing_condition),
                        quote_number = COALESCE(?, quote_number),
                        po_number = COALESCE(?, po_number)
                    WHERE id = ?
                `).run(targetStage, targetIsOrdered, targetIsLost, Date.now(), paymentConditionNum, billingConditionNum, quoteNumberStr, poNumberStr, targetQuoteId);

                db.prepare(`
                    UPDATE quote_lines 
                    SET stage = ?
                    WHERE group_id IN (SELECT id FROM quote_groups WHERE quote_id = ?)
                `).run(targetStage, targetQuoteId);

                // 만약 모달에서 라인데이터 수동 수정사항(lines)이 함께 넘어온 경우
                let parsedLines: any[] = [];
                if (data.lines) {
                    try {
                        parsedLines = typeof data.lines === "string" ? JSON.parse(data.lines) : data.lines;
                    } catch (e) {
                        parsedLines = [];
                    }
                }

                if (Array.isArray(parsedLines) && parsedLines.length > 0) {
                    const updateLineStmt = db.prepare(`
                        UPDATE quote_lines
                        SET year = ?, month = ?, netdollar = ?, exchange_rate = ?, supply_price = ?, margin = ?, margin_rate = ?
                        WHERE id = ?
                    `);
                    for (const l of parsedLines) {
                        const lineId = Number(l.id);
                        if (!lineId) continue;
                        const yearNum = Number(l.년차 || l.year) || 1;
                        const monthNum = Number(l.매출월 || l.month) || 1;
                        const netdollarNum = Number(l.달러net || l.netdollar) || 0;
                        const exRateNum = Number(l.환율 || l.exchange_rate) || 0;
                        const supplyPriceNum = Number(l.공급가 || l.supply_price) || 0;
                        const marginNum = supplyPriceNum - (netdollarNum * exRateNum);
                        const marginRateNum = supplyPriceNum > 0 ? parseFloat(((marginNum / supplyPriceNum) * 100).toFixed(1)) : 0;

                        updateLineStmt.run(yearNum, monthNum, netdollarNum, exRateNum, supplyPriceNum, marginNum, marginRateNum, lineId);
                    }
                }
            })();

            // 3. 구글 시트 동기화가 설정되어 있을 때만 일괄 송신
            if (priorSyncToGas === 1 && defaultLines.length > 0) {
                let parsedLines: any[] = [];
                if (data.lines) {
                    try { parsedLines = typeof data.lines === "string" ? JSON.parse(data.lines) : data.lines; } catch (e) {}
                }
                const updateRows = defaultLines.map(line => {
                    const matchedLine = Array.isArray(parsedLines) ? parsedLines.find((l: any) => Number(l.id) === line.id) : null;
                    if (matchedLine) {
                        const netdollarNum = Number(matchedLine.달러net || matchedLine.netdollar) || 0;
                        const exRateNum = Number(matchedLine.환율 || matchedLine.exchange_rate) || 0;
                        const supplyPriceNum = Number(matchedLine.공급가 || matchedLine.supply_price) || 0;
                        const marginNum = supplyPriceNum - (netdollarNum * exRateNum);
                        return {
                            id: line.id,
                            year: Number(matchedLine.년차 || matchedLine.year) || 1,
                            month: Number(matchedLine.매출월 || matchedLine.month) || 1,
                            stage: targetStage / 100,
                            price: supplyPriceNum,
                            margin: marginNum,
                            netdollar: netdollarNum,
                            projectCode: currentQuote?.project_code || ""
                        };
                    }
                    return {
                        id: line.id,
                        stage: targetStage / 100, // 백분율 환산 (50% -> 0.5)
                        projectCode: currentQuote?.project_code || ""
                    };
                });
                await sendGasBatchRequest({ updateRows });
            }

            logger.info(`[Home Action] Quote ID ${targetQuoteId} stage updated to ${targetStage}% and synced to Google Sheets.`);
            return { success: true, intent: "updateStage" };
        } catch (error: any) {
            logger.error(`[Home Action] Quick stage update for Quote ID ${quoteId} failed: ${error.stack || error.message}`);
            return { error: "단계 변경 중 오류가 발생했습니다." };
        }
    }

    const quote_type = calcMode === "PPC" ? 0 : (calcMode === "DC" ? 1 : (calcMode === "MARGIN" ? 2 : 3));
    const now = Date.now();

    try {
        logger.info(`[Home Action] Editing Quote ID: ${quoteId}...`);
        // 기존 products_history 조회 및 파싱
        const currentQuote = db.prepare("SELECT products_history FROM quotes WHERE id = ?").get(quoteId) as any;
        let historyList = [];
        if (currentQuote && currentQuote.products_history) {
            try {
                historyList = JSON.parse(currentQuote.products_history);
                if (!Array.isArray(historyList)) {
                    historyList = [];
                }
            } catch (e) {
                historyList = [];
            }
        }

        // 제품 변경 여부 확인 (제품의 모든 속성 변화를 감지)
        const normalizeProductsForComparison = (prods: any): any[] => {
            const list: any[] = [];
            const processItem = (p: any) => ({
                제품코드: p.제품코드 || "",
                제품설명: p.제품설명 || "",
                lpd: Number(p.lpd) || 0,
                lpw: Number(p.lpw) || 0,
                수량: Number(p.수량) || 0,
                기간: Number(p.기간) || 0,
                DC달러: Number(p.DC달러) || 0,
                환율: Number(p.환율) || 0,
                DC원화: Number(p.DC원화) || 0,
                공급가: Number(p.공급가) || 0,
                마진: Number(p.마진) || 0,
                마진율: String(p.마진율 || "0.0"),
                년차: Number(p.년차 !== undefined ? p.년차 : p.year) || 0,
                원화PPC: Number(p.원화PPC) || 0,
                매출월: Number(p.매출월 !== undefined ? p.매출월 : p.month) || 0,
                stage: Number(p.stage) || 0,
            });

            if (Array.isArray(prods)) {
                prods.forEach((p: any) => list.push(processItem(p)));
            } else if (typeof prods === "object" && prods !== null) {
                const sortedKeys = Object.keys(prods).sort();
                for (const key of sortedKeys) {
                    const groupProds = prods[key];
                    if (Array.isArray(groupProds)) {
                        groupProds.forEach((p: any) => {
                            list.push({
                                groupName: key,
                                ...processItem(p),
                            });
                        });
                    }
                }
            }
            return list;
        };

        let productsChanged = true;
        if (historyList.length > 0) {
            const lastEntry = historyList[historyList.length - 1];
            const lastTimestamp = Object.keys(lastEntry)[0];
            const lastProducts = lastEntry[lastTimestamp];
            const prevNormalized = normalizeProductsForComparison(lastProducts);
            const newNormalized = normalizeProductsForComparison(products);
            productsChanged = JSON.stringify(prevNormalized) !== JSON.stringify(newNormalized);
        }

        // 제품 변경이 있을 때만 이력 추가
        if (productsChanged) {
            historyList.push({ [now]: products });
        }
        const products_history = JSON.stringify(historyList);

        // [구글 시트 연동] DB 수정 전 기존 디폴트 그룹의 라인 ID와 연동 상태를 선조회 백업합니다.
        const currentQuoteRow = db.prepare("SELECT sync_to_gas, gas_note FROM quotes WHERE id = ?").get(Number(quoteId)) as { sync_to_gas: number; gas_note?: string } | undefined;
        const priorSyncToGas = currentQuoteRow ? currentQuoteRow.sync_to_gas : 1;
        const nextSyncToGas = syncToGas !== undefined ? (syncToGas ? 1 : 0) : 1;

        const oldLines = db.prepare(`
            SELECT ql.id 
            FROM quote_lines ql
            JOIN quote_groups qg ON ql.group_id = qg.id
            WHERE qg.quote_id = ? AND qg."default" = 1
        `).all(Number(quoteId)) as Array<{ id: number }>;

        // 구글 시트에 새로 추가하기 위해 임시 수집할 대상을 담는 배열
        const defaultLinesToSync: Array<{
            id: number;
            년차: number;
            매출월: number;
            stage: number;
            공급가: number;
            마진: number;
            lpd: number;
            수량: number;
            기간: number;
            DC달러: number;
        }> = [];

        const gasNoteVal = gasNote !== undefined ? String(gasNote).trim() : (currentQuoteRow?.gas_note || "");

        db.transaction(() => {
            const stmt = db.prepare(`
                UPDATE quotes 
                SET quote_type = ?, note = ?, project_name = ?, is_ordered = ?, is_lost = ?, updated_at = ?, products_history = ?, stage = ?, sync_to_gas = ?, gas_note = ?,
                    payment_condition = COALESCE(?, payment_condition),
                    billing_condition = COALESCE(?, billing_condition),
                    quote_number = COALESCE(?, quote_number),
                    po_number = COALESCE(?, po_number)
                WHERE id = ? AND updated_at = ?
            `);
            const info = stmt.run(
                quote_type,
                JSON.stringify(notes),
                projectName,
                isOrdered,
                isLost,
                now,
                products_history,
                stage !== undefined && stage !== null ? Number(stage) : 10,
                nextSyncToGas,
                gasNoteVal,
                paymentConditionNum,
                billingConditionNum,
                quoteNumberStr,
                poNumberStr,
                quoteId,
                originalUpdatedAt,
            );

            if (info.changes === 0) {
                throw new Error("CONCURRENCY_ERROR");
            }

            // 기존 그룹 삭제 (ON DELETE CASCADE로 lines 자동 삭제됨)
            db.prepare("DELETE FROM quote_groups WHERE quote_id = ?").run(Number(quoteId));

            const insertGroup = db.prepare(`
                INSERT INTO quote_groups (quote_id, name, uuid, "default") 
                VALUES (?, ?, ?, ?)
            `);

            const insertLine = db.prepare(`
                INSERT INTO quote_lines (
                    group_id, line_number, product_id, description, lpd, lpw, 
                    quantity, period, dc_usd, exchange_rate, dc_krw, 
                    supply_price, margin, margin_rate, year, krw_ppc,
                    month, stage, usd_ppc, netdollar
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const selectProduct = db.prepare("SELECT id FROM products WHERE code = ?");

            const groups = Array.isArray(products) ? { "원가표1": products } : products;

            for (const [groupName, prods] of Object.entries(groups)) {
                if (!Array.isArray(prods)) continue;

                const groupUuid = crypto.randomUUID();
                const isDefault = groupName === defaultGroup ? 1 : 0;
                const groupInfo = insertGroup.run(Number(quoteId), groupName, groupUuid, isDefault);
                const groupId = groupInfo.lastInsertRowid;

                prods.forEach((line: any, index: number) => {
                    const productCode = line.제품코드;
                    const productRow = selectProduct.get(productCode) as { id: number } | undefined;
                    const productId = productRow ? productRow.id : null;

                    const lpdVal = Number(line.lpd) || 0;
                    const qtyVal = Number(line.수량) || 1;
                    const periodVal = Number(line.기간) || 1;
                    const dcUsdVal = Number(line.DC달러) || 0;
                    const usdPpcVal = Number(line.달러PPC !== undefined ? line.달러PPC : (lpdVal * (1 - dcUsdVal / 100))) || 0;
                    const usdTotalVal = Number(line.달러net !== undefined ? line.달러net : (usdPpcVal * qtyVal * periodVal)) || 0;

                    const lineInfo = insertLine.run(
                        groupId,
                        index + 1,
                        productId,
                        line.제품설명 || "",
                        lpdVal,
                        Number(line.lpw) || 0,
                        qtyVal,
                        periodVal,
                        dcUsdVal,
                        Number(line.환율) || 0,
                        Number(line.DC원화) || 0,
                        Number(line.공급가) || 0,
                        Number(line.마진) || 0,
                        parseFloat(line.마진율) || 0,
                        Number(line.년차) || 1,
                        Number(line.원화PPC) || 0,
                        Number(line.매출월) || 1,
                        line.stage !== undefined && line.stage !== null && line.stage !== "" ? Number(line.stage) : 10,
                        usdPpcVal,
                        usdTotalVal
                    );

                    // 기본 그룹일 경우 구글 시트 동기화 대상에 수집
                    if (isDefault) {
                        defaultLinesToSync.push({
                            id: Number(lineInfo.lastInsertRowid),
                            년차: Number(line.년차) || 1,
                            매출월: Number(line.매출월) || 1,
                            // 0% 값 누락 방지 가드 탑재 (0.1 = 10%)
                            stage: line.stage !== undefined && line.stage !== null && line.stage !== "" ? (Number(line.stage) / 100) : 0.1,
                            공급가: Number(line.공급가) || 0,
                            마진: Number(line.마진) || 0,
                            lpd: Number(line.lpd) || 0,
                            수량: Number(line.수량) || 1,
                            기간: Number(line.기간) || 1,
                            DC달러: Number(line.DC달러) || 0,
                            netdollar: Number(line.달러net) || Number(line.netdollar) || 0
                        });
                    }
                });
            }
        })();

        // DB 트랜잭션 커밋 완료 후 구글 스프레드시트 일괄 삭제 & 추가 진행 (상태 전환 매트릭스 적용)
        const deleteIds = oldLines.map(line => line.id);
        let addRows: any[] = [];

        // 동기화가 현재 켜져있거나 켜지는 경우에만 addRows 데이터를 수집합니다.
        if (nextSyncToGas === 1 && defaultLinesToSync.length > 0) {
            // 수정 데이터에는 파트너/AM 정보가 동봉되지 않으므로 DB에서 기존 실시간 메타 정보를 조회합니다.
            const quoteMeta = db.prepare(`
                SELECT client_company, partner_id, partner_contact_id, am_id, dist_contact_id, project_code
                FROM quotes
                WHERE id = ?
            `).get(Number(quoteId)) as {
                client_company: string;
                partner_id: number | null;
                partner_contact_id: number | null;
                am_id: number | null;
                dist_contact_id: number | null;
                project_code: string | null;
            } | undefined;

            const vendorRows = db.prepare(`
                SELECT vendor FROM quote_vendors WHERE quote_id = ?
            `).all(Number(quoteId)) as Array<{ vendor: string }>;
            const quoteVendorCombined = vendorRows.map(r => r.vendor).join(",");

            const basicInfo = {
                partnerId: quoteMeta?.partner_id,
                partnerContactId: quoteMeta?.partner_contact_id,
                amId: quoteMeta?.am_id,
                distContactId: quoteMeta?.dist_contact_id,
                vendor: quoteVendorCombined,
                clientCompany: quoteMeta?.client_company || "",
                projectCode: quoteMeta?.project_code || ""
            };

            const partnerName = db.prepare("SELECT name FROM partners WHERE id = ?").get(Number(basicInfo.partnerId))?.name || "";
            const contactName = db.prepare("SELECT name FROM partner_contacts WHERE id = ?").get(Number(basicInfo.partnerContactId))?.name || "";
            const amName = db.prepare("SELECT name FROM ams WHERE id = ?").get(Number(basicInfo.amId))?.name || "";
            const distName = db.prepare("SELECT name FROM dist_contacts WHERE id = ?").get(Number(basicInfo.distContactId))?.name || "";

            addRows = defaultLinesToSync.map((line) => {
                return {
                    id: line.id,
                    year: line.년차,
                    month: line.매출월,
                    vendor: basicInfo.vendor || "",
                    dist: distName,
                    am: amName,
                    partner: partnerName,
                    contact: contactName,
                    account: basicInfo.clientCompany || "",
                    projectCode: basicInfo.projectCode || "",
                    stage: line.stage,
                    price: line.공급가,
                    margin: line.마진,
                    netdollar: line.netdollar,
                    note: gasNoteVal
                };
            });
        }

        // 상태 전환 매트릭스에 따른 분기 전송
        if (priorSyncToGas === 1 && nextSyncToGas === 0) {
            // 1 ➡️ 0: 구글 시트에서 기존 데이터 삭제만 수행
            if (deleteIds.length > 0) {
                await sendGasBatchRequest({ deleteIds });
            }
        } else if (priorSyncToGas === 0 && nextSyncToGas === 1) {
            // 0 ➡️ 1: 구글 시트에 신규 데이터 일괄 추가만 수행
            if (addRows.length > 0) {
                await sendGasBatchRequest({ addRows });
            }
        } else if (priorSyncToGas === 1 && nextSyncToGas === 1) {
            // 1 ➡️ 1: 기존 삭제 후 새 데이터 일괄 기입
            if (deleteIds.length > 0 || addRows.length > 0) {
                await sendGasBatchRequest({ deleteIds, addRows });
            }
        }
        // 0 ➡️ 0: 구글 시트 전송 생략 (Bypass 유지)

        logger.info(`[Home Action] Quote ID ${quoteId} edited and synced to Google Sheets successfully.`);
        return { success: true, intent: "edit" };
    } catch (error: any) {
        if (error.message === "CONCURRENCY_ERROR") {
            logger.warn(`[Home Action] Concurrency conflict on Quote ID ${quoteId} update. Blocked.`);
            return {
                error: "다른 사용자가 방금 이 견적을 수정했거나 삭제했습니다. 덮어쓰기를 방지하기 위해 저장이 취소되었습니다. 새로고침 후 다시 시도해주세요.",
            };
        }
        logger.error(`[Home Action] Quote ID ${quoteId} edit failed: ${error.stack || error.message}`);
        return { error: "업데이트 중 오류가 발생했습니다." };
    }
}

// 모든 견적의 제품 데이터를 한 번의 배치 쿼리로 조회하는 함수 (N+1 최적화)
function getAllQuoteProducts(quoteIds: number[]): Record<number, Record<string, any[]>> {
    if (quoteIds.length === 0) return {};

    const placeholders = quoteIds.map(() => "?").join(",");

    // 1. 한 번의 쿼리로 모든 그룹 조회
    const groups = db.prepare(`
        SELECT id, quote_id, name, "default" 
        FROM quote_groups 
        WHERE quote_id IN (${placeholders})
    `).all(...quoteIds) as any[];

    if (groups.length === 0) {
        const empty: Record<number, Record<string, any[]>> = {};
        quoteIds.forEach(id => { empty[id] = {}; });
        return empty;
    }

    const groupIds = groups.map((g: any) => g.id);
    const groupPlaceholders = groupIds.map(() => "?").join(",");

    // 2. 한 번의 쿼리로 모든 라인 조회
    const lines = db.prepare(`
        SELECT 
            l.id as line_id,
            l.group_id,
            l.line_number,
            p.code as 제품코드,
            p.id as product_id,
            l.description as 제품설명,
            l.lpd,
            l.lpw,
            l.quantity as 수량,
            l.period as 기간,
            l.dc_usd as DC달러,
            l.exchange_rate as 환율,
            l.dc_krw as DC원화,
            l.supply_price as 공급가,
            l.margin as 마진,
            l.margin_rate as 마진율,
            l.year as 년차,
            l.krw_ppc as 원화PPC,
            l.month as 매출월,
            l.stage,
            COALESCE(l.usd_ppc, (l.lpd * (1 - COALESCE(l.dc_usd, 0) / 100))) as 달러PPC,
            COALESCE(l.netdollar, (COALESCE(l.usd_ppc, l.lpd * (1 - COALESCE(l.dc_usd, 0) / 100)) * l.quantity * l.period)) as 달러net
        FROM quote_lines l
        LEFT JOIN products p ON l.product_id = p.id
        WHERE l.group_id IN (${groupPlaceholders})
        ORDER BY l.line_number ASC
    `).all(...groupIds) as any[];

    // 3. 그룹 ID -> 그룹 데이터 매핑
    const groupMap = new Map<number, { quote_id: number; name: string; default: number }>();
    groups.forEach((g: any) => groupMap.set(g.id, g));

    // 4. 그룹 ID -> 라인 목록 매핑
    const linesByGroup = new Map<number, any[]>();
    lines.forEach((line: any) => {
        if (!linesByGroup.has(line.group_id)) {
            linesByGroup.set(line.group_id, []);
        }
        linesByGroup.get(line.group_id)!.push(line);
    });

    // 5. 견적 ID -> { "그룹명": [...라인] } 구조로 조립
    const result: Record<number, Record<string, any[]>> = {};
    quoteIds.forEach(id => { result[id] = {}; });

    groups.forEach((group: any) => {
        const groupLines = linesByGroup.get(group.id) || [];
        const linesWithDefault = groupLines.map((line: any) => ({
            ...line,
            group_default: group.default
        }));
        result[group.quote_id][group.name] = linesWithDefault;
    });

    return result;
}

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = 10; // 한 페이지당 노출할 개수
    const offset = (page - 1) * pageSize;

    const sortKey = url.searchParams.get("sortKey") || "updated_at";
    const sortDir = url.searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

    // 1. URL 파라미터를 기반으로 검색(WHERE) 조건 동적 생성
    const conditions: string[] = [];
    const params: any[] = [];

    const addSearch = (key: string, dbCol: string) => {
        const val = url.searchParams.get(key);
        if (val) {
            conditions.push(`${dbCol} LIKE ?`);
            params.push(`%${val}%`);
        }
    };

    addSearch("client_company", "q.client_company");
    addSearch("partner_company", "p.name");
    addSearch("partner_contact_name", "pc.name");
    addSearch("project_name", "q.project_name");
    addSearch("dist_contact_name", "dc.name");
    addSearch("am_name", "a.name");

    // 1. 상태 필터 (통합: all | ordered | pending | lost) 기본값: 진행중(pending)
    const status = url.searchParams.get("status") || "pending";
    if (status === "ordered") {
        conditions.push("q.is_ordered = 1");
    } else if (status === "pending") {
        conditions.push("q.is_ordered = 0 AND q.is_lost = 0");
    } else if (status === "lost") {
        conditions.push("q.is_lost = 1");
    }

    // 2. 날짜 필터 (마지막 수정날짜 updated_at 기준, 시작년월 ~ 끝년월)
    // 기본값: 한국시간(Asia/Seoul) 저번달 1일 ~ 현재달 말일
    const nowKst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const curYearKst = nowKst.getFullYear();
    const curMonthKst = nowKst.getMonth() + 1;

    const prevDateKst = new Date(curYearKst, nowKst.getMonth() - 1, 1);
    const defaultStartYear = prevDateKst.getFullYear();
    const defaultStartMonth = prevDateKst.getMonth() + 1;
    const defaultEndYear = curYearKst;
    const defaultEndMonth = curMonthKst;

    const startYear = parseInt(url.searchParams.get("startYear") || String(defaultStartYear), 10);
    const startMonth = parseInt(url.searchParams.get("startMonth") || String(defaultStartMonth), 10);
    const endYear = parseInt(url.searchParams.get("endYear") || String(defaultEndYear), 10);
    const endMonth = parseInt(url.searchParams.get("endMonth") || String(defaultEndMonth), 10);

    const startDateObj = new Date(`${startYear}-${String(startMonth).padStart(2, "0")}-01T00:00:00+09:00`);
    const startTimestamp = startDateObj.getTime();

    const lastDayOfEndMonth = new Date(endYear, endMonth, 0).getDate();
    const endDateObj = new Date(`${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDayOfEndMonth).padStart(2, "0")}T23:59:59.999+09:00`);
    const endTimestamp = endDateObj.getTime();

    conditions.push("q.updated_at >= ? AND q.updated_at <= ?");
    params.push(startTimestamp, endTimestamp);

    const vendor = url.searchParams.get("vendor");
    if (vendor === "none") {
        conditions.push("1 = 0");
    } else if (vendor) {
        const selected = vendor.split(",");
        if (selected.length > 0) {
            const placeholders = selected.map(() => "?").join(",");
            conditions.push(`q.id IN (SELECT quote_id FROM quote_vendors WHERE vendor IN (${placeholders}))`);
            selected.forEach(v => params.push(v));
        }
    }

    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // 2. 전체 데이터 개수(Total) 조회 및 페이지 수 계산
    const countStmt = db.prepare(`
        SELECT COUNT(*) as total
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN ams a ON q.am_id = a.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        ${whereClause}
    `);
    const { total } = countStmt.get(...params) as { total: number };
    const totalPages = Math.ceil(total / pageSize) || 1;

    // 3. 정렬 컬럼 매핑
    const sortMap: Record<string, string> = {
        client_company: "q.client_company",
        partner_company: "p.name",
        partner_contact_name: "pc.name",
        dist_contact_name: "dc.name",
        am_name: "a.name",
        project_name: "q.project_name",
        stage: "q.stage",
        total_supply_price: "total_supply_price",
        created_at: "q.created_at",
        updated_at: "q.updated_at",
    };
    const dbSortKey = sortMap[sortKey] || "q.updated_at";

    // 4. 페이지네이션이 적용된 실제 데이터 가져오기 (공급가 합계를 서브쿼리로 효율적 처리)
    const stmt = db.prepare(`
        SELECT 
            q.id,
            q.client_company,
            p.name as partner_company,
            pc.name as partner_contact_name,
            dc.name as dist_contact_name,
            q.project_name,
            q.created_at,
            q.updated_at,
            q.stage,
            q.note,
            q.gas_note,
            a.name as am_name,
            q.quote_type,
            q.is_ordered,
            q.is_lost,
            q.sync_to_gas,
            q.payment_condition,
            q.billing_condition,
            q.quote_number,
            q.po_number,
            q.project_code,
            (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = q.id) as vendor,
            (SELECT IFNULL(SUM(l.supply_price), 0)
             FROM quote_groups g
             JOIN quote_lines l ON g.id = l.group_id
             WHERE g.quote_id = q.id AND g."default" = 1) as total_supply_price
        FROM quotes q
        LEFT JOIN partners p ON q.partner_id = p.id
        LEFT JOIN partner_contacts pc ON q.partner_contact_id = pc.id
        LEFT JOIN ams a ON q.am_id = a.id
        LEFT JOIN dist_contacts dc ON q.dist_contact_id = dc.id
        ${whereClause}
        ORDER BY ${dbSortKey} ${sortDir}
        LIMIT ? OFFSET ?
    `);

    const rawQuotes = stmt.all(...params, pageSize, offset) as any[];

    // 배치 쿼리로 모든 견적의 제품 데이터를 한 번에 조회 (N+1 최적화)
    const quoteIds = rawQuotes.map((row: any) => row.id);
    const allProducts = getAllQuoteProducts(quoteIds);

    // 화면에 보여주기 좋게 데이터를 가공합니다.
    const quotes = rawQuotes.map((row) => {
        let noteList = [];

        // 배치로 조회된 제품 데이터 사용
        const productsObj = allProducts[row.id] || {};

        // 비고 데이터를 JSON 배열로 파싱합니다.
        try {
            noteList = JSON.parse(row.note || "[]");
        } catch (e) {
            console.error("비고 JSON 파싱 실패:", e);
        }

        return {
            id: row.id,
            client_company: row.client_company,
            partner_company: row.partner_company,
            partner_contact_name: row.partner_contact_name,
            dist_contact_name: row.dist_contact_name,
            project_name: row.project_name,
            stage: row.stage,
            totalSupplyPrice: row.total_supply_price, // SQL에서 계산된 공급가
            productsList: productsObj, // 배치로 조회된 제품 목록
            noteList,
            gas_note: row.gas_note,
            am_name: row.am_name,
            quote_type: row.quote_type, // PPC(0) or DC/MARGIN(1)
            is_ordered: row.is_ordered,
            is_lost: row.is_lost,
            sync_to_gas: row.sync_to_gas,
            payment_condition: row.payment_condition,
            billing_condition: row.billing_condition,
            quote_number: row.quote_number,
            po_number: row.po_number,
            project_code: row.project_code,
            vendor: row.vendor,
            created_at: row.created_at,
            createdAtDate: new Date(row.created_at).toLocaleDateString("ko-KR"),
            updated_at: row.updated_at,
            updatedAtDate: new Date(row.updated_at).toLocaleDateString("ko-KR"),
        };
    });

    // 제품 자동완성 및 정보 불러오기를 위한 마스터 데이터
    const productsStmt = db.prepare(
        "SELECT id, code, description, lpd, lpw, vendor, available FROM products",
    );
    const masterProducts = productsStmt.all();

    // 가장 최신 환율 정보 조회
    const lastRateRow = db.prepare("SELECT rate FROM exchange_rate ORDER BY timestamp DESC LIMIT 1").get() as { rate: number } | undefined;
    const defaultExchangeRate = lastRateRow ? lastRateRow.rate : 0;

    return {
        quotes,
        masterProducts,
        pagination: { page, totalPages, total },
        defaultExchangeRate,
        filterDefaults: {
            startYear,
            startMonth,
            endYear,
            endMonth,
            status,
        },
    };
}

interface GroupNameInputProps {
    value: string;
    onRename: (newName: string) => void;
}

function GroupNameInput({ value, onRename }: GroupNameInputProps) {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    return (
        <input
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => {
                if (localValue.trim() && localValue.trim() !== value) {
                    onRename(localValue.trim());
                } else {
                    setLocalValue(value);
                }
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.currentTarget.blur();
                }
            }}
            className="font-bold text-gray-800 dark:text-gray-200 text-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            placeholder="그룹 이름"
        />
    );
}

export default function Home({ loaderData }: Route.ComponentProps) {
    const { defaultExchangeRate, filterDefaults } = loaderData;
    const fetcher = useFetcher();
    const [searchParams, setSearchParams] = useSearchParams();

    // 펼쳐진 행(Row) 상태 관리
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    // 편집 모드 상태 관리 (quoting.tsx 로직 통일)
    const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
    const [editProducts, setEditProducts] = useState<Record<string, any[]>>({});
    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN" | "MANUAL">("DC");
    const [editNotes, setEditNotes] = useState<string[]>([]);
    const [editGasNote, setEditGasNote] = useState<string>("");
    const [editProjectName, setEditProjectName] = useState<string>("");
    const [editIsOrdered, setEditIsOrdered] = useState<number>(0);
    const [editIsLost, setEditIsLost] = useState<number>(0);
    const [editStage, setEditStage] = useState<number>(10);
    const [editOriginalUpdatedAt, setEditOriginalUpdatedAt] = useState<
        number | null
    >(null);
    const [editDefaultGroup, setEditDefaultGroup] = useState<string>("");
    const [editSyncToGas, setEditSyncToGas] = useState<boolean>(true);

    // 전체 단계와 제품라인 일괄 수정 동기화를 위한 변수 및 함수
    const prevStageValRef = useRef<number>(10);
    const updateAllProductsStage = (newStage: number) => {
        let hasHigher = false;
        for (const [groupName, prods] of Object.entries(editProducts)) {
            if (Array.isArray(prods)) {
                for (const p of prods) {
                    const pStage = p.stage !== undefined ? p.stage : 10;
                    if (pStage > newStage) {
                        hasHigher = true;
                        break;
                    }
                }
            }
            if (hasHigher) break;
        }

        if (hasHigher) {
            const confirmChange = window.confirm(
                "단계가 낮아지는 매출년도가 있습니다. 일괄 수정을 진행하시겠습니까?"
            );
            if (!confirmChange) {
                return false;
            }
        }

        setEditProducts((prev) => {
            const next = { ...prev };
            for (const groupName of Object.keys(next)) {
                const prods = next[groupName];
                if (Array.isArray(prods)) {
                    next[groupName] = prods.map((p) => ({
                        ...p,
                        stage: newStage,
                    }));
                }
            }
            return next;
        });
        return true;
    };

    // 사이드바 필터 옵션을 위한 연도, 월 데이터 생성
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) =>
        (currentYear - i).toString(),
    );
    const months = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

    // 트렌디한 Toast 알림을 위한 상태 관리
    const [toast, setToast] = useState<{
        message: string;
        type: "error" | "success";
    } | null>(null);

    // Toast 알림이 3초 뒤에 자동으로 사라지도록 처리 (단, info 타입의 진행 중 상태일 때는 제외)
    useEffect(() => {
        if (toast && toast.type !== "info") {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // 제출 진행 중 모달의 시각적 0.5초 완료 지연(Visual Buffer Delay) 상태
    const [isSubmittingModal, setIsSubmittingModal] = useState<boolean>(false);
    const [isModalDone, setIsModalDone] = useState<boolean>(false);

    useEffect(() => {
        if (fetcher.state === "submitting") {
            setIsSubmittingModal(true);
            setIsModalDone(false);
        } else if (fetcher.state === "idle" && fetcher.data && isSubmittingModal) {
            setIsModalDone(true);
            const timer = setTimeout(() => {
                setIsSubmittingModal(false);
                setIsModalDone(false);
            }, 500); // 0.5초 시각적 딜레이를 두어 완료 상태를 눈으로 편안히 확인하도록 함
            return () => clearTimeout(timer);
        }
    }, [fetcher.state, fetcher.data]);

    // 서버 요청 완료 후 에러가 있으면 경고를, 성공했으면 편집 창을 닫도록 처리합니다.
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.error) {
                setToast({ message: fetcher.data.error, type: "error" });
            } else if (fetcher.data.success) {
                if (fetcher.data.intent === "edit") {
                    setToast({
                        message: "성공적으로 저장되었습니다.",
                        type: "success",
                    });
                    setEditingQuoteId(null);
                    setEditOriginalUpdatedAt(null);
                } else if (fetcher.data.intent === "delete") {
                    setToast({
                        message: "성공적으로 삭제되었습니다.",
                        type: "success",
                    });
                } else if (fetcher.data.intent === "updateStage") {
                    setToast({
                        message: "영업 단계가 변경되었습니다.",
                        type: "success",
                    });
                }
            }
        }
    }, [fetcher.state, fetcher.data]);

    // 견적 수정 시작
    const handleEditClick = (quote: any) => {
        if (editingQuoteId !== null && editingQuoteId !== quote.id) {
            if (
                !window.confirm(
                    "수정 중인 내용이 저장되지 않았습니다. 무시하고 다른 견적을 수정하시겠습니까?",
                )
            ) {
                return;
            }
        }
        setEditingQuoteId(quote.id);
        const initialProducts = Array.isArray(quote.productsList)
            ? { "원가표1": quote.productsList }
            : quote.productsList;
        setEditProducts(JSON.parse(JSON.stringify(initialProducts))); // 깊은 복사
        setCalcMode(quote.quote_type === 0 ? "PPC" : "DC");
        setEditNotes(JSON.parse(JSON.stringify(quote.noteList)));
        setEditGasNote(quote.gas_note || "");
        setEditProjectName(quote.project_name || "");
        setEditIsOrdered(quote.is_ordered || 0);
        setEditIsLost(quote.is_lost || 0);
        setEditStage(quote.stage !== undefined && quote.stage !== null ? quote.stage : 10);
        setEditOriginalUpdatedAt(quote.updated_at);

        // Find initial default group
        let initialDefault = "";
        for (const [groupName, prods] of Object.entries(initialProducts)) {
            if (Array.isArray(prods) && prods.length > 0 && prods[0].group_default === 1) {
                initialDefault = groupName;
                break;
            }
        }
        if (!initialDefault) {
            const keys = Object.keys(initialProducts);
            if (keys.length > 0) initialDefault = keys[0];
        }
        setEditDefaultGroup(initialDefault);
        setEditSyncToGas(quote.sync_to_gas === 1);
    };

    // 견적 수정 취소
    const handleCancelEdit = () => {
        setEditingQuoteId(null);
        setEditProducts({});
        setEditNotes([]);
        setEditGasNote("");
        setEditProjectName("");
        setEditIsOrdered(0);
        setEditIsLost(0);
        setEditStage(10);
        setEditOriginalUpdatedAt(null);
        setEditDefaultGroup("");
        setEditSyncToGas(true);
    };

    // 오더/수금완료 (99%/100%) 모달 상태 관리
    const [orderConfirmModalData, setOrderConfirmModalData] = useState<{
        quoteId: number;
        targetStage: number;
        paymentCondition: number; // 1: 일시납, 2: 분할납부
        billingCondition: number; // 1: 일시납, 2: 분할납부(재견적), 3: 분할납부(환햇징)
        quoteNumber: string;
        poNumber: string;
        lines: Array<{
            id: number;
            년차: number;
            매출월: number;
            제품코드: string;
            달러net: number;
            환율: number;
            공급가: number;
        }>;
        isEditIntent?: boolean;
        editPayload?: any;
    } | null>(null);

    const openOrderConfirmModal = (quote: any, targetStage: number, extraOptions?: { isEditIntent?: boolean; editPayload?: any }) => {
        let productsObj: Record<string, any[]> = quote ? (quote.productsList || {}) : {};

        // 현재 펼쳐진 행에서 편집 중인 상태(editProducts)일 경우
        if ((!productsObj || Object.keys(productsObj).length === 0) && editProducts && Object.keys(editProducts).length > 0) {
            productsObj = editProducts;
        }

        // products 배열 형태 호환 처리
        if ((!productsObj || Object.keys(productsObj).length === 0) && quote && Array.isArray(quote.products)) {
            const grouped: Record<string, any[]> = {};
            quote.products.forEach((p: any) => {
                const gName = p.group_name || "원가표1";
                if (!grouped[gName]) grouped[gName] = [];
                grouped[gName].push(p);
            });
            productsObj = grouped;
        }

        let defaultGroupProds: any[] = [];
        for (const [gName, prods] of Object.entries(productsObj)) {
            if (Array.isArray(prods) && prods.length > 0) {
                if (prods[0].group_default === 1 || prods[0].default === 1) {
                    defaultGroupProds = prods;
                    break;
                }
            }
        }
        if (defaultGroupProds.length === 0 && Object.keys(productsObj).length > 0) {
            const firstKey = Object.keys(productsObj)[0];
            defaultGroupProds = productsObj[firstKey] || [];
        }

        const modalLines = defaultGroupProds.map((p: any) => ({
            id: p.line_id !== undefined ? p.line_id : p.id,
            년차: p.년차 !== undefined ? p.년차 : (p.year || 1),
            매출월: p.매출월 !== undefined ? p.매출월 : (p.month || (new Date().getMonth() + 1)),
            제품코드: p.제품코드 || p.code || "",
            달러net: p.달러net !== undefined ? p.달러net : (p.netdollar || 0),
            환율: p.환율 !== undefined ? p.환율 : (p.exchange_rate || defaultExchangeRate || 0),
            공급가: p.공급가 !== undefined ? p.공급가 : (p.supply_price || 0),
        }));

        const initialPayment = quote ? (quote.payment_condition || 1) : 1;
        const initialBilling = initialPayment === 1 ? 1 : (quote ? (quote.billing_condition || 1) : 1);

        setOrderConfirmModalData({
            quoteId: quote ? quote.id : (extraOptions?.editPayload?.quoteId || 0),
            targetStage,
            paymentCondition: initialPayment,
            billingCondition: initialBilling,
            quoteNumber: quote ? (quote.quote_number || "") : "",
            poNumber: quote ? (quote.po_number || "") : "",
            lines: modalLines,
            isEditIntent: extraOptions?.isEditIntent,
            editPayload: extraOptions?.editPayload,
        });
    };

    // 견적 리스트 단독 단계 변경 (드롭다운 빠른 수정)
    const handleQuickStageChange = (quote: any, nextStage: number) => {
        const currentStage = Number(quote.stage) || 0;

        // 기존 단계가 99 미만이었던 견적이 99% 또는 100%로 새로 진입할 때만 모달 팝업
        if (currentStage < 99 && (nextStage === 99 || nextStage === 100)) {
            openOrderConfirmModal(quote, nextStage);
            return;
        }

        const isOrdered = nextStage === 99 || nextStage === 100 ? 1 : 0;
        const isLost = nextStage === 0 ? 1 : 0;

        fetcher.submit(
            {
                intent: "updateStage",
                quoteId: quote.id,
                stage: nextStage,
                isOrdered,
                isLost
            },
            { method: "post", encType: "application/json" }
        );
    };



    // 견적 수정 저장
    const handleSaveEdit = (quoteId: number) => {
        // [오더 / 실주 상태에 따른 단계 정밀 동기화]
        const targetStage = editStage;
        const targetIsOrdered = (targetStage === 99 || targetStage === 100) ? 1 : 0;
        const targetIsLost = targetStage === 0 ? 1 : 0;

        // editStage 상태 동기화 및 제품 라인 일괄 단계 보정
        let updatedProducts = { ...editProducts };
        const newEditProducts = {};
        for (const [groupName, prods] of Object.entries(editProducts)) {
            if (Array.isArray(prods)) {
                newEditProducts[groupName] = prods.map((p) => ({
                    ...p,
                    stage: targetStage,
                }));
            } else {
                newEditProducts[groupName] = prods;
            }
        }
        updatedProducts = newEditProducts;

        // [적합성 검사]
        if (!editProjectName.trim()) {
            setToast({ message: "사업명을 입력해주세요.", type: "error" });
            return;
        }

        // [제품 목록 적합성 검사]
        let hasProduct = false;
        for (const [groupName, prods] of Object.entries(updatedProducts)) {
            if (Array.isArray(prods)) {
                if (prods.length > 0) {
                    hasProduct = true;
                }
                for (let i = 0; i < prods.length; i++) {
                    const p = prods[i];
                    if (!p.제품코드) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 제품코드를 선택해주세요.`, type: "error" });
                        return;
                    }
                    if (p.년차 === undefined || p.년차 === null || p.년차 === "" || Number(p.년차) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 매출년(년차)을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.매출월 === undefined || p.매출월 === null || p.매출월 === "" || Number(p.매출월) < 1 || Number(p.매출월) > 12) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 매출월을 1~12 사이로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.수량 === undefined || p.수량 === null || p.수량 === "" || Number(p.수량) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 수량을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    if (p.기간 === undefined || p.기간 === null || p.기간 === "" || Number(p.기간) <= 0) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 기간을 1 이상으로 입력해주세요.`, type: "error" });
                        return;
                    }
                    const stageNum = Number(p.stage);
                    if (p.stage === undefined || p.stage === null || p.stage === "" || isNaN(stageNum) || stageNum < 0 || stageNum > 100) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 영업 단계를 0% ~ 100% 사이로 입력해주세요.`, type: "error" });
                        return;
                    }
                }
            }
        }

        if (!hasProduct) {
            setToast({ message: "최소 한 개 이상의 제품 항목이 필요합니다.", type: "error" });
            return;
        }

        // 저장하기 직전에 화면에 보여지는 실시간 계산값들을 배열에 완전히 덮어씌웁니다.
        const finalProducts = getFinalProducts(updatedProducts, calcMode);

        // 수정 저장 시에도 빈 칸으로 남겨진 비고(Notes)를 깔끔하게 걸러냅니다.
        const finalEditNotes = editNotes
            .map((n) => n.trim())
            .filter((n) => n !== "");

        const editPayload = {
            intent: "edit",
            quoteId,
            products: finalProducts,
            calcMode,
            notes: finalEditNotes,
            gasNote: editGasNote,
            projectName: editProjectName,
            isOrdered: targetIsOrdered,
            isLost: targetIsLost,
            stage: targetStage,
            originalUpdatedAt: editOriginalUpdatedAt,
            defaultGroup: editDefaultGroup,
            syncToGas: editSyncToGas,
        };

        const currentQuote = loaderData.quotes.find((q: any) => q.id === quoteId);
        const currentStage = Number(currentQuote?.stage) || 0;

        // 기존 단계가 99 미만이었던 견적이 99% 또는 100%로 새로 진입할 때만 모달 팝업
        if (currentStage < 99 && (targetStage === 99 || targetStage === 100)) {
            openOrderConfirmModal(currentQuote, targetStage, {
                isEditIntent: true,
                editPayload,
            });
            return;
        }

        fetcher.submit(
            editPayload,
            { method: "post", encType: "application/json" },
        );
    };

    // 견적 삭제 핸들러
    const handleDeleteQuote = (quoteId: number) => {
        if (
            window.confirm(
                "정말로 이 견적 전체를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.",
            )
        ) {
            fetcher.submit(
                { intent: "delete", quoteId },
                { method: "post", encType: "application/json" },
            );
            setEditingQuoteId(null);
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.delete(quoteId);
                return newSet;
            });
        }
    };



    // 그룹 이름 수정 핸들러
    const handleRenameGroup = (oldName: string, newName: string) => {
        if (!newName.trim()) {
            alert("그룹 이름을 입력해주세요.");
            return;
        }
        if (oldName === newName) return;
        setEditProducts((prev) => {
            const keys = Object.keys(prev);
            if (keys.includes(newName)) {
                alert("이미 존재하는 그룹 이름입니다.");
                return prev;
            }
            const next: Record<string, any[]> = {};
            for (const key of keys) {
                if (key === oldName) {
                    next[newName] = prev[oldName];
                } else {
                    next[key] = prev[key];
                }
            }
            return next;
        });
        if (editDefaultGroup === oldName) {
            setEditDefaultGroup(newName);
        }
    };

    // 그룹 추가 핸들러
    const handleAddGroup = () => {
        setEditProducts((prev) => {
            let idx = 1;
            while (`원가표${idx}` in prev) {
                idx++;
            }
            const newGroupName = `원가표${idx}`;
            return {
                ...prev,
                [newGroupName]: [createEmptyProductRow(defaultExchangeRate)],
            };
        });
    };

    // 그룹 삭제 핸들러
    const handleRemoveGroup = (groupName: string) => {
        if (Object.keys(editProducts).length <= 1) {
            alert("최소 하나의 그룹은 유지해야 합니다.");
            return;
        }
        if (window.confirm(`'${groupName}' 그룹을 삭제하시겠습니까?`)) {
            setEditProducts((prev) => {
                const next = { ...prev };
                delete next[groupName];
                return next;
            });
            if (editDefaultGroup === groupName) {
                const remaining = Object.keys(editProducts).filter((k) => k !== groupName);
                if (remaining.length > 0) {
                    setEditDefaultGroup(remaining[0]);
                }
            }
        }
    };

    // quoting.tsx와 동일한 제품 편집 핸들러
    const handleProductChange = (
        groupName: string,
        index: number,
        field: string,
        value: any,
    ) => {
        setEditProducts((prev) => {
            const groupProds = prev[groupName] ? [...prev[groupName]] : [];
            const updatedProduct = { ...groupProds[index], [field]: value };

            if (field === "제품코드") {
                const matched = (loaderData.masterProducts as any[]).find(
                    (p: any) => p.code === value,
                );
                if (matched) {
                    updatedProduct.lpd = matched.lpd || 0;
                    updatedProduct.lpw = matched.lpw || 0;
                    updatedProduct.제품설명 = matched.description || "";
                }
            }

            // 역산 로직 추가 (원화PPC 또는 마진율 변경 시 DC원화 재계산)
            if (field === "원화PPC" || field === "마진율") {
                const targetDcWon = calculateReverseDCWon(field, value, updatedProduct);
                if (targetDcWon !== null) {
                    updatedProduct.DC원화 = targetDcWon;
                }
            }

            groupProds[index] = updatedProduct;
            return {
                ...prev,
                [groupName]: groupProds,
            };
        });
    };

    // quoting.tsx와 동일한 제품 추가 핸들러
    const handleAddProduct = (groupName: string) => {
        setEditProducts((prev) => ({
            ...prev,
            [groupName]: [
                ...(prev[groupName] || []),
                createEmptyProductRow(defaultExchangeRate),
            ],
        }));
    };

    // quoting.tsx와 동일한 제품 삭제 핸들러
    const handleRemoveProduct = (groupName: string, index: number) => {
        setEditProducts((prev) => ({
            ...prev,
            [groupName]: (prev[groupName] || []).filter((_, i) => i !== index),
        }));
    };

    // 서버 사이드 기반의 검색 및 정렬 핸들러
    const handleSort = (key: string) => {
        const currentSortKey = searchParams.get("sortKey") || "updated_at";
        const currentSortDir = searchParams.get("sortDir") || "desc";
        const newParams = new URLSearchParams(searchParams);

        if (currentSortKey === key) {
            newParams.set("sortDir", currentSortDir === "asc" ? "desc" : "asc");
        } else {
            newParams.set("sortKey", key);
            newParams.set("sortDir", "asc");
        }
        newParams.set("page", "1"); // 정렬 시 1페이지로 리셋
        setSearchParams(newParams);
    };

    const handleFilterChange = (key: string, value: string) => {
        let currentVal = searchParams.get(key);
        if (
            currentVal === null &&
            (key === "is_ordered" || key === "is_lost")
        ) {
            currentVal = "0"; // 초기 상태일 때 내부적으로 0으로 간주
        } else if (currentVal === null) {
            currentVal = "";
        }

        if (currentVal === value) return; // 변경사항 없음

        const newParams = new URLSearchParams(searchParams);
        if (value) {
            newParams.set(key, value);
        } else {
            newParams.delete(key);
        }
        newParams.set("page", "1"); // 검색 시 1페이지로 리셋
        setSearchParams(newParams);
    };

    const currentVendorsParam = searchParams.get("vendor");
    const selectedVendors = currentVendorsParam === null
        ? ["Broadcom", "Omnissa"]
        : currentVendorsParam === "none"
            ? []
            : currentVendorsParam.split(",");

    const handleVendorFilterCheckbox = (vendorName: string, checked: boolean) => {
        let nextVendors = [...selectedVendors];
        if (checked) {
            if (!nextVendors.includes(vendorName)) {
                nextVendors.push(vendorName);
            }
        } else {
            nextVendors = nextVendors.filter((v) => v !== vendorName);
        }

        let paramValue = "";
        if (nextVendors.length === 0) {
            paramValue = "none";
        } else if (nextVendors.length === 2) {
            paramValue = "";
        } else {
            paramValue = nextVendors[0];
        }

        handleFilterChange("vendor", paramValue);
    };

    const toggleRow = (id: number) => {
        if (expandedRows.has(id)) {
            // 편집 중인 행을 접을 때 편집 상태도 안전하게 초기화합니다.
            if (editingQuoteId === id) {
                handleCancelEdit();
            }
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.delete(id);
                return newSet;
            });
        } else {
            setExpandedRows((prev) => {
                const newSet = new Set(prev);
                newSet.add(id);
                return newSet;
            });
        }
    };

    // quoting.tsx와 동일한 계산 기준(calcMode) 변경 핸들러
    const handleCalcModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMode = e.target.value as "PPC" | "DC" | "MARGIN" | "MANUAL";
        setEditProducts((prev) => getFinalProducts(prev, calcMode));
        setCalcMode(newMode);
    };

    // 엑셀 출력 버튼 클릭 핸들러
    const handleExportExcel = () => {
        const queryString = searchParams.toString();
        window.location.href = `/api/home/download?${queryString}`;
    };

    // 원가표/견적서 엑셀 다운로드 (개별 견적)
    const downloadFile = async (
        type: string,
        filename: string,
        productsData: any[] | Record<string, any[]>,
        quoteInfo: any,
        projectName: string,
    ) => {
        const response = await fetch(`/api/download?type=${type}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                products: productsData,
                partnerCompany: quoteInfo.partner_company,
                partnerName: quoteInfo.partner_contact_name,
                clientCompany: quoteInfo.client_company,
                projectName: projectName,
            }),
        });

        if (!response.ok) {
            throw new Error(`${filename} 다운로드 실패`);
        }

        const blob = await response.blob();

        // 1. File System Access API (showSaveFilePicker) 지원 브라우저인 경우 '다른 이름으로 저장 창' 노출
        if ("showSaveFilePicker" in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: filename,
                    types: [
                        {
                            description: "Excel Spreadsheet",
                            accept: {
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                            },
                        },
                    ],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (err: any) {
                // 사용자가 창에서 '취소'를 누른 경우 예외 처리
                if (err.name === "AbortError") {
                    console.log(`[Save Canceled] User canceled saving ${filename}`);
                    return;
                }
                console.warn(`[Save Picker Warning] ${err.message}. Falling back to normal download.`);
            }
        }

        // 2. 미지원 브라우저 또는 Fallback 기본 다운로드 방식
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const handleDownloadExcel = async (
        quote: any,
        productsData: any[] | Record<string, any[]>,
        currentProjectName: string,
    ) => {
        const grouped = Array.isArray(productsData)
            ? { "원가표": productsData }
            : productsData;

        const totalProductsCount = Object.values(grouped).reduce((sum, prods) => sum + (prods?.length || 0), 0);
        if (totalProductsCount === 0) {
            alert("다운로드할 제품이 없습니다.");
            return;
        }

        try {
            const now = new Date();
            const kstDateString = new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            }).format(now);
            const [yyyy, mm, dd] = kstDateString.split("-");
            const dateStr = `${yyyy.slice(2)}${mm}${dd}`;

            const prefix = [
                quote.partner_company?.trim(),
                quote.partner_contact_name?.trim(),
                quote.client_company?.trim(),
                currentProjectName?.trim(),
                dateStr,
            ]
                .filter(Boolean)
                .join("-");

            const finalGroupedProducts = getFinalProducts(grouped, quote.quote_type === 0 ? "PPC" : "DC");

            // 1번째 원가표.xlsx 저장 대화창 노출
            await downloadFile(
                "cost",
                `${prefix}-원가표.xlsx`,
                finalGroupedProducts,
                quote,
                currentProjectName,
            );

            // 2번째 견적서.xlsx 저장 대화창 노출
            await downloadFile(
                "quote",
                `${prefix}-견적서.xlsx`,
                finalGroupedProducts,
                quote,
                currentProjectName,
            );
        } catch (error) {
            console.error(error);
            alert("엑셀 다운로드 중 오류가 발생했습니다.");
        }
    };

    const renderTh = (
        label: string,
        columnKey: string,
        options: {
            sortable?: boolean;
            searchable?: boolean;
            className?: string;
        } = {},
    ) => {
        const { sortable = true, searchable = true, className = "" } = options;
        const currentSortKey = searchParams.get("sortKey") || "updated_at";
        const currentSortDir = searchParams.get("sortDir") || "desc";
        const isSorted = currentSortKey === columnKey;
        const filterValue = searchParams.get(columnKey) || "";

        return (
            <th key={columnKey} className={`p-3 align-top ${className}`}>
                <div
                    className={`flex items-center justify-between font-semibold select-none mb-2 ${sortable
                        ? "cursor-pointer group hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        : ""
                        }`}
                    onClick={() => sortable && handleSort(columnKey)}
                >
                    <span>{label}</span>
                    {sortable &&
                        (isSorted ? (
                            <span className="ml-1 text-blue-500 text-right flex items-center">
                                {currentSortDir === "desc" ? (
                                    <ChevronDown className="w-4 h-4" />
                                ) : (
                                    <ChevronUp className="w-4 h-4" />
                                )}
                            </span>
                        ) : (
                            <span className="ml-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-right flex items-center">
                                <ChevronsUpDown className="w-4 h-4" />
                            </span>
                        ))}
                </div>
                {searchable && (
                    <input
                        key={`filter-${columnKey}-${filterValue}`}
                        type="text"
                        defaultValue={filterValue}
                        onBlur={(e) =>
                            handleFilterChange(columnKey, e.target.value)
                        }
                        onKeyDown={(e) => {
                            if (e.key === "Enter")
                                handleFilterChange(
                                    columnKey,
                                    e.currentTarget.value,
                                );
                        }}
                        placeholder={`${label} 검색`}
                        className="w-full text-xs font-normal px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-500"
                    />
                )}
            </th>
        );
    };

    return (
        <div className="p-8 w-full max-w-[1600px] mx-auto">
            <h1 className="text-3xl font-bold mb-6 dark:text-white">
                견적 목록
            </h1>

            {/* 상단 필터 영역 (사이드바 대체) */}
            <div className="mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-6">
                {/* 1. 상태 필터 (통합: 오더완료, 진행중, 실주) */}
                <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center">
                        <Search className="w-4 h-4 mr-1.5 text-gray-500" /> 상태 필터
                    </span>
                    <select
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800 transition-shadow"
                        value={searchParams.get("status") || "pending"}
                        onChange={(e) =>
                            handleFilterChange("status", e.target.value)
                        }
                    >
                        <option value="all">전체 상태</option>
                        <option value="ordered">오더완료</option>
                        <option value="pending">진행중</option>
                        <option value="lost">실주</option>
                    </select>
                </div>

                <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>

                {/* 2. 수정날짜 필터 (시작년/월 ~ 끝년/월 범위 검색) */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center mr-1">
                        <Calendar className="w-4 h-4 mr-1.5 text-gray-500" /> 수정날짜 필터
                    </span>

                    {/* 시작 년/월 */}
                    <select
                        className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchParams.get("startYear") || String(filterDefaults?.startYear || new Date().getFullYear())}
                        onChange={(e) => handleFilterChange("startYear", e.target.value)}
                    >
                        {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                            <option key={y} value={y}>{y}년</option>
                        ))}
                    </select>
                    <select
                        className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchParams.get("startMonth") || String(filterDefaults?.startMonth || 1)}
                        onChange={(e) => handleFilterChange("startMonth", e.target.value)}
                    >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                            <option key={m} value={m}>{m}월</option>
                        ))}
                    </select>

                    <span className="text-gray-400 font-bold text-xs px-0.5">~</span>

                    {/* 끝 년/월 */}
                    <select
                        className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchParams.get("endYear") || String(filterDefaults?.endYear || new Date().getFullYear())}
                        onChange={(e) => handleFilterChange("endYear", e.target.value)}
                    >
                        {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                            <option key={y} value={y}>{y}년</option>
                        ))}
                    </select>
                    <select
                        className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchParams.get("endMonth") || String(filterDefaults?.endMonth || 12)}
                        onChange={(e) => handleFilterChange("endMonth", e.target.value)}
                    >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                            <option key={m} value={m}>{m}월</option>
                        ))}
                    </select>
                </div>

                <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>

                <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex items-center">
                        <Tag className="w-4 h-4 mr-1.5 text-gray-500" /> 벤더 필터
                    </span>
                    <div className="flex gap-4 items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={selectedVendors.includes("Broadcom")}
                                onChange={(e) => handleVendorFilterCheckbox("Broadcom", e.target.checked)}
                                className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Broadcom</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={selectedVendors.includes("Omnissa")}
                                onChange={(e) => handleVendorFilterCheckbox("Omnissa", e.target.checked)}
                                className="w-4 h-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                            />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Omnissa</span>
                        </label>
                    </div>
                </div>

                {/* 출력하기 버튼 (가장 우측으로 밀기 위해 ml-auto 사용) */}
                <div className="ml-auto">
                    <button
                        onClick={handleExportExcel}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2 shadow"
                    >
                        <Download className="w-4 h-4 mr-1.5" /> 출력하기
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="overflow-auto max-h-[calc(100vh-250px)] rounded-t-lg">
                    <table className="w-full text-left border-collapse relative table-fixed">
                        <thead className="sticky top-0 z-20 bg-gray-100 dark:bg-gray-700 shadow-[0_1px_0_0_#e5e7eb] dark:shadow-[0_1px_0_0_#4b5563]">
                            <tr className="text-gray-800 dark:text-gray-200 divide-x divide-gray-200 dark:divide-gray-600">
                                {renderTh("고객사", "client_company", {
                                    className: "w-[12%]",
                                })}
                                {renderTh("사업명", "project_name", {
                                    className: "w-[20%]",
                                })}
                                {renderTh("파트너사", "partner_company", {
                                    className: "w-[12%]",
                                })}
                                {renderTh("담당자", "partner_contact_name", {
                                    className: "w-[10%]",
                                })}
                                {renderTh("총판", "dist_contact_name", {
                                    className: "w-[8%]",
                                })}
                                {renderTh("AM", "am_name", {
                                    className: "w-[9%]",
                                    sortable: true,
                                    searchable: true,
                                })}
                                {renderTh("단계", "stage", {
                                    sortable: true,
                                    searchable: false,
                                    className: "w-[6%] whitespace-nowrap",
                                })}
                                {renderTh("총 공급가", "total_supply_price", {
                                    sortable: true,
                                    searchable: false,
                                    className: "w-[11%] whitespace-nowrap",
                                })}
                                {renderTh("마지막 수정날짜", "updated_at", {
                                    sortable: true,
                                    searchable: false,
                                    className: "w-[12%] whitespace-nowrap",
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {loaderData.quotes.map((quote: any) => (
                                <Fragment key={quote.id}>
                                    <tr
                                        className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300 cursor-pointer divide-x divide-gray-200 dark:divide-gray-700"
                                        onClick={() => toggleRow(quote.id)}
                                    >
                                        <td className="p-4 truncate" title={quote.client_company}>
                                            {quote.client_company}
                                        </td>
                                        <td className="p-4 truncate" title={quote.project_name}>
                                            <div className="flex items-center gap-2">
                                                {quote.sync_to_gas !== 0 ? (
                                                    <FileSpreadsheet
                                                        className="w-4 h-4 flex-shrink-0"
                                                        color="#10b981"
                                                        fill="#10b981"
                                                        fillOpacity={0.15}
                                                        title="구글 스프레드시트 연동 중"
                                                    />
                                                ) : (
                                                    <FileSpreadsheet
                                                        className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0"
                                                        title="구글 스프레드시트 연동 해제됨"
                                                    />
                                                )}
                                                <span className="truncate">{quote.project_name}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 truncate" title={quote.partner_company}>
                                            {quote.partner_company}
                                        </td>
                                        <td className="p-4 truncate" title={quote.partner_contact_name}>
                                            {quote.partner_contact_name}
                                        </td>
                                        <td className="p-4 truncate" title={quote.dist_contact_name}>
                                            {quote.dist_contact_name}
                                        </td>
                                        <td className="p-4 truncate" title={quote.am_name}>
                                            {quote.am_name}
                                        </td>
                                        <td className="p-4 truncate">
                                            {quote.stage !== undefined && quote.stage !== null ? `${quote.stage}%` : "-"}
                                        </td>
                                        <td className="p-4 font-medium truncate">
                                            {quote.totalSupplyPrice.toLocaleString()}원
                                        </td>
                                        <td className="p-4 truncate">
                                            {quote.updatedAtDate}
                                        </td>
                                    </tr>
                                    {/* 펼쳐진 영역 상세 내용 */}
                                    {expandedRows.has(quote.id) && (
                                        <tr className="no-hover bg-blue-50/70 dark:bg-blue-950/40 border-y border-blue-200 dark:border-blue-800/60 shadow-inner">
                                            <td colSpan={9} className="p-6">
                                                <div className="space-y-6">
                                                    {/* 1. 견적 상세 헤더 및 테이블 */}
                                                    <div className="space-y-6">
                                                        <div className="bg-white/95 dark:bg-gray-800/95 p-5 rounded-lg border border-blue-100 dark:border-blue-900/50 shadow-sm">
                                                            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                                                                <div className="flex items-center gap-4 flex-wrap">
                                                                    <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-lg whitespace-nowrap">
                                                                        <Package className="w-5 h-5 mr-2 text-gray-500" />
                                                                        견적 상세
                                                                    </h3>

                                                                    {/* 대표비고 표시/입력 */}
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">대표비고:</span>
                                                                        {editingQuoteId === quote.id ? (
                                                                            <input
                                                                                type="text"
                                                                                value={editGasNote}
                                                                                onChange={(e) => setEditGasNote(e.target.value)}
                                                                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-[300px] md:w-[380px]"
                                                                                placeholder="대표 비고를 입력하세요"
                                                                            />
                                                                        ) : (
                                                                            <span className="text-sm text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 bg-gray-50 dark:bg-gray-700/60 rounded border border-gray-200 dark:border-gray-600 inline-block min-w-[380px] md:min-w-[460px] truncate" title={quote.gas_note || (quote.noteList && quote.noteList[0]) || ""}>
                                                                                {quote.gas_note || (quote.noteList && quote.noteList[0]) || "-"}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {/* 단계 선택/변경 */}
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">단계:</span>
                                                                        <select
                                                                            value={editingQuoteId === quote.id ? editStage : (quote.stage ?? 10)}
                                                                            disabled={fetcher.state === "submitting"}
                                                                            onChange={(e) => {
                                                                                const newVal = Number(e.target.value);
                                                                                if (editingQuoteId === quote.id) {
                                                                                    const prevVal = editStage;
                                                                                    setEditStage(newVal);
                                                                                    const success = updateAllProductsStage(newVal);
                                                                                    if (!success) {
                                                                                        setEditStage(prevVal);
                                                                                    } else {
                                                                                        if (newVal === 99 || newVal === 100) {
                                                                                            setEditIsOrdered(1);
                                                                                            setEditIsLost(0);
                                                                                        } else if (newVal === 0) {
                                                                                            setEditIsLost(1);
                                                                                            setEditIsOrdered(0);
                                                                                        }
                                                                                    }
                                                                                } else {
                                                                                    handleQuickStageChange(quote, newVal);
                                                                                }
                                                                            }}
                                                                            className="bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block px-2.5 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 cursor-pointer disabled:opacity-50 font-semibold"
                                                                        >
                                                                            {[0, 10, 25, 50, 75, 99, 100].map((val) => (
                                                                                <option key={val} value={val}>
                                                                                    {val}%
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-4">
                                                                    {editingQuoteId === quote.id ? (
                                                                        <>
                                                                            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded border border-gray-200 dark:border-gray-600">
                                                                                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 ml-2">
                                                                                    계산 기준:
                                                                                </span>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="PPC"
                                                                                        checked={calcMode === "PPC"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">PPC</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="DC"
                                                                                        checked={calcMode === "DC"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">DC원화</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="MARGIN"
                                                                                        checked={calcMode === "MARGIN"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-gray-700 dark:text-gray-300">마진</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                                                                    <input
                                                                                        type="radio"
                                                                                        name={`calcMode-${quote.id}`}
                                                                                        value="MANUAL"
                                                                                        checked={calcMode === "MANUAL"}
                                                                                        onChange={handleCalcModeChange}
                                                                                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                                                                                    />
                                                                                    <span className="text-sm text-blue-600 dark:text-blue-400 font-semibold">수동</span>
                                                                                </label>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleAddGroup}
                                                                                disabled={fetcher.state === "submitting"}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 h-8 px-3 border border-blue-200 dark:border-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <Plus className="w-4 h-4 mr-1" /> 그룹 추가
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleSaveEdit(quote.id)}
                                                                                disabled={fetcher.state === "submitting"}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-green-600 text-white hover:bg-green-700 h-8 px-3 shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <Save className="w-4 h-4 mr-1.5" /> 저장
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleDeleteQuote(quote.id)}
                                                                                disabled={fetcher.state === "submitting"}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 bg-red-600 text-white hover:bg-red-700 h-8 px-3 shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <Trash2 className="w-4 h-4 mr-1.5" /> 삭제
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={handleCancelEdit}
                                                                                disabled={fetcher.state === "submitting"}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            >
                                                                                <X className="w-4 h-4 mr-1.5" /> 취소
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        <div className="flex gap-2">
                                                                            <Link
                                                                                to={`/history/${quote.id}`}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-blue-600 hover:bg-blue-50 dark:bg-gray-800 dark:text-blue-400 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-3 shadow-sm"
                                                                            >
                                                                                상세보기
                                                                            </Link>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleEditClick(quote)}
                                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 h-8 px-4 shadow-sm"
                                                                            >
                                                                                수정
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {Object.entries(
                                                            editingQuoteId === quote.id
                                                                ? editProducts
                                                                : (Array.isArray(quote.productsList)
                                                                    ? { "원가표1": quote.productsList }
                                                                    : quote.productsList)
                                                        ).map(([groupName, groupProducts]) => {
                                                            const isEditing = editingQuoteId === quote.id;
                                                            // 수정 모드일 때만 getFinalProducts로 실시간 재계산, 조회 모드에서는 DB에 동기화된 원본 값을 그대로 보존하여 표시
                                                            const finalProds = isEditing
                                                                ? (getFinalProducts(groupProducts as any[], calcMode) as any[])
                                                                : (groupProducts as any[]).map((p: any) => ({
                                                                    ...p,
                                                                    공급가: p.공급가 !== undefined ? p.공급가 : (p.supply_price !== undefined ? p.supply_price : 0),
                                                                    마진: p.마진 !== undefined ? p.마진 : (p.margin !== undefined ? p.margin : 0),
                                                                    마진율: p.마진율 !== undefined ? String(p.마진율) : (p.margin_rate !== undefined ? String(p.margin_rate) : (p.supply_price ? ((p.margin / p.supply_price) * 100).toFixed(1) : "0.0")),
                                                                    DC원화: p.DC원화 !== undefined ? p.DC원화 : (p.dc_krw !== undefined ? p.dc_krw : 0),
                                                                    DC달러: p.DC달러 !== undefined ? p.DC달러 : (p.dc_usd !== undefined ? p.dc_usd : 0),
                                                                    달러PPC: p.달러PPC !== undefined ? p.달러PPC : (p.usd_ppc !== undefined ? p.usd_ppc : (Number(p.lpd || 0) * (1 - Number(p.DC달러 || 0) / 100))),
                                                                    달러net: p.달러net !== undefined ? p.달러net : (p.netdollar !== undefined ? p.netdollar : (Number(p.달러PPC !== undefined ? p.달러PPC : (Number(p.lpd || 0) * (1 - Number(p.DC달러 || 0) / 100))) * Number(p.수량 !== undefined ? p.수량 : (p.quantity !== undefined ? p.quantity : 1)) * Number(p.기간 !== undefined ? p.기간 : (p.period !== undefined ? p.period : 1)))),
                                                                    lpd: p.lpd !== undefined ? p.lpd : 0,
                                                                    lpw: p.lpw !== undefined ? p.lpw : 0,
                                                                    수량: p.수량 !== undefined ? p.수량 : (p.quantity !== undefined ? p.quantity : 1),
                                                                    기간: p.기간 !== undefined ? p.기간 : (p.period !== undefined ? p.period : 1),
                                                                    년차: p.년차 !== undefined ? p.년차 : (p.year !== undefined ? p.year : 1),
                                                                    매출월: p.매출월 !== undefined ? p.매출월 : (p.month !== undefined ? p.month : 1),
                                                                }));

                                                            const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                                                            const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                                                            const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                                                            return (
                                                                <div key={groupName} className="bg-white/95 dark:bg-gray-800/95 p-5 rounded-lg border border-blue-100 dark:border-blue-900/50 shadow-sm space-y-4">
                                                                    <div className="flex justify-between items-center border-b dark:border-gray-700/60 pb-3">
                                                                        <div className="flex items-center gap-4 flex-wrap">
                                                                            {isEditing ? (
                                                                                <>
                                                                                    <div className="w-52">
                                                                                        <GroupNameInput value={groupName} onRename={(newName) => handleRenameGroup(groupName, newName)} />
                                                                                    </div>
                                                                                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                                                                        <input
                                                                                            type="radio"
                                                                                            name={`defaultGroupSelection-${quote.id}`}
                                                                                            checked={editDefaultGroup === groupName}
                                                                                            onChange={() => setEditDefaultGroup(groupName)}
                                                                                            className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                                                                                        />
                                                                                        <span className="font-semibold text-gray-700 dark:text-gray-300">기본 원가표</span>
                                                                                    </label>
                                                                                    {editDefaultGroup === groupName && (
                                                                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 px-2.5 py-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors">
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={editSyncToGas}
                                                                                                onChange={(e) => setEditSyncToGas(e.target.checked)}
                                                                                                className="w-3.5 h-3.5 text-green-600 focus:ring-green-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                                            />
                                                                                            <span className="font-semibold text-green-700 dark:text-green-400">구글 스프레드시트 동기화</span>
                                                                                        </label>
                                                                                    )}
                                                                                </>
                                                                            ) : (
                                                                                <div className="flex items-center gap-3">
                                                                                    <h4 className="font-bold text-gray-800 dark:text-gray-200 text-lg flex items-center">
                                                                                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block mr-2" />
                                                                                        {groupName}
                                                                                    </h4>
                                                                                    {(((groupProducts as any[]).length > 0 && ((groupProducts as any[])[0] as any).group_default === 1) || quote.default_group_name === groupName) && (
                                                                                        <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/10 dark:ring-blue-400/20">
                                                                                            기본
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex items-center gap-6">
                                                                            <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-4">
                                                                                <span>공급가 합계: <strong className="text-gray-800 dark:text-gray-200">₩{groupTotalSupply.toLocaleString()}</strong></span>
                                                                                <span>마진 합계: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                                                            </div>
                                                                            {isEditing && (
                                                                                <div className="flex gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleAddProduct(groupName)}
                                                                                        className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                                                                    >
                                                                                        <Plus className="w-3.5 h-3.5 mr-1" /> 제품 추가
                                                                                    </button>
                                                                                    {Object.keys(editProducts).length > 1 && (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => handleRemoveGroup(groupName)}
                                                                                            className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 h-8 px-2.5 border border-red-200 dark:border-red-800/40 rounded"
                                                                                            title="그룹 삭제"
                                                                                        >
                                                                                            <Trash2 className="w-3.5 h-3.5 mr-1" /> 그룹 삭제
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    <ProductTable
                                                                        rawProducts={groupProducts as any[]}
                                                                        finalProducts={finalProds}
                                                                        isEditable={isEditing}
                                                                        calcMode={calcMode}
                                                                        masterProducts={loaderData.masterProducts}
                                                                        onChangeProduct={(idx, field, value) => handleProductChange(groupName, idx, field, value)}
                                                                        onRemoveProduct={(idx) => handleRemoveProduct(groupName, idx)}
                                                                    />
                                                                </div>
                                                            );
                                                        })}

                                                        {/* 엑셀 다운로드 버튼 */}
                                                        <div className="flex justify-end pt-2">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDownloadExcel(
                                                                        quote,
                                                                        editingQuoteId === quote.id
                                                                            ? editProducts
                                                                            : (Array.isArray(quote.productsList)
                                                                                ? { "원가표1": quote.productsList }
                                                                                : quote.productsList),
                                                                        editingQuoteId === quote.id
                                                                            ? editProjectName
                                                                            : quote.project_name,
                                                                    )
                                                                }
                                                                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-white text-green-600 border border-green-600 hover:bg-green-50 dark:bg-gray-800 dark:text-green-400 dark:border-green-500 dark:hover:bg-green-900/30 h-9 px-4 shadow-sm"
                                                            >
                                                                <Download className="w-4 h-4 mr-1.5" />{" "}
                                                                다운로드 (Excel)
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* 페이지네이션 컨트롤러 */}
                <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg border-t dark:border-gray-600">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        총{" "}
                        <span className="font-bold">
                            {loaderData.pagination.total}
                        </span>
                        건
                    </div>
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={() => {
                                const newParams = new URLSearchParams(
                                    searchParams,
                                );
                                newParams.set(
                                    "page",
                                    String(loaderData.pagination.page - 1),
                                );
                                setSearchParams(newParams);
                            }}
                            disabled={loaderData.pagination.page <= 1}
                            className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            이전
                        </button>
                        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                            {loaderData.pagination.page} /{" "}
                            {loaderData.pagination.totalPages}
                        </span>
                        <button
                            onClick={() => {
                                const newParams = new URLSearchParams(
                                    searchParams,
                                );
                                newParams.set(
                                    "page",
                                    String(loaderData.pagination.page + 1),
                                );
                                setSearchParams(newParams);
                            }}
                            disabled={
                                loaderData.pagination.page >=
                                loaderData.pagination.totalPages
                            }
                            className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            다음
                        </button>
                    </div>
                </div>
            </div>

            {/* 전체 화면 시퀀스 진행도 로딩 오버레이 모달 (0.5초 완료 지연 포함) */}
            {isSubmittingModal && (
                <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl flex flex-col items-center text-center space-y-6">
                        {/* 로딩 아이콘 / 완료 아이콘 */}
                        <div className="relative flex items-center justify-center">
                            {isModalDone ? (
                                <div className="w-16 h-16 bg-green-100 dark:bg-green-950/80 rounded-full flex items-center justify-center animate-in zoom-in-50 duration-200">
                                    <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                                </div>
                            ) : (
                                <>
                                    <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-600 rounded-full animate-spin"></div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-8 h-8 bg-blue-600/10 rounded-full animate-ping"></div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 시퀀스 제목 & 안내 메시지 */}
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isModalDone
                                    ? "작업 완료!"
                                    : fetcher.json?.intent === "updateStage"
                                        ? "영업 단계 변경 진행 중"
                                        : fetcher.json?.intent === "delete"
                                            ? "견적 삭제 진행 중"
                                            : "견적 저장 및 동기화 중"}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {isModalDone
                                    ? "성공적으로 처리를 완료하였습니다."
                                    : "데이터베이스 갱신 및 구글 시트 연동을 수행하고 있습니다."}
                            </p>
                        </div>

                        {/* 시퀀스 별 2단계 인디케이터 */}
                        <div className="w-full bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-3 border border-gray-100 dark:border-gray-700/50">
                            <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                    1단계: DB 데이터 저장
                                </span>
                                <span className="text-green-600 dark:text-green-400 font-bold">✓ 완료</span>
                            </div>
                            <div className="flex items-center justify-between text-xs font-semibold">
                                <span className={`flex items-center gap-2 ${editSyncToGas ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"}`}>
                                    <span className={`w-2 h-2 rounded-full ${editSyncToGas ? "bg-blue-500" : "bg-gray-400"}`}></span>
                                    2단계: 구글 스프레드시트 동기화
                                </span>
                                {editSyncToGas ? (
                                    isModalDone ? (
                                        <span className="text-green-600 dark:text-green-400 font-bold">✓ 완료</span>
                                    ) : (
                                        <span className="text-blue-500 font-bold animate-pulse">진행 중...</span>
                                    )
                                ) : (
                                    <span className="text-gray-400 font-medium">(미동기화 스킵)</span>
                                )}
                            </div>
                        </div>

                        {/* 실시간 프로그레스 바 */}
                        <div className="w-full space-y-1.5">
                            <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div className={`h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300 ${isModalDone ? "w-full" : "w-3/4 animate-pulse"}`}></div>
                            </div>
                            <p className="text-xs text-gray-400 text-right">{isModalDone ? "완료 처리 중..." : "잠시만 기다려주세요..."}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 🏆 오더 컨디션 확인 모달 (history.tsx와 100% 동일한 UI/기능 및 기존 데이터 로딩 적용) */}
            {orderConfirmModalData && (
                <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/90">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                                    오더 컨디션 확인
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    선택하신 영업 단계 ({orderConfirmModalData.targetStage}%) 저장을 위한 추가 조건 및 라인 정보를 입력해주세요.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOrderConfirmModalData(null)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl font-bold p-1"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Body */}
                        <div className="px-6 py-5 overflow-y-auto space-y-6 flex-1">
                            {/* 1. 상단 기본 4대 항목 그리드 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                {/* 납부조건 */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                        납부조건
                                    </label>
                                    <select
                                        value={orderConfirmModalData.paymentCondition}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setOrderConfirmModalData((prev) => {
                                                if (!prev) return null;
                                                // 일시납(1) 선택 시 수금조건도 일시납(1)로 고정
                                                const nextBilling = val === 1 ? 1 : prev.billingCondition;
                                                return {
                                                    ...prev,
                                                    paymentCondition: val,
                                                    billingCondition: nextBilling,
                                                };
                                            });
                                        }}
                                        className="w-full text-xs px-3 py-2 border rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                    >
                                        <option value={1}>일시납</option>
                                        <option value={2}>분할납부</option>
                                    </select>
                                </div>

                                {/* 수금조건 */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                        수금조건
                                    </label>
                                    <select
                                        value={orderConfirmModalData.billingCondition}
                                        disabled={orderConfirmModalData.paymentCondition === 1}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setOrderConfirmModalData((prev) => (prev ? { ...prev, billingCondition: val } : null));
                                        }}
                                        className={`w-full text-xs px-3 py-2 border rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none ${
                                            orderConfirmModalData.paymentCondition === 1 ? "opacity-60 cursor-not-allowed bg-gray-100 dark:bg-gray-800" : ""
                                        }`}
                                    >
                                        <option value={1}>일시납</option>
                                        <option value={2}>분할납부(재견적)</option>
                                        <option value={3}>분할납부(환햇징)</option>
                                    </select>
                                </div>

                                {/* Quote# */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                        Quote#
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Quote 번호 입력"
                                        value={orderConfirmModalData.quoteNumber}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setOrderConfirmModalData((prev) => (prev ? { ...prev, quoteNumber: val } : null));
                                        }}
                                        className="w-full text-xs px-3 py-2 border rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>

                                {/* PO# */}
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                        PO#
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="PO 번호 입력"
                                        value={orderConfirmModalData.poNumber}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setOrderConfirmModalData((prev) => (prev ? { ...prev, poNumber: val } : null));
                                        }}
                                        className="w-full text-xs px-3 py-2 border rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* 2. 하단 기본 그룹 라인 수정 테이블 */}
                            <div>
                                <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-2 flex items-center justify-between">
                                    <span>기본 그룹 라인 데이터 수치 확인 및 수정</span>
                                    <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                                        * 제품코드를 제외한 항목 수정 가능 (마진 자동 계산)
                                    </span>
                                </h4>

                                <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-100 dark:bg-gray-700/60 text-gray-700 dark:text-gray-300 font-semibold border-b border-gray-200 dark:border-gray-700">
                                            <tr>
                                                <th className="p-2.5 w-16 text-center">매출년</th>
                                                <th className="p-2.5 w-16 text-center">매출월</th>
                                                <th className="p-2.5 min-w-[120px]">제품코드</th>
                                                <th className="p-2.5 w-24 text-right">달러net ($)</th>
                                                <th className="p-2.5 w-24 text-right">환율 (₩)</th>
                                                <th className="p-2.5 w-32 text-right">공급가 (₩)</th>
                                                <th className="p-2.5 min-w-[140px] text-right">마진</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                                            {orderConfirmModalData.lines.map((line, idx) => {
                                                const netdollarNum = Number(line.달러net) || 0;
                                                const exRateNum = Number(line.환율) || 0;
                                                const supplyPriceNum = Number(line.공급가) || 0;
                                                const calcMargin = supplyPriceNum - (netdollarNum * exRateNum);
                                                const calcMarginRate = supplyPriceNum > 0 ? ((calcMargin / supplyPriceNum) * 100).toFixed(1) : "0.0";

                                                return (
                                                    <tr key={line.id || idx} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                                        {/* 매출년 */}
                                                        <td className="p-1.5">
                                                            <input
                                                                type="number"
                                                                value={line.년차}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    setOrderConfirmModalData((prev) => {
                                                                        if (!prev) return null;
                                                                        const updatedLines = [...prev.lines];
                                                                        updatedLines[idx] = { ...updatedLines[idx], 년차: val };
                                                                        return { ...prev, lines: updatedLines };
                                                                    });
                                                                }}
                                                                className="w-full text-center py-1 px-1.5 border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                                                            />
                                                        </td>
                                                        {/* 매출월 */}
                                                        <td className="p-1.5">
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={12}
                                                                value={line.매출월}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    setOrderConfirmModalData((prev) => {
                                                                        if (!prev) return null;
                                                                        const updatedLines = [...prev.lines];
                                                                        updatedLines[idx] = { ...updatedLines[idx], 매출월: val };
                                                                        return { ...prev, lines: updatedLines };
                                                                    });
                                                                }}
                                                                className="w-full text-center py-1 px-1.5 border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                                                            />
                                                        </td>
                                                        {/* 제품코드 (Readonly) */}
                                                        <td className="p-2.5 font-medium text-gray-800 dark:text-gray-200 truncate max-w-[140px]">
                                                            {line.제품코드 || "-"}
                                                        </td>
                                                        {/* 달러net */}
                                                        <td className="p-1.5">
                                                            <input
                                                                type="number"
                                                                value={line.달러net}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    setOrderConfirmModalData((prev) => {
                                                                        if (!prev) return null;
                                                                        const updatedLines = [...prev.lines];
                                                                        updatedLines[idx] = { ...updatedLines[idx], 달러net: val };
                                                                        return { ...prev, lines: updatedLines };
                                                                    });
                                                                }}
                                                                className="w-full text-right py-1 px-1.5 border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                                                            />
                                                        </td>
                                                        {/* 환율 */}
                                                        <td className="p-1.5">
                                                            <input
                                                                type="number"
                                                                value={line.환율}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    setOrderConfirmModalData((prev) => {
                                                                        if (!prev) return null;
                                                                        const updatedLines = [...prev.lines];
                                                                        updatedLines[idx] = { ...updatedLines[idx], 환율: val };
                                                                        return { ...prev, lines: updatedLines };
                                                                    });
                                                                }}
                                                                className="w-full text-right py-1 px-1.5 border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                                                            />
                                                        </td>
                                                        {/* 공급가 */}
                                                        <td className="p-1.5">
                                                            <input
                                                                type="number"
                                                                value={line.공급가}
                                                                onChange={(e) => {
                                                                    const val = Number(e.target.value);
                                                                    setOrderConfirmModalData((prev) => {
                                                                        if (!prev) return null;
                                                                        const updatedLines = [...prev.lines];
                                                                        updatedLines[idx] = { ...updatedLines[idx], 공급가: val };
                                                                        return { ...prev, lines: updatedLines };
                                                                    });
                                                                }}
                                                                className="w-full text-right py-1 px-1.5 border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs font-semibold text-blue-600 dark:text-blue-400"
                                                            />
                                                        </td>
                                                        {/* 마진 (자동 계산) */}
                                                        <td className="p-2.5 text-right font-medium text-gray-700 dark:text-gray-300">
                                                            <span className={calcMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                                                                ₩{Math.round(calcMargin).toLocaleString()} ({calcMarginRate}%)
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/90 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setOrderConfirmModalData(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (orderConfirmModalData.isEditIntent && orderConfirmModalData.editPayload) {
                                        const payload = {
                                            ...orderConfirmModalData.editPayload,
                                            payment_condition: orderConfirmModalData.paymentCondition,
                                            billing_condition: orderConfirmModalData.billingCondition,
                                            quote_number: orderConfirmModalData.quoteNumber,
                                            po_number: orderConfirmModalData.poNumber,
                                        };

                                        if (payload.products && orderConfirmModalData.lines) {
                                            const linesMap = new Map();
                                            orderConfirmModalData.lines.forEach((l: any) => linesMap.set(Number(l.id), l));

                                            const updatedProductsObj: Record<string, any[]> = {};
                                            for (const [gName, prods] of Object.entries(payload.products)) {
                                                if (Array.isArray(prods)) {
                                                    updatedProductsObj[gName] = prods.map((p: any) => {
                                                        const lineId = p.line_id !== undefined ? p.line_id : p.id;
                                                        const matched = linesMap.get(Number(lineId));
                                                        if (matched) {
                                                            const netdollarNum = Number(matched.달러net || matched.netdollar) || 0;
                                                            const exRateNum = Number(matched.환율 || matched.exchange_rate) || 0;
                                                            const supplyPriceNum = Number(matched.공급가 || matched.supply_price) || 0;
                                                            const yearNum = Number(matched.년차 || matched.year) || 1;
                                                            const monthNum = Number(matched.매출월 || matched.month) || 1;
                                                            const marginNum = supplyPriceNum - (netdollarNum * exRateNum);
                                                            const marginRateNum = supplyPriceNum > 0 ? parseFloat(((marginNum / supplyPriceNum) * 100).toFixed(1)) : 0;

                                                            return {
                                                                ...p,
                                                                년차: yearNum,
                                                                year: yearNum,
                                                                매출월: monthNum,
                                                                month: monthNum,
                                                                달러net: netdollarNum,
                                                                netdollar: netdollarNum,
                                                                환율: exRateNum,
                                                                exchange_rate: exRateNum,
                                                                공급가: supplyPriceNum,
                                                                supply_price: supplyPriceNum,
                                                                마진: marginNum,
                                                                margin: marginNum,
                                                                마진율: marginRateNum,
                                                                margin_rate: marginRateNum,
                                                            };
                                                        }
                                                        return p;
                                                    });
                                                } else {
                                                    updatedProductsObj[gName] = prods as any[];
                                                }
                                            }
                                            payload.products = updatedProductsObj;
                                        }

                                        fetcher.submit(payload, { method: "post", encType: "application/json" });
                                    } else {
                                        fetcher.submit(
                                            {
                                                intent: "updateStage",
                                                quoteId: orderConfirmModalData.quoteId,
                                                stage: orderConfirmModalData.targetStage,
                                                isOrdered: 1,
                                                isLost: 0,
                                                payment_condition: orderConfirmModalData.paymentCondition,
                                                billing_condition: orderConfirmModalData.billingCondition,
                                                quote_number: orderConfirmModalData.quoteNumber,
                                                po_number: orderConfirmModalData.poNumber,
                                                lines: JSON.stringify(orderConfirmModalData.lines),
                                            },
                                            { method: "post", encType: "application/json" }
                                        );
                                    }
                                    setOrderConfirmModalData(null);
                                }}
                                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow transition-colors"
                            >
                                확인 및 완료
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 성공 / 에러 전용 트렌디한 Toast 컴포넌트 (우측 하단) */}
            {toast && toast.type !== "info" && (
                <div
                    className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-lg shadow-xl border ${toast.type === "error"
                        ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200"
                        : "bg-gray-900 border-gray-800 text-white dark:bg-gray-100 dark:border-gray-200 dark:text-gray-900"
                        } transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in`}
                >
                    {toast.type === "error" ? (
                        <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
                    ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-400 dark:text-green-600" />
                    )}
                    <p className="text-sm font-medium">{toast.message}</p>
                </div>
            )}
        </div>
    );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    return (
        <div className="p-4 bg-red-100 text-red-700 border border-red-400 rounded max-w-2xl mx-auto mt-10">
            <h2 className="text-xl font-bold">오류가 발생했습니다!</h2>
            <p>Home 페이지를 처리하는 중 문제가 생겼습니다.</p>
        </div>
    );
}
