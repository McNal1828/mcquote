import type { Route } from "./+types/api.mod";
import db from "../db.server";

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
        const { apiKey, id, supplyPrice, margin, stage } = body;

        // 🔒 [보안 인증 키 검증]
        if (!apiKey || apiKey !== SECRET_API_KEY) {
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

        // DB 트랜잭션: 상속 수식 붕괴를 피하기 위해 가격, 마진, 단지만 단독 갱신
        db.transaction(() => {
            // ① 개별 quote_lines 단독 업데이트
            db.prepare(`
                UPDATE quote_lines
                SET supply_price = ?, margin = ?, stage = ?
                WHERE id = ?
            `).run(Number(supplyPrice), Number(margin), Number(stage), Number(id));

            // ② 상위 quotes 테이블의 stage 및 updated_at을 동일하게 동기화 (전체 상태 정합성 보장)
            /*
            db.prepare(`
                UPDATE quotes
                SET stage = ?, updated_at = ?
                WHERE id = (
                    SELECT qg.quote_id 
                    FROM quote_groups qg
                    JOIN quote_lines ql ON ql.group_id = qg.id
                    WHERE ql.id = ?
                )
            `).run(Number(stage), Date.now(), Number(id));
            */
        })();

        console.log(`[Google Sheets Webhook Sync Success] Line ID: ${id} | Price: ${supplyPrice} | Margin: ${margin} | Stage: ${stage}%`);

        return new Response(JSON.stringify({ success: true, message: "Sync successful" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        console.error("[Google Sheets Webhook Sync Failed]:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
