# McQuote - 견적 관리 시스템

McQuote는 복잡한 견적서와 원가표 작성 업무를 자동화하고, 고객사, 파트너사 및 벤더 담당자 정보를 통합적으로 관리하기 위해 개발된 풀스택(Full-stack) 애플리케이션입니다.

## 🚀 주요 기능

- **견적 관리**: 견적(원가표) 등록, 다중 제품 상세 입력, 마진/PPC/DC 역산 자동화
- **엑셀 자동화**: 저장된 견적 데이터를 바탕으로 템플릿 기반 원가표 및 견적서 Excel 파일 자동 생성
- **고객 및 파트너망 관리**: 고객사, 파트너사, 벤더(Broadcom, Omnissa 등), AM, 총판 담당자 통합 관리
- **통계 대시보드**: 기간별, 벤더별, 파트너사별, 담당자별 견적 발생 횟수 및 요약 정보 제공
- **UI/UX**: 다크 모드/라이트 모드 지원 및 반응형 웹 디자인 적용

## 🛠 기술 스택

- **Framework**: React Router v7 (SSR & Data Mutations)
- **Language**: TypeScript
- **Database**: SQLite (`better-sqlite3`)
- **Styling**: Tailwind CSS
- **Excel Export**: `exceljs`

## 📁 폴더 구조

```text
mcquote/
├── app/
│   ├── routes/                # 라우트 및 페이지 컴포넌트, API 엔드포인트
│   │   ├── api.download.ts    # 개별 원가표/견적서 엑셀 다운로드 API
│   │   ├── api.home.download.ts # 견적 목록 엑셀 다운로드 API
│   │   ├── home.tsx           # 견적 목록 및 상세/수정 페이지
│   │   ├── quoting.tsx        # 신규 견적 등록 페이지
│   │   ├── stats.tsx          # 통계 대시보드
│   │   └── ...                # 기타 파트너/AM/제품 관리 페이지
│   ├── db.server.ts           # SQLite 데이터베이스 설정 및 스키마 초기화
│   └── root.tsx               # 최상위 레이아웃, 네비게이션, 로그인 로직
├── public/                    # 정적 파일 (엑셀 템플릿 등)
│   ├── cost.xlsx              # 원가표 템플릿 파일
│   └── quote.xlsx             # 견적서 템플릿 파일
├── package.json
└── tailwind.config.ts
```

## 🔌 주요 API 명세

| HTTP Method | Endpoint                   | Description                                                                           |
| :---------- | :------------------------- | :------------------------------------------------------------------------------------ |
| **GET**     | `/api/home/download`       | 견적 목록 페이지의 검색/필터/정렬 조건이 적용된 리스트를 엑셀 파일로 반환합니다.      |
| **POST**    | `/api/download?type=cost`  | 전송된 제품 배열 및 견적 데이터를 `cost.xlsx` 템플릿에 매핑하여 원가표를 반환합니다.  |
| **POST**    | `/api/download?type=quote` | 전송된 제품 배열 및 견적 데이터를 `quote.xlsx` 템플릿에 매핑하여 견적서를 반환합니다. |

---

## ⚠️ 저작권 및 라이선스 (Copyright & License)

**Copyright &copy; 2026 McNal (신동한). All rights reserved.**

이 프로젝트의 모든 소스 코드, UI/UX 디자인, 데이터베이스 스키마 및 관련 문서에 대한 **모든 저작권과 지적 재산권은 McNal(신동한)에게 귀속**되어 있습니다.

- **무단 사용 금지**: 원저작자의 명시적이고 사전적인 서면 허가 없이 본 프로젝트의 소스 코드를 복제, 배포, 전송, 수정, 포크(Fork)하는 모든 행위를 엄격하게 금지합니다.
- **변경 및 배포 금지**: 상업적, 비상업적 목적을 불문하고 본 시스템을 무단으로 이용하거나 일부를 변형(2차적 저작물 작성)하여 사용하는 것을 절대 금지합니다.

허가 없이 본 프로젝트의 코드를 무단 사용하는 경우, 관련 저작권법에 따라 민형사상의 법적 책임을 물을 수 있습니다.
