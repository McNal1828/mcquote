import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import db from "../db.server";

// 1. handle (커스텀 데이터 공유)
// 부모 라우트에서 useMatches() 훅을 통해 자식 페이지의 이 데이터를 읽어갈 수 있습니다.
// 주로 브레드크럼(Breadcrumb) 네비게이션이나 페이지 제목 동적 관리에 사용됩니다.
export const handle = {
    breadcrumb: () => "홈페이지",
};

// 2. links (리소스 연결)
// 이 페이지에 접속했을 때만 불러올 CSS, 외부 폰트, 파비콘 등을 정의합니다.
export const links: Route.LinksFunction = () => [
    // 예: { rel: "stylesheet", href: "/styles/home-custom.css" }
];

// 3. headers (HTTP 헤더 제어)
// 서버에서 브라우저로 응답할 때 보낼 HTTP 헤더를 설정합니다. (캐시 제어에 유용)
export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return {
        "Cache-Control": "max-age=3600, s-maxage=3600",
    };
}

// 4. meta (메타 태그 설정)
// 페이지의 제목(title), 설명(description) 등 HTML <meta> 태그를 설정합니다.
export function meta({ data }: Route.MetaArgs) {
    return [
        { title: "New React Router App" },
        { name: "description", content: "Welcome to React Router!" },
    ];
}

// 5. loader (데이터 불러오기 - GET 요청 시 실행)
// 화면을 그리기 전에 서버에서 필요한 데이터를 미리 가져오는 함수입니다.
export async function loader({ request }: Route.LoaderArgs) {
    // 서버 공간에서 실행되므로 DB 접속 로직이나 비밀 API 키를 안전하게 쓸 수 있습니다.
    // SQLite 데이터베이스에서 사용자 목록을 조회합니다.
    const stmt = db.prepare("SELECT * FROM users");
    const users = stmt.all();
    return { users };
}

// 페이지를 오가더라도 브라우저 메모리에 데이터를 유지하기 위해 모듈 스코프에 변수를 선언합니다.
let cachedHomeData: any = null;

// 5.5. clientLoader (클라이언트 전용 데이터 불러오기)
// 브라우저(클라이언트) 환경에서만 실행되는 함수입니다.
// localStorage 접근, 브라우저 전용 API 사용, 또는 서버 loader 데이터를 캐싱/가공할 때 주로 사용합니다.
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
    // 1. 이미 메모리에 캐싱된 데이터가 있다면, 서버 로더를 부르지 않고 즉시 반환합니다.
    if (cachedHomeData) {
        console.log("⚡️ 메모리에 캐싱된 데이터를 사용합니다!");
        return cachedHomeData;
    }

    console.log("🌐 서버에서 데이터를 새로 가져옵니다...");
    // serverLoader()를 호출하면 위에서 정의한 서버의 loader 데이터를 먼저 받아올 수 있습니다.
    const serverData = await serverLoader();

    // 브라우저 환경에서만 얻을 수 있는 추가 데이터 세팅 (예: window.innerWidth 등)
    const clientMessage = "브라우저(clientLoader)에서 추가된 데이터입니다!";

    // 2. 처음 가져온 데이터를 캐시 변수에 저장해 둡니다.
    cachedHomeData = { ...serverData, clientMessage };
    return cachedHomeData;
}

// 새로고침(초기 로딩) 시에도 clientLoader를 강제로 실행하도록 설정합니다.
clientLoader.hydrate = true;

// clientLoader가 데이터를 가져오는 아주 짧은 순간 동안 화면에 띄워줄 로딩 UI입니다.
export function HydrateFallback() {
    return (
        <div className="p-8 text-center text-gray-500 font-bold">
            클라이언트 데이터를 불러오는 중... ⏳
        </div>
    );
}

