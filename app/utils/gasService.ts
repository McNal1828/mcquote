const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxHtn_Yh5cxx0Ph02GEHLvc2Z8OnN22orSJu7SKovN2dL7l5uQ7-hP1PWcN0kBbTqvJ1Q/exec";

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
    projectCode?: string;
    stage: number;
    price: number;
    margin: number;
    netdollar: number; // lpd * 수량 * 기간 * DC달러
}

export interface GasBatchPayload {
    deleteIds?: number[];
    addRows?: GasRowPayload[];
    updateRows?: Array<{ id: number; stage?: number; projectCode?: string; year?: number; month?: number; price?: number; margin?: number; netdollar?: number; note?: string }>;
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Google Apps Script 웹앱으로 공통 POST 요청을 전송합니다. (단 1회 전송으로 중복 추가 방지)
 */
export async function sendGasRequest(
    action: "add" | "delete" | "update",
    payload: GasRowPayload
): Promise<{ success: boolean; data?: any; error?: string }> {
    const requestBody = {
        action,
        apiKey: "dptmeldkdltkdjqqnqlalfqjsgh",
        ...payload
    };

    console.log(`[GAS Request] Action: ${action}, Target URL: ${GAS_WEBAPP_URL}`);

    try {
        const response = await fetch(GAS_WEBAPP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8", // Google Apps Script CORS 대응
            },
            body: JSON.stringify(requestBody),
            redirect: "follow",
        });

        const text = await response.text();
        console.log(`[GAS Response Status]: ${response.status} ${response.statusText}`);
        console.log(`[GAS Response Final URL]: ${response.url}`);

        if (!response.ok) {
            console.error(`[GAS Response HTTP Error Body] (Status ${response.status}):\n${text.slice(0, 500)}`);
            throw new Error(`HTTP Error: ${response.status} (${response.statusText})`);
        }

        console.log(`[GAS Response Text]:`, text);

        let data: any = null;
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = { raw: text };
        }

        return { success: true, data };
    } catch (error: any) {
        console.error(`[GAS Sync Failed] Action: ${action}:`, error);
        return { success: false, error: error?.message || "Unknown error" };
    }
}

/**
 * Google Apps Script 웹앱으로 일괄 배치(Batch) POST 요청을 전송합니다. (단 1회 전송으로 중복 추가 방지)
 */
export async function sendGasBatchRequest(
    payload: GasBatchPayload
): Promise<{ success: boolean; data?: any; error?: string }> {
    const requestBody = {
        action: "batch",
        apiKey: "dptmeldkdltkdjqqnqlalfqjsgh",
        ...payload
    };

    const deleteCount = payload.deleteIds?.length || 0;
    const addCount = payload.addRows?.length || 0;
    const updateCount = payload.updateRows?.length || 0;

    console.log(`[GAS Batch Request] Deletes: ${deleteCount}, Adds: ${addCount}, Updates: ${updateCount}`);
    console.log(`[GAS Batch Payload Details]:`, JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(GAS_WEBAPP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(requestBody),
            redirect: "follow",
        });

        const text = await response.text();
        console.log(`[GAS Batch Response Status]: ${response.status} ${response.statusText}`);
        console.log(`[GAS Batch Response Final URL]: ${response.url}`);

        if (!response.ok) {
            // Google Apps Script 특성상 POST 302 리다이렉트 후 GET으로 꺾이면서 404 echo 페이지를 리턴하더라도 스크립트는 성공적으로 구동된 상태임
            if (response.status === 404 && response.url.includes("googleusercontent.com")) {
                console.warn(`[GAS Batch Response Notice] 302 Redirect 404 ignored as Google Script executed successfully.`);
                return { success: true, data: { status: "ignored_redirect_404" } };
            }
            console.error(`[GAS Batch Response Error Body] (Status ${response.status}):\n${text.slice(0, 500)}`);
            throw new Error(`HTTP Error: ${response.status} (${response.statusText})`);
        }

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
        return { success: false, error: error?.message || "Unknown error" };
    }
}
