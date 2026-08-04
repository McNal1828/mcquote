import { useState, Fragment, useEffect, useRef } from "react";
import { useFetcher, useSearchParams, Link, useNavigate } from "react-router";
import crypto from "crypto";
import db from "../db.server";
import { getFinalProducts, createEmptyProductRow, calculateReverseDCWon } from "~/utils/calculator";
import { sendGasBatchRequest } from "~/utils/gasService";
import ProductTable from "~/components/ProductTable";
import type { Route } from "./+types/history";
import { logger } from "~/utils/logger";
import {
    Calendar,
    History,
    Package,
    Building2,
    Users,
    UserCircle,
    Layers,
    Plus,
    Save,
    Trash2,
    X,
    AlertCircle,
    CheckCircle2,
    FileSpreadsheet,
    Search,
    ChevronDown,
    Download,
    Copy,
} from "lucide-react";

export async function action({ request, params }: Route.ActionArgs) {
    const data = await request.json();
    const {
        intent,
        quoteId,
        products,
        calcMode,
        notes,
        dealFlows,
        projectName,
        originalUpdatedAt,
        defaultGroup,
        stage,
        syncToGas,
        clientCompany,
        clientContactName,
        clientContactEmail,
        clientContactPhone,
        partnerId,
        partnerContactId,
        amId,
        distContactId,
        contractType,
        vendor,
        gasNote,
        payment_condition,
        billing_condition,
        quote_number,
        po_number,
        lines,
    } = data;

    const targetQuoteId = Number(quoteId || params.id);
    const paymentConditionNum = payment_condition !== undefined && payment_condition !== null ? Number(payment_condition) : null;
    const billingConditionNum = billing_condition !== undefined && billing_condition !== null ? Number(billing_condition) : null;
    const quoteNumberStr = quote_number !== undefined && quote_number !== null ? String(quote_number) : null;
    const poNumberStr = po_number !== undefined && po_number !== null ? String(po_number) : null;

    logger.info(`[History Action] Received request: intent=${intent}, quoteId=${targetQuoteId}`);

    if (intent === "delete") {
        try {
            logger.info(`[History Action] Deleting Quote ID: ${targetQuoteId}...`);
            const currentQuote = db.prepare("SELECT sync_to_gas FROM quotes WHERE id = ?").get(targetQuoteId) as { sync_to_gas: number } | undefined;
            const priorSyncToGas = currentQuote ? currentQuote.sync_to_gas : 1;

            const oldLines = db.prepare(`
                SELECT ql.id 
                FROM quote_lines ql
                JOIN quote_groups qg ON ql.group_id = qg.id
                WHERE qg.quote_id = ? AND qg."default" = 1
            `).all(targetQuoteId) as Array<{ id: number }>;

            db.prepare("DELETE FROM quotes WHERE id = ?").run(targetQuoteId);

            if (priorSyncToGas === 1 && oldLines.length > 0) {
                const deleteIds = oldLines.map(line => line.id);
                await sendGasBatchRequest({ deleteIds });
            }

            logger.info(`[History Action] Quote ID ${targetQuoteId} deleted successfully.`);
            return { success: true, intent: "delete" };
        } catch (error: any) {
            logger.error(`[History Action] Delete failed: ${error.stack || error.message}`);
            return { error: "삭제 중 오류가 발생했습니다." };
        }
    }

    const quote_type = calcMode === "PPC" ? 0 : (calcMode === "DC" ? 1 : (calcMode === "MARGIN" ? 2 : 3));
    const now = Date.now();

    // 단계(Stage)에 따른 오더/실주 플래그 자동 재산정 (항상 0으로 초기화 후 단계 기준 재지정)
    const targetStage = Number(stage !== undefined && stage !== null ? stage : 10);
    let isOrdered = 0;
    let isLost = 0;

    if (targetStage === 0) {
        isOrdered = 0;
        isLost = 1; // 실주
    } else if (targetStage === 99 || targetStage === 100) {
        isOrdered = 1; // 오더 완료
        isLost = 0;
    } else {
        isOrdered = 0; // 진행 중
        isLost = 0;
    }

    try {
        logger.info(`[History Action] Editing Quote ID: ${targetQuoteId}...`);
        const currentQuote = db.prepare("SELECT products_history FROM quotes WHERE id = ?").get(targetQuoteId) as any;
        let historyList: any[] = [];
        if (currentQuote && currentQuote.products_history) {
            try {
                historyList = JSON.parse(currentQuote.products_history);
                if (!Array.isArray(historyList)) historyList = [];
            } catch (e) {
                historyList = [];
            }
        }

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
                            list.push({ groupName: key, ...processItem(p) });
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

        if (productsChanged) {
            historyList.push({ [now]: products });
        }
        const products_history = JSON.stringify(historyList);

        const currentQuoteRow = db.prepare("SELECT sync_to_gas, project_code FROM quotes WHERE id = ?").get(targetQuoteId) as { sync_to_gas: number; project_code?: string } | undefined;
        const priorSyncToGas = currentQuoteRow ? currentQuoteRow.sync_to_gas : 1;
        const nextSyncToGas = syncToGas !== undefined ? (syncToGas ? 1 : 0) : 1;

        const oldLines = db.prepare(`
            SELECT ql.id 
            FROM quote_lines ql
            JOIN quote_groups qg ON ql.group_id = qg.id
            WHERE qg.quote_id = ? AND qg."default" = 1
        `).all(targetQuoteId) as Array<{ id: number }>;

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

        const sanitizedDealFlow = Array.isArray(dealFlows) ? dealFlows.map(df => String(df).trim()).filter(Boolean) : [];
        const sanitizedNotes = Array.isArray(notes) ? notes.map(n => String(n).trim()).filter(Boolean) : [];

        db.transaction(() => {
            const stmt = db.prepare(`
                UPDATE quotes 
                SET client_company = ?, client_contact_name = ?, client_contact_email = ?, client_contact_phone = ?,
                    partner_id = ?, partner_contact_id = ?, am_id = ?, dist_contact_id = ?,
                    contract_type = ?, quote_type = ?, note = ?, deal_flow = ?, project_name = ?,
                    is_ordered = ?, is_lost = ?, updated_at = ?, products_history = ?, stage = ?, sync_to_gas = ?, gas_note = ?,
                    payment_condition = COALESCE(?, payment_condition),
                    billing_condition = COALESCE(?, billing_condition),
                    quote_number = COALESCE(?, quote_number),
                    po_number = COALESCE(?, po_number)
                WHERE id = ? AND updated_at = ?
            `);
            const info = stmt.run(
                clientCompany || "",
                clientContactName || "",
                clientContactEmail || "",
                clientContactPhone || "",
                partnerId ? Number(partnerId) : null,
                partnerContactId ? Number(partnerContactId) : null,
                amId ? Number(amId) : null,
                distContactId ? Number(distContactId) : null,
                contractType || "",
                quote_type,
                JSON.stringify(sanitizedNotes),
                JSON.stringify(sanitizedDealFlow),
                projectName,
                isOrdered,
                isLost,
                now,
                products_history,
                targetStage,
                nextSyncToGas,
                gasNote || "",
                paymentConditionNum,
                billingConditionNum,
                quoteNumberStr,
                poNumberStr,
                targetQuoteId,
                originalUpdatedAt
            );

            if (info.changes === 0) {
                throw new Error("CONCURRENCY_ERROR");
            }

            // 만약 모달에서 라인데이터 수동 수정사항(lines)이 함께 넘어온 경우
            let parsedLines: any[] = [];
            if (lines) {
                try {
                    parsedLines = typeof lines === "string" ? JSON.parse(lines) : lines;
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

            // 벤더 단일 저장
            db.prepare("DELETE FROM quote_vendors WHERE quote_id = ?").run(targetQuoteId);
            if (vendor && vendor.trim()) {
                db.prepare("INSERT INTO quote_vendors (quote_id, vendor) VALUES (?, ?)").run(targetQuoteId, vendor.trim());
            }

            // 기존 그룹 삭제 (ON DELETE CASCADE로 lines 자동 삭제됨)
            db.prepare("DELETE FROM quote_groups WHERE quote_id = ?").run(targetQuoteId);

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
            const groups = Array.isArray(products) ? { "일시불": products } : products;

            for (const [groupName, prods] of Object.entries(groups)) {
                if (!Array.isArray(prods)) continue;

                const groupUuid = crypto.randomUUID();
                const isDefault = groupName === defaultGroup ? 1 : 0;
                const groupInfo = insertGroup.run(targetQuoteId, groupName, groupUuid, isDefault);
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
                        line.stage !== undefined && line.stage !== null && line.stage !== "" ? Number(line.stage) : targetStage,
                        usdPpcVal,
                        usdTotalVal
                    );

                    if (isDefault) {
                        defaultLinesToSync.push({
                            id: Number(lineInfo.lastInsertRowid),
                            년차: Number(line.년차) || 1,
                            매출월: Number(line.매출월) || 1,
                            stage: line.stage !== undefined && line.stage !== null && line.stage !== "" ? (Number(line.stage) / 100) : (targetStage / 100),
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

        // 구글 스프레드시트 일괄 배치 전송
        const deleteIds = oldLines.map(line => line.id);
        let addRows: any[] = [];

        if (nextSyncToGas === 1 && defaultLinesToSync.length > 0) {
            const partnerName = partnerId ? (db.prepare("SELECT name FROM partners WHERE id = ?").get(Number(partnerId)) as any)?.name || "" : "";
            const contactName = partnerContactId ? (db.prepare("SELECT name FROM partner_contacts WHERE id = ?").get(Number(partnerContactId)) as any)?.name || "" : "";
            const amName = amId ? (db.prepare("SELECT name FROM ams WHERE id = ?").get(Number(amId)) as any)?.name || "" : "";
            const distName = distContactId ? (db.prepare("SELECT name FROM dist_contacts WHERE id = ?").get(Number(distContactId)) as any)?.name || "" : "";

            const representNote = gasNote || (Array.isArray(sanitizedNotes) && sanitizedNotes.length > 0 ? (sanitizedNotes[0] || "") : "");

            addRows = defaultLinesToSync.map((line) => {
                return {
                    id: line.id,
                    year: line.년차,
                    month: line.매출월,
                    vendor: vendor || "",
                    dist: distName,
                    am: amName,
                    partner: partnerName,
                    contact: contactName,
                    account: clientCompany || "",
                    projectCode: currentQuoteRow?.project_code || "",
                    stage: line.stage,
                    price: line.공급가,
                    margin: line.마진,
                    netdollar: line.netdollar,
                    note: representNote
                };
            });
        }

        if (priorSyncToGas === 1 && nextSyncToGas === 0) {
            if (deleteIds.length > 0) await sendGasBatchRequest({ deleteIds });
        } else if (priorSyncToGas === 0 && nextSyncToGas === 1) {
            if (addRows.length > 0) await sendGasBatchRequest({ addRows });
        } else if (priorSyncToGas === 1 && nextSyncToGas === 1) {
            if (deleteIds.length > 0 || addRows.length > 0) {
                await sendGasBatchRequest({ deleteIds, addRows });
            }
        }

        logger.info(`[History Action] Quote ID ${targetQuoteId} edited successfully.`);
        return { success: true, intent: "edit" };
    } catch (error: any) {
        if (error.message === "CONCURRENCY_ERROR") {
            return { error: "다른 사용자가 방금 이 견적을 수정했거나 삭제했습니다. 새로고침 후 다시 시도해주세요." };
        }
        logger.error(`[History Action] Edit failed: ${error.stack || error.message}`);
        return { error: "업데이트 중 오류가 발생했습니다." };
    }
}

// 그룹 및 제품 라인 일괄 조회
function getQuoteProducts(quoteId: number): Record<string, any[]> {
    const groups = db.prepare('SELECT id, name, "default" FROM quote_groups WHERE quote_id = ?').all(quoteId) as any[];
    if (groups.length === 0) return {};

    const groupIds = groups.map((g) => g.id);
    const placeholders = groupIds.map(() => "?").join(",");

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
        WHERE l.group_id IN (${placeholders})
        ORDER BY l.line_number ASC
    `).all(...groupIds) as any[];

    const linesByGroup = new Map<number, any[]>();
    lines.forEach((line: any) => {
        if (!linesByGroup.has(line.group_id)) linesByGroup.set(line.group_id, []);
        linesByGroup.get(line.group_id)!.push(line);
    });

    const result: Record<string, any[]> = {};
    groups.forEach((group: any) => {
        const groupLines = linesByGroup.get(group.id) || [];
        result[group.name] = groupLines.map((line: any) => ({
            ...line,
            group_default: group.default
        }));
    });

    return result;
}

export async function loader({ params }: Route.LoaderArgs) {
    const id = Number(params.id);
    const quote = db.prepare(`
        SELECT q.*, (SELECT GROUP_CONCAT(vendor, ',') FROM quote_vendors WHERE quote_id = q.id) as vendor 
        FROM quotes q 
        WHERE q.id = ?
    `).get(id) as any;

    if (!quote) {
        throw new Response("견적을 찾을 수 없습니다.", { status: 404 });
    }

    const partnerName = quote.partner_id
        ? (db.prepare("SELECT name FROM partners WHERE id = ?").get(quote.partner_id) as any)?.name
        : "";
    const partnerContactName = quote.partner_contact_id
        ? (db.prepare("SELECT name FROM partner_contacts WHERE id = ?").get(quote.partner_contact_id) as any)?.name
        : "";
    const amName = quote.am_id
        ? (db.prepare("SELECT name FROM ams WHERE id = ?").get(quote.am_id) as any)?.name
        : "";
    const distContactName = quote.dist_contact_id
        ? (db.prepare("SELECT name FROM dist_contacts WHERE id = ?").get(quote.dist_contact_id) as any)?.name
        : "";

    const currentProducts = getQuoteProducts(id);

    // 마스터 메타 데이터 (vendor 포함 조회)
    const partners = db.prepare("SELECT id, name, vendor FROM partners WHERE available = 1 ORDER BY name ASC").all();
    const partnerContacts = db.prepare("SELECT id, partner_id, name, email, phone FROM partner_contacts ORDER BY name ASC").all();
    const ams = db.prepare("SELECT id, name, vendor FROM ams ORDER BY name ASC").all();
    const distContacts = db.prepare("SELECT id, name, position FROM dist_contacts ORDER BY name ASC").all();
    const masterProducts = db.prepare("SELECT id, code, description, lpd, lpw, vendor, available FROM products WHERE available = 1").all();

    const lastRateRow = db.prepare("SELECT rate FROM exchange_rate ORDER BY timestamp DESC LIMIT 1").get() as { rate: number } | undefined;
    const defaultExchangeRate = lastRateRow ? lastRateRow.rate : 0;

    let noteList: string[] = [];
    try {
        noteList = JSON.parse(quote.note || "[]");
        if (!Array.isArray(noteList)) noteList = [];
    } catch (e) {
        noteList = [];
    }

    let dealFlowList: string[] = [];
    try {
        dealFlowList = JSON.parse(quote.deal_flow || "[]");
        if (!Array.isArray(dealFlowList)) dealFlowList = [];
    } catch (e) {
        dealFlowList = [];
    }

    return {
        quote,
        partnerName,
        partnerContactName,
        amName,
        distContactName,
        currentProducts,
        partners,
        partnerContacts,
        ams,
        distContacts,
        masterProducts,
        defaultExchangeRate,
        noteList,
        dealFlowList,
    };
}

interface SearchableSelectProps {
    label?: string;
    options: { id: string | number; label: string; subText?: string }[];
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

function SearchableSelect({ label, options, value, placeholder, onChange, disabled }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const wrapperRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find((opt) => String(opt.id) === String(value));
    const isUnassigned = selectedOption?.label === "미지정" || String(selectedOption?.id) === "none" || String(selectedOption?.id) === "0";

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredOptions = options.filter((opt) =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (opt.subText && opt.subText.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div ref={wrapperRef} className="relative w-full">
            {label && (
                <label className="block text-xs font-medium text-gray-500 mb-1">
                    {label}
                </label>
            )}
            <button
                type="button"
                disabled={disabled}
                onClick={() => {
                    if (!disabled) setIsOpen(!isOpen);
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
                <span className={`truncate ${isUnassigned ? "text-gray-400 dark:text-gray-500" : selectedOption ? "text-gray-900 dark:text-white font-medium" : "text-gray-400 dark:text-gray-500"}`}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 flex items-center gap-2 z-10">
                        <Search className="w-4 h-4 text-gray-400 shrink-0" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="검색..."
                            className="w-full text-xs bg-transparent border-none focus:outline-none text-gray-900 dark:text-white"
                            autoFocus
                        />
                    </div>
                    <div className="py-1">
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400 text-center">검색 결과가 없습니다.</div>
                        ) : (
                            filteredOptions.map((opt) => {
                                const isOptUnassigned = opt.label === "미지정" || String(opt.id) === "none" || String(opt.id) === "0";
                                const isSelected = String(opt.id) === String(value);

                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            onChange(String(opt.id));
                                            setIsOpen(false);
                                            setSearchTerm("");
                                        }}
                                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${isSelected
                                            ? "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold"
                                            : isOptUnassigned
                                                ? "text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                            }`}
                                    >
                                        <span>{opt.label}</span>
                                        {opt.subText && (
                                            <span className="text-[10px] text-gray-400 ml-2 truncate max-w-[100px]">
                                                {opt.subText}
                                            </span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
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

export default function HistoryView({ loaderData }: Route.ComponentProps) {
    const {
        quote,
        partnerName,
        partnerContactName,
        amName,
        distContactName,
        currentProducts,
        partners,
        partnerContacts,
        ams,
        distContacts,
        masterProducts,
        defaultExchangeRate,
        noteList,
        dealFlowList,
    } = loaderData;

    const fetcher = useFetcher();

    // 편집 모드 상태
    const [isEditing, setIsEditing] = useState<boolean>(false);

    // 편집 Form state
    const [editProjectName, setEditProjectName] = useState<string>(quote.project_name || "");
    const [editClientCompany, setEditClientCompany] = useState<string>(quote.client_company || "");
    const [editClientContactName, setEditClientContactName] = useState<string>(quote.client_contact_name || "");
    const [editClientContactEmail, setEditClientContactEmail] = useState<string>(quote.client_contact_email || "");
    const [editClientContactPhone, setEditClientContactPhone] = useState<string>(quote.client_contact_phone || "");
    const [editPartnerId, setEditPartnerId] = useState<string>(quote.partner_id ? String(quote.partner_id) : "");
    const [editPartnerContactId, setEditPartnerContactId] = useState<string>(quote.partner_contact_id ? String(quote.partner_contact_id) : "");
    const [editAmId, setEditAmId] = useState<string>(quote.am_id ? String(quote.am_id) : "");
    const [editDistContactId, setEditDistContactId] = useState<string>(quote.dist_contact_id ? String(quote.dist_contact_id) : "");
    const [editContractType, setEditContractType] = useState<string>(quote.contract_type || "");
    const [editVendor, setEditVendor] = useState<string>(quote.vendor ? quote.vendor.split(",")[0] : "Broadcom");

    const [editProducts, setEditProducts] = useState<Record<string, any[]>>({});
    const [calcMode, setCalcMode] = useState<"PPC" | "DC" | "MARGIN" | "MANUAL">(
        quote.quote_type === 0 ? "PPC" : (quote.quote_type === 1 ? "DC" : (quote.quote_type === 2 ? "MARGIN" : "MANUAL"))
    );
    const [editGasNote, setEditGasNote] = useState<string>(quote.gas_note || "");
    const [editNotes, setEditNotes] = useState<string[]>([]);
    const [editDealFlows, setEditDealFlows] = useState<string[]>([]);
    const [editStage, setEditStage] = useState<number>(quote.stage !== undefined && quote.stage !== null ? quote.stage : 10);
    const [editDefaultGroup, setEditDefaultGroup] = useState<string>("");
    const [editSyncToGas, setEditSyncToGas] = useState<boolean>(quote.sync_to_gas === 1);

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

    const openOrderConfirmModal = (quoteObj: any, targetStage: number, extraOptions?: { isEditIntent?: boolean; editPayload?: any }) => {
        let productsObj: Record<string, any[]> = editProducts && Object.keys(editProducts).length > 0 ? editProducts : (quoteObj ? (quoteObj.productsList || {}) : {});

        if ((!productsObj || Object.keys(productsObj).length === 0) && quoteObj && Array.isArray(quoteObj.products)) {
            const grouped: Record<string, any[]> = {};
            quoteObj.products.forEach((p: any) => {
                const gName = p.group_name || "일시불";
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

        const initialPayment = quoteObj ? (quoteObj.payment_condition || 1) : 1;
        const initialBilling = initialPayment === 1 ? 1 : (quoteObj ? (quoteObj.billing_condition || 1) : 1);

        setOrderConfirmModalData({
            quoteId: quoteObj ? quoteObj.id : (extraOptions?.editPayload?.quoteId || 0),
            targetStage,
            paymentCondition: initialPayment,
            billingCondition: initialBilling,
            quoteNumber: quoteObj ? (quoteObj.quote_number || "") : "",
            poNumber: quoteObj ? (quoteObj.po_number || "") : "",
            lines: modalLines,
            isEditIntent: extraOptions?.isEditIntent,
            editPayload: extraOptions?.editPayload,
        });
    };

    // Toast 알림
    const [toast, setToast] = useState<{ message: string; type: "error" | "success" } | null>(null);

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // 로딩 처리
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
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [fetcher.state, fetcher.data]);

    // 서버 응답 처리
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.error) {
                setToast({ message: fetcher.data.error, type: "error" });
            } else if (fetcher.data.success) {
                if (fetcher.data.intent === "edit") {
                    setToast({ message: "성공적으로 저장되었습니다.", type: "success" });
                    setIsEditing(false);
                } else if (fetcher.data.intent === "delete") {
                    alert("성공적으로 삭제되었습니다.");
                    window.close();
                }
            }
        }
    }, [fetcher.state, fetcher.data]);

    // 수정 모드 진입
    const handleStartEdit = () => {
        setIsEditing(true);
        setEditProjectName(quote.project_name || "");
        setEditClientCompany(quote.client_company || "");
        setEditClientContactName(quote.client_contact_name || "");
        setEditClientContactEmail(quote.client_contact_email || "");
        setEditClientContactPhone(quote.client_contact_phone || "");
        setEditPartnerId(quote.partner_id ? String(quote.partner_id) : "");
        setEditPartnerContactId(quote.partner_contact_id ? String(quote.partner_contact_id) : "");
        setEditAmId(quote.am_id ? String(quote.am_id) : "");
        setEditDistContactId(quote.dist_contact_id ? String(quote.dist_contact_id) : "");
        setEditContractType(quote.contract_type || "");
        setEditVendor(quote.vendor ? quote.vendor.split(",")[0] : "Broadcom");

        const initialProducts = Object.keys(currentProducts).length > 0 ? currentProducts : { "일시불": [] };
        setEditProducts(JSON.parse(JSON.stringify(initialProducts)));
        setCalcMode(quote.quote_type === 0 ? "PPC" : "DC");
        setEditGasNote(quote.gas_note || "");
        setEditNotes(JSON.parse(JSON.stringify(noteList.length > 0 ? noteList : [""])));
        setEditDealFlows(JSON.parse(JSON.stringify(dealFlowList.length > 0 ? dealFlowList : [""])));
        setEditStage(quote.stage !== undefined && quote.stage !== null ? quote.stage : 10);

        let initialDefault = "";
        for (const [groupName, prods] of Object.entries(initialProducts)) {
            if (Array.isArray(prods) && prods.length > 0 && (prods[0] as any).group_default === 1) {
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

    const handleCancelEdit = () => {
        setIsEditing(false);
    };

    const handleCalcModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCalcMode(e.target.value as "PPC" | "DC" | "MARGIN");
    };

    // 벤더 변경 시 AM 및 제품 데이터 초기화 연동
    const handleVendorChange = (newVendor: string) => {
        if (newVendor === editVendor) return;
        const hasData = Object.values(editProducts).some((prods) =>
            prods.some((p) => p.제품코드 || p.제품설명)
        );
        if (hasData && !window.confirm("벤더를 변경하면 입력된 제품 데이터가 초기화됩니다. 변경하시겠습니까?")) {
            return;
        }
        setEditVendor(newVendor);
        setEditAmId("");
        setEditPartnerId("");
        setEditPartnerContactId("");
        setEditProducts({ "일시불": [createEmptyProductRow(defaultExchangeRate)] });
        setEditDefaultGroup("일시불");
    };

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
            const confirmChange = window.confirm("단계가 낮아지는 매출년도가 있습니다. 일괄 수정을 진행하시겠습니까?");
            if (!confirmChange) return false;
        }

        setEditProducts((prev) => {
            const next = { ...prev };
            for (const groupName of Object.keys(next)) {
                const prods = next[groupName];
                if (Array.isArray(prods)) {
                    next[groupName] = prods.map((p) => ({ ...p, stage: newStage }));
                }
            }
            return next;
        });
        return true;
    };

    const handleSaveEdit = () => {
        if (!editProjectName.trim()) {
            setToast({ message: "사업명을 입력해주세요.", type: "error" });
            return;
        }

        let updatedProducts = { ...editProducts };
        if (editStage === 99 || editStage === 100 || editStage === 0) {
            const newEditProducts: any = {};
            for (const [groupName, prods] of Object.entries(editProducts)) {
                if (Array.isArray(prods)) {
                    newEditProducts[groupName] = prods.map((p) => ({ ...p, stage: editStage }));
                } else {
                    newEditProducts[groupName] = prods;
                }
            }
            updatedProducts = newEditProducts;
        }

        let hasProduct = false;
        for (const [groupName, prods] of Object.entries(updatedProducts)) {
            if (Array.isArray(prods)) {
                if (prods.length > 0) hasProduct = true;
                for (let i = 0; i < prods.length; i++) {
                    const p = prods[i];
                    if (!p.제품코드) {
                        setToast({ message: `[${groupName}] ${i + 1}번째 행의 제품코드를 선택해주세요.`, type: "error" });
                        return;
                    }
                }
            }
        }

        if (!hasProduct) {
            setToast({ message: "최소 한 개 이상의 제품 항목이 필요합니다.", type: "error" });
            return;
        }

        const finalProducts = getFinalProducts(updatedProducts, calcMode);
        const finalEditNotes = editNotes.map((n) => n.trim()).filter((n) => n !== "");
        const finalEditDealFlows = editDealFlows.map((d) => d.trim()).filter((d) => d !== "");

        const editPayload = {
            intent: "edit",
            quoteId: quote.id,
            products: finalProducts,
            calcMode,
            notes: finalEditNotes,
            dealFlows: finalEditDealFlows,
            gasNote: editGasNote,
            projectName: editProjectName,
            clientCompany: editClientCompany,
            clientContactName: editClientContactName,
            clientContactEmail: editClientContactEmail,
            clientContactPhone: editClientContactPhone,
            partnerId: editPartnerId,
            partnerContactId: editPartnerContactId,
            amId: editAmId,
            distContactId: editDistContactId,
            contractType: editContractType,
            vendor: editVendor,
            stage: editStage,
            originalUpdatedAt: quote.updated_at,
            defaultGroup: editDefaultGroup,
            syncToGas: editSyncToGas,
        };

        const priorStage = Number(quote.stage) || 0;

        // 기존 단계가 99 미만이었던 견적이 99% 또는 100%로 새로 진입할 때만 모달 팝업
        if (priorStage < 99 && (editStage === 99 || editStage === 100)) {
            openOrderConfirmModal(quote, editStage, {
                isEditIntent: true,
                editPayload,
            });
            return;
        }

        fetcher.submit(editPayload, { method: "post", encType: "application/json" });
    };

    const handleDeleteQuote = () => {
        if (window.confirm("정말로 이 견적 전체를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.")) {
            fetcher.submit(
                { intent: "delete", quoteId: quote.id },
                { method: "post", encType: "application/json" }
            );
        }
    };

    // 하단 독립 비고(Notes) 핸들러
    const handleAddNote = () => setEditNotes((prev) => [...prev, ""]);
    const handleRemoveNote = (index: number) => setEditNotes((prev) => prev.filter((_, i) => i !== index));
    const handleNoteChange = (index: number, value: string) => {
        setEditNotes((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    // Deal Flow 핸들러 (quoting.tsx 방식)
    const handleAddDealFlow = () => setEditDealFlows((prev) => [...prev, ""]);
    const handleRemoveDealFlow = (index: number) => setEditDealFlows((prev) => prev.filter((_, i) => i !== index));
    const handleDealFlowChange = (index: number, value: string) => {
        setEditDealFlows((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

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
                if (key === oldName) next[newName] = prev[oldName];
                else next[key] = prev[key];
            }
            return next;
        });
        if (editDefaultGroup === oldName) setEditDefaultGroup(newName);
    };

    const handleAddGroup = () => {
        setEditProducts((prev) => {
            let newGroupName = "일시불";
            if ("일시불" in prev) {
                let idx = 1;
                while (`일시불${idx}` in prev) idx++;
                newGroupName = `일시불${idx}`;
            }
            return {
                ...prev,
                [newGroupName]: [createEmptyProductRow(defaultExchangeRate)],
            };
        });
    };

    const handleDuplicateGroup = (targetGroupName: string) => {
        setEditProducts((prev) => {
            const targetItems = prev[targetGroupName] || [];
            const duplicatedItems = targetItems.map((item) => ({ ...item }));

            let newGroupName = "일시불";
            if ("일시불" in prev) {
                let idx = 1;
                while (`일시불${idx}` in prev) idx++;
                newGroupName = `일시불${idx}`;
            }

            return {
                ...prev,
                [newGroupName]: duplicatedItems,
            };
        });
    };

    const handleRemoveGroup = (groupName: string) => {
        if (Object.keys(editProducts).length <= 1) {
            alert("최소 하나의 원가표 그룹이 존재해야 합니다.");
            return;
        }
        setEditProducts((prev) => {
            const next = { ...prev };
            delete next[groupName];
            return next;
        });
        if (editDefaultGroup === groupName) {
            const remaining = Object.keys(editProducts).filter((k) => k !== groupName);
            if (remaining.length > 0) setEditDefaultGroup(remaining[0]);
        }
    };

    const handleProductChange = (
        groupName: string,
        index: number,
        field: string,
        value: any,
    ) => {
        setEditProducts((prev) => {
            const currentProds = prev[groupName] || [];
            const newProds = [...currentProds];
            const updatedProduct = { ...newProds[index] };

            if (field === "제품코드") {
                const matched = (masterProducts as any[]).find((p) => p.code === value);
                if (matched) {
                    updatedProduct.제품코드 = matched.code;
                    updatedProduct.제품설명 = matched.description || "";
                    updatedProduct.lpd = matched.lpd || 0;
                    updatedProduct.lpw = matched.lpw || 0;
                } else {
                    updatedProduct.제품코드 = value;
                }
            } else if (field === "원화PPC" || field === "마진율") {
                updatedProduct[field] = value;
                const newDcWon = calculateReverseDCWon(field, value, updatedProduct);
                if (newDcWon !== null) {
                    updatedProduct.DC원화 = newDcWon;
                }
            } else {
                updatedProduct[field] = value;
            }

            newProds[index] = updatedProduct;
            return {
                ...prev,
                [groupName]: newProds,
            };
        });
    };

    const handleRemoveProduct = (groupName: string, index: number) => {
        setEditProducts((prev) => {
            const currentProds = prev[groupName] || [];
            if (currentProds.length <= 1) {
                alert("최소 한 개 이상의 제품 행이 필요합니다.");
                return prev;
            }
            const newProds = currentProds.filter((_, i) => i !== index);
            return {
                ...prev,
                [groupName]: newProds,
            };
        });
    };

    const handleDuplicateProduct = (groupName: string, index: number) => {
        setEditProducts((prev) => {
            const list = prev[groupName] || [];
            const targetItem = list[index];
            if (!targetItem) return prev;
            const duplicatedItem = { ...targetItem };
            const newList = [...list];
            newList.splice(index + 1, 0, duplicatedItem);
            return {
                ...prev,
                [groupName]: newList,
            };
        });
    };

    const handleAddProduct = (groupName: string) => {
        setEditProducts((prev) => ({
            ...prev,
            [groupName]: [...(prev[groupName] || []), createEmptyProductRow(defaultExchangeRate)],
        }));
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
                partnerCompany: partnerName || quoteInfo.partner_company || "",
                partnerName: partnerContactName || quoteInfo.partner_contact_name || "",
                clientCompany: isEditing ? editClientCompany : (quoteInfo.client_company || ""),
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

    const handleDownloadExcel = async () => {
        const targetProducts = isEditing ? editProducts : displayProducts;
        const currentProjectName = isEditing ? editProjectName : (quote.project_name || "");

        const grouped = Array.isArray(targetProducts)
            ? { "원가표": targetProducts }
            : targetProducts;

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
                partnerName?.trim() || quote.partner_company?.trim(),
                partnerContactName?.trim() || quote.partner_contact_name?.trim(),
                (isEditing ? editClientCompany : quote.client_company)?.trim(),
                currentProjectName?.trim(),
                dateStr,
            ]
                .filter(Boolean)
                .join("-");

            const finalGroupedProducts = getFinalProducts(grouped, calcMode);

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

    // 파스 히스토리 이력 파싱
    let historyList: Array<Record<string, any>> = [];
    if (quote.products_history) {
        try {
            historyList = JSON.parse(quote.products_history);
            if (!Array.isArray(historyList)) historyList = [];
        } catch (e) {
            historyList = [];
        }
    }
    const sortedHistory = [...historyList].reverse();

    // 벤더 기반 파트너사 및 AM 검색 옵션
    const currentVendor = isEditing ? editVendor : (quote.vendor || "Broadcom");
    const partnerOptions = [
        { id: "none", label: "미지정" },
        ...(partners as any[])
            .filter((p: any) => !currentVendor || !p.vendor || p.vendor === currentVendor)
            .map((p: any) => ({ id: p.id, label: p.name }))
    ];

    const partnerContactOptions = [
        { id: "none", label: "미지정" },
        ...(partnerContacts as any[])
            .filter((c: any) => !editPartnerId || editPartnerId === "none" || String(c.partner_id) === String(editPartnerId))
            .map((c: any) => ({ id: c.id, label: c.name, subText: c.email || c.phone }))
    ];

    const amOptions = [
        { id: "none", label: "미지정" },
        ...(ams as any[])
            .filter((a: any) => !currentVendor || !a.vendor || a.vendor === currentVendor)
            .map((a: any) => ({ id: a.id, label: a.name }))
    ];

    const distContactOptions = [
        { id: "none", label: "미지정" },
        ...(distContacts as any[]).map((d: any) => ({ id: d.id, label: d.name, subText: d.position }))
    ];

    // 현재 표시할 데이터
    const displayProducts = isEditing ? editProducts : currentProducts;
    const displayNotes = isEditing ? editNotes : noteList;
    const displayDealFlows = isEditing ? editDealFlows : dealFlowList;
    const displayGasNote = isEditing ? editGasNote : (quote.gas_note || "-");

    // 오더 상태 계산 뱃지
    const currentStage = isEditing ? editStage : (quote.stage !== undefined && quote.stage !== null ? quote.stage : 10);
    const getOrderStatusBadge = (stg: number) => {
        if (stg === 0) return <span className="text-red-500 dark:text-red-400 font-bold">실주</span>;
        if (stg === 99 || stg === 100) return <span className="text-green-600 dark:text-green-400 font-bold">오더 완료</span>;
        return <span className="text-blue-500 dark:text-blue-400 font-bold">진행 중</span>;
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-[1600px] mx-auto space-y-8">
                {/* 1. Header Navigation - 뒤로가기 버튼 없음, "견적 상세" */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
                    <div>
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1 rounded-full">
                            견적 상세
                        </span>
                        {isEditing ? (
                            <div className="mt-2 space-y-1">
                                <label className="text-xs font-semibold text-gray-500">사업명:</label>
                                <input
                                    type="text"
                                    value={editProjectName}
                                    onChange={(e) => setEditProjectName(e.target.value)}
                                    className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-xl"
                                    placeholder="사업명을 입력하세요"
                                />
                            </div>
                        ) : (
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white mt-1">
                                {quote.project_name || "프로젝트명 없음"}
                            </h1>
                        )}
                    </div>
                </div>

                {/* 2. 상단 정보 요약 카드 (고객사 / 파트너사 / 영업 / 현재상태) */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
                    {/* 고객사 정보 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Building2 className="w-4 h-4" /> 고객사 정보
                        </h3>
                        {isEditing ? (
                            <div className="space-y-2 text-sm">
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">고객사명:</label>
                                    <input
                                        type="text"
                                        value={editClientCompany}
                                        onChange={(e) => setEditClientCompany(e.target.value)}
                                        className="w-full px-2.5 py-1 border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                        placeholder="고객사명 입력"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">담당자 이름:</label>
                                    <input
                                        type="text"
                                        value={editClientContactName}
                                        onChange={(e) => setEditClientContactName(e.target.value)}
                                        className="w-full px-2.5 py-1 border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                        placeholder="담당자 이름"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">이메일:</label>
                                    <input
                                        type="email"
                                        value={editClientContactEmail}
                                        onChange={(e) => setEditClientContactEmail(e.target.value)}
                                        className="w-full px-2.5 py-1 border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                        placeholder="이메일"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">연락처:</label>
                                    <input
                                        type="text"
                                        value={editClientContactPhone}
                                        onChange={(e) => setEditClientContactPhone(e.target.value)}
                                        className="w-full px-2.5 py-1 border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                        placeholder="연락처"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1 sm:space-y-1.5 text-sm">
                                <p><span className="text-gray-500 dark:text-gray-400">고객사명:</span> <strong>{quote.client_company || "-"}</strong></p>
                                <p><span className="text-gray-500 dark:text-gray-400">담당자 이름:</span> {quote.client_contact_name || "-"}</p>
                                <p><span className="text-gray-500 dark:text-gray-400">이메일:</span> {quote.client_contact_email || "-"}</p>
                                <p><span className="text-gray-500 dark:text-gray-400">연락처:</span> {quote.client_contact_phone || "-"}</p>
                            </div>
                        )}
                    </div>

                    {/* 파트너사 정보 - 벤더 기반 필터링 및 검색형 드롭다운 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Users className="w-4 h-4" /> 담당자 정보
                        </h3>
                        {isEditing ? (
                            <div className="space-y-2 text-sm">
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">파트너사 (검색):</label>
                                    <SearchableSelect
                                        options={partnerOptions}
                                        value={editPartnerId}
                                        onChange={(val) => {
                                            setEditPartnerId(val);
                                            setEditPartnerContactId("");
                                        }}
                                        placeholder="파트너사 검색 및 선택"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">파트너 담당자 (검색):</label>
                                    <SearchableSelect
                                        options={partnerContactOptions}
                                        value={editPartnerContactId}
                                        onChange={(val) => setEditPartnerContactId(val)}
                                        placeholder="파트너 담당자 검색 및 선택"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">총판 담당자 (검색):</label>
                                    <SearchableSelect
                                        options={distContactOptions}
                                        value={editDistContactId}
                                        onChange={(val) => setEditDistContactId(val)}
                                        placeholder="총판 담당자 검색 및 선택"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">담당AM (검색):</label>
                                    <SearchableSelect
                                        options={amOptions}
                                        value={editAmId}
                                        onChange={(val) => setEditAmId(val)}
                                        placeholder="담당AM 검색 및 선택"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1 sm:space-y-1.5 text-sm">
                                <p><span className="text-gray-500 dark:text-gray-400">파트너사명:</span> <strong>{partnerName || "-"}</strong></p>
                                <p><span className="text-gray-500 dark:text-gray-400">담당자 이름:</span> {partnerContactName || "-"}</p>
                                <p><span className="text-gray-500 dark:text-gray-400">총판 담당자:</span> {distContactName || "-"}</p>
                                <p><span className="text-gray-500 dark:text-gray-400">담당AM:</span> {amName || quote.vendor || "-"}</p>
                            </div>
                        )}
                    </div>

                    {/* 영업 정보 - 벤더 단일 선택 및 Deal Flow */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <UserCircle className="w-4 h-4" /> 영업 정보
                        </h3>
                        {isEditing ? (
                            <div className="space-y-3 text-sm">
                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">벤더 선택 (단일):</label>
                                    <div className="flex gap-4 mt-1 bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700">
                                        {["Broadcom", "Omnissa"].map((v) => (
                                            <label key={v} className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold">
                                                <input
                                                    type="radio"
                                                    name="editVendorRadio"
                                                    value={v}
                                                    checked={editVendor === v}
                                                    onChange={() => handleVendorChange(v)}
                                                    className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500"
                                                />
                                                <span>{v}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500 font-semibold">계약방식:</label>
                                    <input
                                        type="text"
                                        value={editContractType}
                                        onChange={(e) => setEditContractType(e.target.value)}
                                        className="w-full px-2.5 py-1 border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                        placeholder="계약방식 입력"
                                    />
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs text-gray-500 font-semibold">Deal Flow:</label>
                                        <button
                                            type="button"
                                            onClick={handleAddDealFlow}
                                            className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center"
                                        >
                                            <Plus className="w-3 h-3 mr-0.5" /> 단계 추가
                                        </button>
                                    </div>
                                    <div className="space-y-1.5 max-h-36 overflow-auto pr-1">
                                        {editDealFlows.map((flow, idx) => (
                                            <div key={idx} className="flex items-center gap-1">
                                                <input
                                                    type="text"
                                                    value={flow}
                                                    onChange={(e) => handleDealFlowChange(idx, e.target.value)}
                                                    placeholder={`Deal Flow 단계 ${idx + 1}`}
                                                    className="w-full px-2 py-1 text-xs border rounded bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
                                                />
                                                {editDealFlows.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveDealFlow(idx)}
                                                        className="text-red-500 hover:text-red-700 p-1"
                                                        title="단계 삭제"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1.5 text-sm">
                                <p><span className="text-gray-500 dark:text-gray-400">계약방식:</span> {quote.contract_type || "-"}</p>
                                <p><span className="text-gray-500 dark:text-gray-400">벤더:</span> <strong>{quote.vendor || "-"}</strong></p>

                                <div>
                                    <span className="text-gray-500 dark:text-gray-400">Deal Flow:</span>
                                    {displayDealFlows.length === 0 ? (
                                        <span className="ml-1 text-gray-400">-</span>
                                    ) : (
                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                            {displayDealFlows.map((flow, idx) => (
                                                <Fragment key={idx}>
                                                    {idx > 0 && <span className="text-gray-400 text-xs">➤</span>}
                                                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded font-medium">{flow}</span>
                                                </Fragment>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 현재 상태 - 단계에 따른 자동 결정 */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            <Layers className="w-4 h-4" /> 현재 상태
                        </h3>
                        <div className="space-y-1.5 text-sm">
                            <p>
                                <span className="text-gray-500 dark:text-gray-400">오더 상태:</span>{" "}
                                {getOrderStatusBadge(currentStage)}
                            </p>
                            <p><span className="text-gray-500 dark:text-gray-400">등록일자:</span> {new Date(quote.created_at).toLocaleString("ko-KR")}</p>
                            <p><span className="text-gray-500 dark:text-gray-400">마지막 수정:</span> {new Date(quote.updated_at).toLocaleString("ko-KR")}</p>
                        </div>
                    </div>
                </div>

                {/* 3. 견적 상세 헤더 (대표비고, 단계, 수정버튼) */}
                <div className="bg-blue-50/70 dark:bg-blue-950/40 p-6 rounded-2xl border border-blue-200 dark:border-blue-800/60 shadow-sm space-y-6">
                    <div className="bg-white/95 dark:bg-gray-800/95 p-5 rounded-xl border border-blue-100 dark:border-blue-900/50 shadow-sm">
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 w-full">
                            <div className="flex items-center gap-4 flex-1 min-w-0 w-full lg:w-auto">
                                <h3 className="font-bold text-gray-800 dark:text-gray-200 flex items-center text-xl whitespace-nowrap flex-shrink-0">
                                    <Package className="w-6 h-6 mr-2 text-gray-500" />
                                    견적 상세
                                </h3>

                                {/* 대표비고 표시/입력 (남은 공간을 flex-1로 채움) */}
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap flex-shrink-0">대표비고:</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editGasNote}
                                            onChange={(e) => setEditGasNote(e.target.value)}
                                            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0 w-full"
                                            placeholder="대표 비고를 입력하세요"
                                        />
                                    ) : (
                                        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 bg-gray-50 dark:bg-gray-700/60 rounded border border-gray-200 dark:border-gray-600 flex-1 min-w-0 w-full truncate" title={displayGasNote}>
                                            {displayGasNote}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-4 flex-shrink-0">
                                {/* 단계 표시/입력 */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">단계:</span>
                                    {isEditing ? (
                                        <select
                                            value={editStage}
                                            disabled={fetcher.state === "submitting"}
                                            onChange={(e) => {
                                                const newVal = Number(e.target.value);
                                                setEditStage(newVal);
                                                updateAllProductsStage(newVal);
                                            }}
                                            className="bg-white border border-gray-300 text-gray-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block px-2.5 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-semibold cursor-pointer"
                                        >
                                            {[0, 10, 25, 50, 75, 99, 100].map((val) => (
                                                <option key={val} value={val}>{val}%</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400 px-3 py-1 bg-blue-50 dark:bg-blue-900/30 rounded-md border border-blue-200 dark:border-blue-800">
                                            {quote.stage !== undefined && quote.stage !== null ? `${quote.stage}%` : "-"}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* 컨트롤 버튼 구역 (상세보기 버튼 제외) */}
                            <div className="flex items-center gap-3 flex-wrap">
                                {isEditing ? (
                                    <>
                                        <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 p-1.5 rounded border border-gray-200 dark:border-gray-600">
                                            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 ml-1">계산 기준:</span>
                                            {(["PPC", "DC", "MARGIN", "MANUAL"] as const).map((mode) => (
                                                <label key={mode} className="flex items-center gap-1 cursor-pointer px-1 text-xs">
                                                    <input
                                                        type="radio"
                                                        name="calcModeHistory"
                                                        value={mode}
                                                        checked={calcMode === mode}
                                                        onChange={handleCalcModeChange}
                                                        className="w-3.5 h-3.5 text-blue-600"
                                                    />
                                                    <span className={mode === "MANUAL" ? "text-blue-600 dark:text-blue-400 font-semibold" : ""}>
                                                        {mode === "DC" ? "DC원화" : mode === "MARGIN" ? "마진" : mode === "MANUAL" ? "수동" : "PPC"}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleAddGroup}
                                            disabled={fetcher.state === "submitting"}
                                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 h-8 px-3 border border-blue-200 dark:border-blue-800"
                                        >
                                            <Plus className="w-4 h-4 mr-1" /> 그룹 추가
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSaveEdit}
                                            disabled={fetcher.state === "submitting"}
                                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-green-600 text-white hover:bg-green-700 h-8 px-3 shadow"
                                        >
                                            <Save className="w-4 h-4 mr-1.5" /> 저장
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDeleteQuote}
                                            disabled={fetcher.state === "submitting"}
                                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-red-600 text-white hover:bg-red-700 h-8 px-3 shadow"
                                        >
                                            <Trash2 className="w-4 h-4 mr-1.5" /> 삭제
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleCancelEdit}
                                            disabled={fetcher.state === "submitting"}
                                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-600 h-8 px-3"
                                        >
                                            <X className="w-4 h-4 mr-1.5" /> 취소
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleStartEdit}
                                        className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 h-9 px-5 shadow-md"
                                    >
                                        수정
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 4. 견적제품라인 테이블 (원가표 그룹별) */}
                    {Object.entries(displayProducts).map(([groupName, groupProducts]) => {
                        // 수정 모드일 때만 getFinalProducts로 실시간 재계산, 조회 모드에서는 DB에 동기화된 값을 그대로 보존하여 표시
                        const finalProds = isEditing
                            ? (getFinalProducts(groupProducts as any[], calcMode) as any[])
                            : (groupProducts as any[]).map((p: any) => ({
                                ...p,
                                공급가: p.공급가 !== undefined ? p.공급가 : (p.supply_price !== undefined ? p.supply_price : 0),
                                마진: p.마진 !== undefined ? p.마진 : (p.margin !== undefined ? p.margin : 0),
                                마진율: p.마진율 !== undefined ? String(p.마진율) : (p.margin_rate !== undefined ? String(p.margin_rate) : (p.supply_price ? ((p.margin / p.supply_price) * 100).toFixed(1) : "0.0")),
                                DC원화: p.DC원화 !== undefined ? p.DC원화 : (p.dc_krw !== undefined ? p.dc_krw : 0),
                                DC달러: p.DC달러 !== undefined ? p.DC달러 : (p.dc_usd !== undefined ? p.dc_usd : 0),
                                원화PPC: p.원화PPC !== undefined ? p.원화PPC : (p.krw_ppc !== undefined ? p.krw_ppc : 0),
                                달러net: p.달러net !== undefined ? p.달러net : (p.netdollar !== undefined ? p.netdollar : (Number(p.달러PPC !== undefined ? p.달러PPC : (Number(p.lpd || 0) * (1 - Number(p.DC달러 || 0) / 100))) * Number(p.수량 !== undefined ? p.수량 : (p.quantity !== undefined ? p.quantity : 1)) * Number(p.기간 !== undefined ? p.기간 : (p.period !== undefined ? p.period : 1)))),
                                lpd: p.lpd !== undefined ? p.lpd : 0,
                                lpw: p.lpw !== undefined ? p.lpw : 0,
                                수량: p.수량 !== undefined ? p.수량 : (p.quantity !== undefined ? p.quantity : 1),
                                기간: p.기간 !== undefined ? p.기간 : (p.period !== undefined ? p.period : 1),
                                년차: p.년차 !== undefined ? p.년차 : (p.year !== undefined ? p.year : 1),
                                매출월: p.매출월 !== undefined ? p.매출월 : (p.month !== undefined ? p.month : 1),
                            }));

                        const groupTotalNetUsd = finalProds.reduce((sum, p) => sum + (Number(p.달러net) || 0), 0);
                        const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                        const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                        const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                        return (
                            <div key={groupName} className="bg-white/95 dark:bg-gray-800/95 p-5 rounded-xl border border-blue-100 dark:border-blue-900/50 shadow-sm space-y-4">
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
                                                {(((groupProducts as any[]).length > 0 && ((groupProducts as any[])[0] as any).group_default === 1) || editDefaultGroup === groupName) && (
                                                    <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/10 dark:ring-blue-400/20">
                                                        기본
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-4">
                                            <span>달러net 합계: <strong className="text-gray-800 dark:text-gray-200">${groupTotalNetUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                            <span>공급가 합계: <strong className="text-gray-800 dark:text-gray-200">₩{groupTotalSupply.toLocaleString()}</strong></span>
                                            <span>마진 합계: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                        </div>
                                        {isEditing && (
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleAddProduct(groupName)}
                                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                                >
                                                    <Plus className="w-3.5 h-3.5 mr-1" /> 제품 추가
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDuplicateGroup(groupName)}
                                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                                    title="그룹 복제"
                                                >
                                                    <Copy className="w-3.5 h-3.5 mr-1" /> 그룹 복제
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
                                    masterProducts={masterProducts}
                                    vendorFilter={currentVendor}
                                    onChangeProduct={(idx, field, value) => handleProductChange(groupName, idx, field, value)}
                                    onRemoveProduct={(idx) => handleRemoveProduct(groupName, idx)}
                                    onDuplicateProduct={(idx) => handleDuplicateProduct(groupName, idx)}
                                />
                            </div>
                        );
                    })}

                    {/* 엑셀 다운로드 버튼 */}
                    <div className="flex justify-end pt-2">
                        <button
                            type="button"
                            onClick={handleDownloadExcel}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 bg-white text-green-600 border border-green-600 hover:bg-green-50 dark:bg-gray-800 dark:text-green-400 dark:border-green-500 dark:hover:bg-green-900/30 h-9 px-4 shadow-sm"
                        >
                            <Download className="w-4 h-4 mr-1.5" />{" "}
                            다운로드 (Excel)
                        </button>
                    </div>

                    {/* 5. 비고 (Notes) 목록 섹션 - 대표비고와 구분된 독립 비고 리스트 */}
                    <div className="bg-white/95 dark:bg-gray-800/95 p-5 rounded-xl border border-blue-100 dark:border-blue-900/50 shadow-sm space-y-4">
                        <div className="flex justify-between items-center border-b dark:border-gray-700/60 pb-3">
                            <h4 className="font-bold text-gray-800 dark:text-gray-200 text-lg flex items-center">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block mr-2" />
                                비고 (Notes)
                            </h4>
                            {isEditing && (
                                <button
                                    type="button"
                                    onClick={handleAddNote}
                                    className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 h-8 px-2.5 border border-blue-200 dark:border-blue-800"
                                >
                                    <Plus className="w-3.5 h-3.5 mr-1" /> 비고 추가
                                </button>
                            )}
                        </div>

                        {isEditing ? (
                            <div className="space-y-3">
                                {editNotes.map((noteText, idx) => (
                                    <div key={idx} className="flex gap-2 items-start">
                                        <span className="text-xs font-semibold text-gray-500 mt-2 whitespace-nowrap">
                                            비고 {idx + 1}:
                                        </span>
                                        <textarea
                                            value={noteText}
                                            onChange={(e) => handleNoteChange(idx, e.target.value)}
                                            rows={2}
                                            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder={`비고 ${idx + 1} 내용을 입력하세요`}
                                        />
                                        {editNotes.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveNote(idx)}
                                                className="text-red-500 hover:text-red-700 p-1 mt-1"
                                                title="비고 삭제"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {displayNotes.length === 0 ? (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">등록된 비고 내용이 없습니다.</p>
                                ) : (
                                    <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1.5">
                                        {displayNotes.map((noteText: string, idx: number) => (
                                            <li key={idx} className="whitespace-pre-wrap leading-relaxed">
                                                {noteText}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 6. 견적 변경 히스토리 타임라인 (Timeline) */}
                <div className="space-y-6 pt-4">
                    <div className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-200">
                        <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <h2>제품 상세 변경 히스토리 ({historyList.length}건)</h2>
                    </div>

                    {sortedHistory.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-12 text-center text-gray-500 dark:text-gray-400">
                            기록된 변경 이력이 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-8 relative before:absolute before:inset-y-0 before:left-4 sm:before:left-6 before:w-0.5 before:bg-gray-200 dark:before:bg-gray-800">
                            {sortedHistory.map((historyItem, revisionIdx) => {
                                const timestamp = Object.keys(historyItem)[0];
                                const rawProducts = historyItem[timestamp];
                                const editTime = new Date(Number(timestamp)).toLocaleString("ko-KR");

                                const currentMode = quote.quote_type === 0 ? "PPC" : "DC";
                                const grouped = Array.isArray(rawProducts) ? { "원가표": rawProducts } : rawProducts;
                                const calculatedGrouped = getFinalProducts(grouped, currentMode);

                                return (
                                    <div key={timestamp} className="relative pl-10 sm:pl-14 group">
                                        <div className="absolute left-2.5 sm:left-4.5 top-1.5 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-blue-600 border-4 border-white dark:border-gray-900 group-hover:scale-110 transition-transform duration-200 shadow-sm" />

                                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 space-y-6">
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b dark:border-gray-700 pb-3 gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">
                                                        버전 {historyList.length - revisionIdx}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                                                        <Calendar className="w-4 h-4" />
                                                        <span>{editTime}</span>
                                                    </div>
                                                </div>
                                                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">
                                                    타입: {currentMode === "PPC" ? "원화PPC 기준" : "DC원화 기준"}
                                                </span>
                                            </div>

                                            {Object.entries(calculatedGrouped).map(([groupName, groupProducts]) => {
                                                const finalProds = groupProducts as any[];
                                                const groupTotalSupply = finalProds.reduce((sum, p) => sum + (Number(p.공급가) || 0), 0);
                                                const groupTotalMargin = finalProds.reduce((sum, p) => sum + (Number(p.마진) || 0), 0);
                                                const groupMarginPercent = groupTotalSupply ? ((groupTotalMargin / groupTotalSupply) * 100).toFixed(1) : "0.0";

                                                return (
                                                    <div key={groupName} className="space-y-3">
                                                        <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-750 pb-2">
                                                            <h4 className="font-bold text-gray-800 dark:text-gray-200 text-base">
                                                                {groupName}
                                                            </h4>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-4">
                                                                <span>공급가: <strong>₩{groupTotalSupply.toLocaleString()}</strong></span>
                                                                <span>마진: <strong className="text-green-600 dark:text-green-400">₩{groupTotalMargin.toLocaleString()} ({groupMarginPercent}%)</strong></span>
                                                            </div>
                                                        </div>

                                                        {finalProds.length === 0 ? (
                                                            <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                                                                추가된 제품이 없습니다.
                                                            </div>
                                                        ) : (
                                                            <ProductTable
                                                                rawProducts={finalProds}
                                                                finalProducts={finalProds}
                                                                isEditable={false}
                                                                calcMode={quote.quote_type === 0 ? "PPC" : "DC"}
                                                                masterProducts={[]}
                                                                vendorFilter={quote.vendor}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* 오더 컨디션 확인 모달 */}
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

            {/* 제출 진행 중 오버레이 모달 (home.tsx와 100% 동일한 디자인 및 단계 인디케이터 적용) */}
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

            {/* Toast 컴포넌트 */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-lg shadow-xl border ${toast.type === "error" ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200" : "bg-gray-900 border-gray-800 text-white dark:bg-gray-100 dark:border-gray-200 dark:text-gray-900"} transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in`}>
                    {toast.type === "error" ? <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" /> : <CheckCircle2 className="w-5 h-5 text-green-400 dark:text-green-600" />}
                    <p className="text-sm font-medium">{toast.message}</p>
                </div>
            )}
        </div>
    );
}