// 6. action (데이터 변경하기 - POST, PUT, DELETE 요청 시 실행)
// 사용자가 폼(Form)을 제출하여 데이터를 서버로 보낼 때 실행되는 함수입니다.
export async function action({ request }: Route.ActionArgs) {
    const formData = await request.formData();
    const userName = formData.get("userName");

    // 데이터 검증 실패 예시
    if (typeof userName !== "string" || userName.trim().length === 0) {
        return { error: "이름을 필수로 입력해주세요!" };
    }

    // SQLite DB에 새로운 사용자를 추가합니다.
    const insert = db.prepare("INSERT INTO users (name, role) VALUES (?, ?)");
    insert.run(userName, "New User");

    // DB 저장 성공 시 보통 return redirect('/success') 등으로 다른 페이지로 보냅니다.
    // 여기서는 성공 메시지를 그대로 화면에 반환해보겠습니다.
    return {
        success: `안녕하세요, ${userName}님! DB에 성공적으로 저장되었습니다. (새로고침하여 확인)`,
    };
}

// 7. 메인 컴포넌트 (UI 렌더링)
// loader와 action에서 반환한 데이터는 Route.ComponentProps를 통해 자동으로 주입됩니다.
export default function Home({ loaderData, actionData }: Route.ComponentProps) {
    return (
        <div className="p-4">
            {/* About 페이지로 이동하는 네비게이션 버튼 */}
            <div className="max-w-2xl mx-auto mt-4 text-right">
                <Link
                    to="/about"
                    className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 inline-block transition-colors"
                >
                    About 페이지로 이동 👉
                </Link>
            </div>

            <div className="mt-8 p-6 bg-gray-100 dark:bg-gray-800 rounded-lg max-w-2xl mx-auto">
                <h2 className="text-2xl font-bold mb-4 dark:text-white">
                    라우트 기능 테스트
                </h2>

                {/* SQLite DB에서 가져온 데이터 출력 */}
                <div className="mb-4">
                    <p className="text-lg font-bold dark:text-white mb-2">
                        💡 SQLite 유저 목록:
                    </p>
                    <ul className="list-disc pl-5 text-gray-700 dark:text-gray-300">
                        {loaderData.users.map((user: any) => (
                            <li key={user.id} className="mb-1">
                                {user.name}{" "}
                                <span className="text-sm text-gray-500">
                                    ({user.role})
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* clientLoader에서 덧붙인 데이터 출력 */}
                <p className="mb-4 text-purple-600 dark:text-purple-400 font-medium">
                    📱 Client Loader 데이터: {loaderData.clientMessage}
                </p>

                {/* action을 발생시키는 Form. 일반 HTML form 대신 React Router의 Form을 사용합니다. */}
                <Form method="post" className="flex flex-col gap-4">
                    <label
                        htmlFor="userName"
                        className="text-sm font-medium dark:text-gray-300"
                    >
                        이름 입력 (Action 테스트)
                    </label>
                    <input
                        type="text"
                        name="userName"
                        id="userName"
                        placeholder="이름을 입력하세요"
                        className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    />
                    <button
                        type="submit"
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                        서버로 전송하기
                    </button>
                </Form>

                {/* action에서 반환한 데이터(성공 또는 에러) 출력 */}
                {actionData?.error && (
                    <p className="mt-4 text-red-500">{actionData.error}</p>
                )}
                {actionData?.success && (
                    <p className="mt-4 text-green-600 dark:text-green-400">
                        {actionData.success}
                    </p>
                )}
            </div>
        </div>
    );
}

// 8. ErrorBoundary (에러 처리)
// 이 페이지를 렌더링하거나, loader/action을 실행하다가 에러가 났을 때 보여줄 대체 UI입니다.
// 앱 전체가 하얗게 멈추는 것을 방지합니다.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    return (
        <div className="p-4 bg-red-100 text-red-700 border border-red-400 rounded max-w-2xl mx-auto mt-10">
            <h2 className="text-xl font-bold">오류가 발생했습니다!</h2>
            <p>Home 페이지를 처리하는 중 문제가 생겼습니다.</p>
        </div>
    );
}
