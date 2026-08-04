/**
 * ==============================================================================
 * remix-auth OAuth 2.0 (Google / Microsoft 등) 연동 예시 샘플 코드
 * ==============================================================================
 * 
 * 📌 [설명]
 * remix-auth는 전략(Strategy) 모듈을 추가 설치하는 방식으로
 * 구글, 마이크로소프트, 카카오, 네이버 등 거의 모든 OAuth 2.0을 간편하게 연동할 수 있습니다.
 * 
 * 예: Google OAuth 연동 시 필요 패키지:
 * npm install remix-auth-google
 * ==============================================================================
 */

import { GoogleStrategy } from "remix-auth-google";
import { authenticator, type UserSession } from "./auth.server.sample";
import db from "../db.server";

// Google OAuth 2.0 전략 등록 예시
authenticator.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "YOUR_GOOGLE_CLIENT_SECRET",
            callbackURL: "http://localhost:5173/auth/google/callback",
        },
        async ({ accessToken, refreshToken, extraParams, profile }) => {
            // Google 프로필 정보 수신 (profile.emails[0].value, profile.displayName 등)
            const email = profile.emails[0].value;
            const name = profile.displayName;

            // 1. DB에서 기존 사용자 조회 또는 자동 가입 처리
            let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;

            if (!user) {
                // 사내 도메인 제한이 필요한 경우 (예: @company.com)
                // if (!email.endsWith("@company.com")) throw new Error("사내 이메일 계정만 로그인 가능합니다.");

                const stmt = db.prepare(`
                    INSERT INTO users (username, password_hash, name, role, email, available, create_timestamp)
                    VALUES (?, ?, ?, 'user', ?, 1, ?)
                `);
                const result = stmt.run(email, "OAUTH_USER", name, email, Date.now());
                user = { id: Number(result.lastInsertRowid), username: email, name, role: "user", email };
            }

            return {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role,
                email: user.email,
            };
        }
    ),
    "google" // 전략 이름
);
