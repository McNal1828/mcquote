const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbx5qaLTF4yRuSg_lHY1b0BSoKAIfI9YenjGKKOrgRX_wrfGWQEm2-Nal8ChsYK_0QqQ2w/exec";

export interface GasRowPayload {
    id: number;       // SQLite DB에서 취득한 quote_lines.id 고유키
    year: number;
    month: number;
    vendor: string;
    dist: string;
    am: string;
    partner: string;
    contact: string;
    account: string;
    stage: number;
    price: number;
    margin: number;
    netdollar: number; // lpd * 수량 * 기간 * DC달러
}

export interface GasBatchPayload {
    deleteIds?: number[];
    addRows?: GasRowPayload[];
    updateRows?: Array<{ id: number; stage: number }>;
}

/**
 * Google Apps Script 웹앱으로 공통 POST 요청을 전송합니다.
 */
export async function sendGasRequest(action: "add" | "delete" | "update", payload: GasRowPayload): Promise<{ success: boolean; data?: any; error?: string }> {
    const requestBody = {
        action,
        apiKey: "dptmeldkdltkdjqqnqlalfqjsgh",
        ...payload
    };

    console.log(`[GAS Request] Action: ${action}, URL: ${GAS_WEBAPP_URL}`);
    console.log(`[GAS Payload]`, JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(GAS_WEBAPP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8", // Google Apps Script의 CORS 대응
            },
            body: JSON.stringify(requestBody)
        });

        console.log(`[GAS Response Status]: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        // GAS의 반환 데이터가 JSON이 아닐 수도 있으므로 예외 처리를 둡니다.
        const text = await response.text();
        console.log(`[GAS Response Text]:`, text);

        let data: any = null;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // JSON 파싱 실패 시 일반 텍스트 보관
            data = { raw: text };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error(`[GAS Sync Failed] (${action}):`, error);
        return { success: false, error: error.message || "Unknown error" };
    }
}

/**
 * Google Apps Script 웹앱으로 일괄 배치(Batch) POST 요청을 전송합니다.
 */
export async function sendGasBatchRequest(payload: GasBatchPayload): Promise<{ success: boolean; data?: any; error?: string }> {
    const requestBody = {
        action: "batch",
        apiKey: "dptmeldkdltkdjqqnqlalfqjsgh",
        ...payload
    };

    console.log(`[GAS Batch Request] URL: ${GAS_WEBAPP_URL}`);
    console.log(`[GAS Batch Payload]`, JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(GAS_WEBAPP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(requestBody)
        });

        console.log(`[GAS Batch Response Status]: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const text = await response.text();
        console.log(`[GAS Batch Response Text]:`, text);

        let data: any = null;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = { raw: text };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error(`[GAS Batch Sync Failed]:`, error);
        return { success: false, error: error.message || "Unknown error" };
    }
}
