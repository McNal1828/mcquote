import type { Route } from "./+types/api.mod";
import db from "../db.server";
import { logger } from "~/utils/logger";

const SECRET_API_KEY = "dptmeldkdltkdjqqnqlalfqjsgh";

export async function action({ request }: Route.ActionArgs) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const body = await request.json();
        const { apiKey, id, supplyPrice, margin, marginRate, stage, netdollar, gasNote, projectCode } = body;

        // 🔒 [보안 인증 키 검증]
        if (!apiKey || apiKey !== SECRET_API_KEY) {
            logger.warn(`[Google Sheets Webhook Sync] Unauthorized access attempt with invalid key`);
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (!id) {
            return new Response(JSON.stringify({ error: "Missing quote line ID" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const supplyPriceNum = Number(supplyPrice) || 0;
        const marginNum = Number(margin) || 0;
        const calculatedMarginRate = marginRate !== undefined && marginRate !== null
            ? Number(marginRate)
            : (supplyPriceNum > 0 ? parseFloat(((marginNum / supplyPriceNum) * 100).toFixed(1)) : 0);

        const netDollarNum = netdollar !== undefined && netdollar !== null ? Number(netdollar) : null;

        // DB 트랜잭션: 구글 시트에서 역방향 동기화 수신 시 공급가, 마진, 마진율, Stage, netdollar 및 gas_note, project_code 업데이트
        db.transaction(() => {
            if (netDollarNum !== null && !isNaN(netDollarNum)) {
                db.prepare(`
                    UPDATE quote_lines
                    SET supply_price = ?, margin = ?, margin_rate = ?, stage = ?, netdollar = ?
                    WHERE id = ?
                `).run(supplyPriceNum, marginNum, calculatedMarginRate, Number(stage), netDollarNum, Number(id));
            } else {
                db.prepare(`
                    UPDATE quote_lines
                    SET supply_price = ?, margin = ?, margin_rate = ?, stage = ?
                    WHERE id = ?
                `).run(supplyPriceNum, marginNum, calculatedMarginRate, Number(stage), Number(id));
            }

            // S열 대표비고 (gasNote)가 전달된 경우 해당 견적의 gas_note 업데이트
            if (gasNote !== undefined && gasNote !== null) {
                db.prepare(`
                    UPDATE quotes
                    SET gas_note = ?
                    WHERE id = (
                        SELECT qg.quote_id 
                        FROM quote_groups qg 
                        JOIN quote_lines ql ON qg.id = ql.group_id 
                        WHERE ql.id = ?
                    )
                `).run(String(gasNote), Number(id));
            }

            // M열 Project Code (projectCode)가 전달된 경우 해당 견적의 project_code 업데이트
            if (projectCode !== undefined && projectCode !== null) {
                db.prepare(`
                    UPDATE quotes
                    SET project_code = ?
                    WHERE id = (
                        SELECT qg.quote_id 
                        FROM quote_groups qg 
                        JOIN quote_lines ql ON qg.id = ql.group_id 
                        WHERE ql.id = ?
                    )
                `).run(String(projectCode), Number(id));
            }
        })();

        logger.info(`[Google Sheets Webhook Sync Success] Line ID: ${id} | Price: ${supplyPriceNum} | Margin: ${marginNum} | Stage: ${stage}% | GasNote: ${gasNote || ""} | ProjectCode: ${projectCode || ""}`);

        return new Response(JSON.stringify({ success: true, message: "Sync successful" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        logger.error(`[Google Sheets Webhook Sync Failed]: ${error.stack || error.message}`);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
