# 위약금 수익 정산

딜러 설정의 **위약금 수익 정산 사용**을 켜고 저장한 뒤 Salesforce 동기화를 실행합니다. 기존 딜러와 신규 딜러 모두 기본값은 꺼짐입니다.

- Account.ManagingFranchise__c가 해당 딜러의 매칭값인 가맹점에 연결된 Case를 조회합니다.
- 해지 문의 RecordType.DeveloperName: TerminationInquiry.
- 정산 대상 상태: 해지완료, 해지완료(미회수).
- 위약금: Case.Penaltyfee__c. 0원, 빈값, 음수는 제외합니다.
- 위약금 입금 일자: Case.DepositDate__c. 현재 Salesforce 텍스트 필드입니다.
- 날짜 예시: 2026-09-02. YYYY/M/D, YYYY.M.D, YYYYMMDD, YYYY년 M월 D일도 읽습니다. 연·월·일이 모두 있어야 합니다.
- 입금일이 유효한 건을 입금 월에 반영합니다. 입금일이 비어 있거나 잘못되면 화면에 확인 필요로 표시하며 정산에서는 제외합니다.
- 총 수익에 위약금 원액을 더하고, 딜러 배분 수익에 위약금의 50%를 더합니다. 기존 최종 정산의 VAT와 선지급 처리 순서는 유지합니다.
- 월·연도·기간·전체 기간 집계 및 가맹점 정산금액에 반영됩니다. 정액 수당 딜러도 위약금 설정을 켜면 위약금은 50%를 적용합니다.
- 해지문의 Id는 고유 키입니다. 재동기화 시 상태·금액·입금일을 갱신하며, 같은 문의를 중복 합산하지 않습니다.
- 문의 상태가 대상 상태에서 벗어나거나 해당 딜러의 조회 대상에서 빠지면 다음 정상 동기화 후 반영되지 않습니다.
- 관리가맹점과 사업자번호가 유일하게 일치하는 수동 가맹점도 연결할 수 있습니다. 중복 사업자번호를 임의로 매칭하지 않습니다.
- 설치일자 기준과 기존 설치일자 동기화 로직은 변경하지 않았습니다. 계약 및 설치 전환일자(ContractInstall_Dt__c)를 유지합니다.

## 확인

`npm run build`

`node --test tests/salesforce-settlement.test.mjs tests/penalty-table.test.mjs tests/ui-components.test.mjs`

전체 마이그레이션을 SQLite에 적용해 신규 설정의 기본값과 문의 Id 고유성, 재동기화 갱신, 외래 키 관계를 확인했습니다. 전체 TypeScript 검사에는 기존 소스의 타입 오류와 Cloudflare 런타임 타입 선언 누락이 있습니다. 기존 rendered-html 테스트는 일반 Node에서 cloudflare:workers를 직접 불러오지 못하며, 위 명령의 기능 계산·화면·컴포넌트 테스트와 빌드는 통과했습니다.
