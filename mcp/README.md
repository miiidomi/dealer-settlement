# 딜러 정산 MCP

사이트에 저장된 자료로 정산금액·계산 근거·확인할 항목을 조회하고, 질문한 업무의 실행 순서를 안내합니다. 답변에는 계산 과정과 업무 배경도 짧게 함께 보여줍니다. 각 관리자는 본인 계정으로 로그인하며, 사이트의 활성 관리자만 전체 딜러를 조회할 수 있습니다.

**코드와 로컬 검증이 완료된 배포 준비본입니다. 운영 배포 및 실제 계정의 ChatGPT 연결은 아직 완료하지 않았습니다.**

## 파일 배치

ZIP 안의 `mcp` 폴더를 기존 GitHub 저장소 `miiidomi/dealer-settlement`의 최상위에 추가합니다. 각 파일은 부분 패치가 아닌 전체 파일입니다. 브라우저에서 GitHub의 **Add file → Upload files**로 폴더를 올릴 수 있습니다. 업로드 후 `mcp/package.json`과 `mcp/src/index.ts` 경로가 보이는지 확인합니다.

MCP가 기존 `app/settlement-calculation.ts` 등 공통 파일을 직접 가져옵니다. ZIP에 기존 사이트의 `app` 폴더는 포함하지 않습니다. 새 MCP Worker를 만들어 같은 GitHub 저장소의 `mcp` 폴더만 빌드합니다.

## 브라우저로 배포하기

### 1. MCP용 저장소 만들기

Cloudflare의 **Storage & databases → D1**에서 새 데이터베이스 `dealer-settlement-mcp-meta`를 만듭니다. 이 새 DB의 Console에서 `schema.sql`의 SQL을 순서대로 실행합니다. 로그인 연결 상태와 조회 기록을 보관하는 용도입니다.

**Storage & databases → KV**에서 새 Namespace를 만듭니다. 이름은 `dealer-settlement-mcp-oauth`로 지정하면 됩니다. 로그인 토큰을 보관합니다.

`mcp/wrangler.jsonc`의 아래 두 값만 실제 생성된 ID로 바꿉니다.

| 위치 | 넣을 값 |
|---|---|
| `MCP_META.database_id`의 모두 0인 값 | 새 D1의 Database ID |
| `OAUTH_KV.id`의 모두 0인 값 | 새 KV의 Namespace ID |

기존 정산 DB의 ID는 이미 들어 있습니다. `schema.sql`은 새 MCP용 DB에만 실행합니다.

### 2. 관리자 로그인 설정하기

Cloudflare **Zero Trust → Access controls → Applications → Create new application → SaaS application**에서 `딜러 정산 MCP`라는 OIDC 앱을 만듭니다.

- Redirect URL: `https://dealer-settlement-mcp.74-fb4.workers.dev/callback`
- Scopes: `openid`, `email`, `profile`
- Authorization code와 PKCE(S256)를 사용하도록 설정합니다. Client secret을 사용하는 구성을 유지합니다.
- Allow 정책에 실제 사용할 관리자 이메일 또는 관리자 그룹을 지정합니다.
- 앱이 제공하는 **Client ID, Client secret, Issuer**를 보관합니다. 기존 사이트의 Access 로그인 URL이나 AUD 대신 이 새 앱의 값을 사용합니다.

사이트의 계정 설정에도 동일한 이메일이 활성 관리자(`role=admin`, `active=true`)로 등록되어 있어야 합니다. 첫 로그인한 사람을 자동으로 관리자로 등록하지 않습니다.

### 3. 새 Worker를 GitHub와 연결하기

Cloudflare **Workers & Pages → Create application → GitHub 연결**에서 기존 저장소를 선택하고 새 Worker를 만듭니다.

| 설정 | 값 |
|---|---|
| Worker 이름 | `dealer-settlement-mcp` |
| 저장소 | `miiidomi/dealer-settlement` |
| 운영 브랜치 | `main` |
| Root directory | `mcp` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npm run deploy` |
| Build 환경변수 | `NODE_VERSION=24.19.0` |

`wrangler.jsonc`의 Worker 이름과 대시보드의 이름을 일치시킵니다. 새 Worker의 실제 주소가 위 주소와 다르면 `PUBLIC_BASE_URL`과 OIDC Redirect URL도 함께 바꿉니다.

### 4. Worker에 로그인 값 넣기

새 Worker의 **Settings → Variables and Secrets**에서 아래 런타임 값을 추가합니다. `ACCESS_CLIENT_SECRET`은 반드시 Secret으로 저장합니다. GitHub에 비밀 값을 업로드하지 않습니다.

| 이름 | 값 |
|---|---|
| `ACCESS_CLIENT_ID` | 새 OIDC 앱의 Client ID |
| `ACCESS_CLIENT_SECRET` | 새 OIDC 앱의 Client secret |
| `ACCESS_ISSUER` | 새 OIDC 앱이 표시하는 Issuer 전체 주소 |

Issuer는 보통 `https://dealer-settlement.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<Client ID>` 형태입니다. 실제 앱이 제공한 값과 일치시킵니다. 설정을 저장한 후 배포합니다.

