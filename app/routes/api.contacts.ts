import { json } from "react-router";
import db from "../db.server";
import type { Route } from "./+types/api.contacts";

export async function loader({ request }: Route.LoaderArgs) {
    const url = new URL(request.url);
    const partnerId = url.searchParams.get("partnerId");

    // partnerId가 없으면 빈 배열 반환
    if (!partnerId) {
        return json({ contacts: [] });
    }

    // 전달받은 파트너사 ID에 해당하는 담당자만 조회
    const stmt = db.prepare(
        "SELECT id, partner_id, name, email, phone FROM partner_contacts WHERE partner_id = ? ORDER BY name ASC",
    );
    const contacts = stmt.all(Number(partnerId));

    return json({ contacts });
}
