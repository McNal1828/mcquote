/**
 * ==============================================================================
 * remix-auth 기반 인증(Authentication) 핵심 서비스 샘플 코드
 * ==============================================================================
 * 
 * 📌 [필요 패키지 설치 방법]
 * 로그인 기능을 실제 적용하기로 결정하시면 터미널에서 아래 라이브러리를 설치합니다:
 * npm install remix-auth remix-auth-form bcryptjs
 * npm install -D @types/bcryptjs
 * 
 * 📌 [작동 원리]
 * 1. createCookieSessionStorage: 로그인 상태(userId)를 안전한 HTTP-Only 쿠키에 저장합니다.
 * 2. Authenticator: remix-auth의 핵심 클래스로, 사용자 세션 검증/로그인/로그아웃을 총괄합니다.
 * 3. FormStrategy: 로그인 페이지 폼(<form method="post">)으로 제출된 username/password를
 *    전달받아 DB(SQLite)의 users 테이블과 비밀번호(bcrypt)를 검증합니다.
 * 
 * ==============================================================================
 */

import { Authenticator } from "remix-auth";
import { FormStrategy } from "remix-auth-form";
import { createCookieSessionStorage, redirect } from "react-router";
// 기존 DB 연결 파일 호출 (프로젝트의 db.server.ts 사용)
import db from "../db.server";
import bcrypt from "bcryptjs";

// 1. 사용자 객체 타입 정의
export interface UserSession {
    id: number;
    username: string;
    name: string;
    role: string; // 'admin' | 'user'
    email?: string;
}

// 2. 세션 쿠키 스토리지 생성 (HTTP-Only 쿠키로 XSS 공격 방지)
export const sessionStorage = createCookieSessionStorage({
    cookie: {
        name: "__mcquote_session", // 브라우저에 저장될 쿠키 이름
        httpOnly: true,             // JavaScript(document.cookie)로 접근 불가능하게 설정
        path: "/",                  // 전역 사이트에 적용
        sameSite: "lax",            // CSRF 방어
        secrets: [process.env.SESSION_SECRET || "mcquote-secret-key-1234"], // 암호화 시크릿 키
        secure: process.env.NODE_ENV === "production", // HTTPS 환경에서만 전송 (운영 환경)
        maxAge: 60 * 60 * 24 * 7,   // 7일간 로그인 상태 유지
    },
});

// 3. Authenticator 인스턴스 생성
export const authenticator = new Authenticator<UserSession>(sessionStorage);

// 4. FormStrategy (아이디/비밀번호 입력 폼 인증 전략) 등록
authenticator.use(
    new FormStrategy(async ({ form }) => {
        const username = form.get("username") as string;
        const password = form.get("password") as string;

        // 아이디 / 비밀번호 미입력 시 예외 처리
        if (!username || !password) {
            throw new Error("아이디와 비밀번호를 모두 입력해 주세요.");
        }

        // DB에서 해당 사용자 조회
        const user = db.prepare("SELECT * FROM users WHERE username = ? AND available = 1").get(username) as any;

        if (!user) {
            throw new Error("존재하지 않거나 비활성화된 계정입니다.");
        }

        // 비밀번호 해시 비교 (bcrypt.compareSync)
        const isValidPassword = bcrypt.compareSync(password, user.password_hash);
        if (!isValidPassword) {
            throw new Error("비밀번호가 올바르지 않습니다.");
        }

        // 인증 성공 시 세션에 저장할 사용자 정보 반환
        return {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            email: user.email,
        };
    }),
    "user-pass" // 전략 이름 (action에서 authenticator.authenticate("user-pass", request)로 사용)
);

/**
 * 📌 [다른 라우트 파일에서 사용 방법 가이드]
 * 
 * 1) 로그인 여부 확인 및 자동 리다이렉트 (Protected Page - 예: home.tsx, ams.tsx 등)
 * ------------------------------------------------------------------------------
 * export async function loader({ request }: Route.LoaderArgs) {
 *     // 로그인되지 않은 사용자가 접근하면 /login 페이지로 자동으로 튕겨 보냅니다.
 *     const user = await authenticator.isAuthenticated(request, {
 *         failureRedirect: "/login",
 *     });
 *     
 *     // 로그인된 유저 정보를 페이지 컴포넌트로 전달
 *     return { user };
 * }
 * 
 * 2) 관리자 권한(Admin) 전용 페이지 제한 (RBAC - Role Based Access Control)
 * ------------------------------------------------------------------------------
 * export async function action({ request }: Route.ActionArgs) {
 *     const user = await authenticator.isAuthenticated(request, { failureRedirect: "/login" });
 *     if (user.role !== "admin") {
 *         return { error: "관리자 권한이 필요합니다." };
 *     }
 *     // ... 관리자 삭제/수정 작업 진행
 * }
 */