Bindings에서 `DB`는 기존 정산 D1, `MCP_META`는 새 D1, `OAUTH_KV`는 새 KV인지 확인합니다. 새 MCP 주소 앞에 사이트용 Self-hosted Access 로그인 화면을 추가하면 ChatGPT의 연결 확인이 막힐 수 있습니다. 관리자 로그인은 위에서 만든 SaaS OIDC 앱으로 처리합니다.

### 5. ChatGPT에서 연결하기

ChatGPT의 **Plugins → + → Add custom MCP server**에서 다음과 같이 등록합니다. 메뉴가 보이지 않으면 해당 계정·워크스페이스의 사용자 정의 MCP 사용 권한을 확인합니다.

- 이름: `딜러 정산 조회`
- URL: `https://dealer-settlement-mcp.74-fb4.workers.dev/mcp`
- 인증: OAuth. 클라이언트 등록 선택이 있다면 DCR을 선택합니다. 위 Cloudflare OIDC Client secret은 ChatGPT 입력용 값이 아닙니다.
- 플러그인을 생성하고 설치한 뒤, 본인 관리자 계정으로 로그인합니다.
- 대화에서 `@`로 플러그인을 선택해 사용합니다.

같은 ChatGPT 워크스페이스의 관리자는 플러그인 게시 기능으로 공유할 수 있습니다. 각 사용자가 설치하고 본인 계정으로 로그인해야 합니다. 별도 계정을 사용한다면 각자 같은 MCP URL을 등록할 수 있습니다.

### 6. 실제 조회 확인하기

사이트와 같은 딜러·기간을 지정해 금액과 근거를 비교합니다. 다른 활성 관리자도 본인 계정으로 로그인해 조회되는지 확인합니다. 비관리자 또는 비활성 계정은 조회가 거절되어야 합니다.

## 사용 예

- “이정수 2026년 9월 정산금액과 계산 과정 알려줘.”
- “이 가맹점 금액이 왜 이렇게 나왔어?”
- “정산 전에 확인할 것과 해야 할 일 알려줘.”
- “납부자번호를 수정하려면 어디서 해야 해?”
- “지급 완료 후 금액이 바뀐 게 있어?”

아래는 **테스트 자료**로 만든 답변 예시이며 운영 금액이 아닙니다.

> 테스트 딜러의 2026년 9월 현재 정산액은 **27,500원**입니다.
>
> 납입 공급가액 100,000원의 50%인 50,000원을 수익으로, 설치 원가 50,000원의 50%인 25,000원을 비용으로 반영했습니다. 차액 25,000원에 VAT 2,500원을 더한 금액입니다.
>
> 실제 입금은 납입일 기준으로 정산합니다. 청구월이 8월이어도 9월에 납입한 금액은 9월 계산에 포함됩니다.

업무를 물으면 목적 → 해당 화면의 작업 순서 → 완료 확인 방법을 짧게 알려줍니다. 구체적인 계산 근거를 물으면 가맹점·제품·배분율·원가 출처·반영/제외 이유를 보여줍니다.

## 현재 지원 범위

정산 조회, 가맹점 검색, 계산 근거, 정산 전 점검, 지급 후 변경 비교, 납입 업로드 요약, 업무 안내, 용어 설명을 지원합니다. 실제 자료 변경·삭제·지급 완료·동기화는 사이트에서 수행하도록 안내합니다.

- 원본은 사이트 D1입니다. Salesforce를 실시간 조회했다고 표현하지 않습니다. 최신 관측 시각은 전체 동기화 성공을 뜻하지 않습니다.
- 운영 DB에는 SELECT만 실행합니다. OAuth와 조회 기록은 별도 DB/KV에 저장합니다. 조회 기록은 90일 후 정리합니다.
- DB 조회 실패를 0원으로 바꾸지 않습니다. 조회 기간은 최대 12개월이며, 상세 목록은 나눠 조회합니다.
- 기존 계산 함수를 그대로 사용합니다. 할부 정산월 배정 및 기간 VAT 반올림으로 금액 차이가 발생하는 경우 짧게 표시합니다. 기존 계산 자체를 수정한 배포본은 아닙니다.
- 기존 `payment_imports`에는 확인 필요 행의 개별 사유가 저장되지 않습니다. MCP도 실제 ‘6건’이 어느 행인지 추측하지 않습니다. 원본 Excel과 CMS 수정본의 사이트 배포 여부를 확인하도록 안내합니다.

## 검증

`npm run build`는 타입 검사, 인증·계산·SQL·MCP 프로토콜 테스트, 배포 번들 생성(dry run), 격리된 Workers 런타임 점검을 실행합니다. 검증용 DB는 운영 DB와 연결되지 않습니다.

2026-10-07 기준 로컬 테스트와 GitHub main의 공통 계산 코드 일치를 확인했습니다. 실제 Cloudflare OIDC 로그인, 운영 DB 스키마 상태, ChatGPT 계정 연결은 배포 후 위 6단계에서 확인해야 합니다.

## 참고 문서

- [Cloudflare Access와 MCP 로그인](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)
- [Cloudflare SaaS OIDC 설정](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/)
- [Workers GitHub 빌드 설정](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers Node 버전 설정](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [ChatGPT 사용자 정의 MCP 연결](https://developers.openai.com/api/docs/guides/custom-mcp-server)
