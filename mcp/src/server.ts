import { RECORD_SECTIONS, recordPage, savedSnapshot, syncStatus, COVERAGE, type RecordSection } from "./records.ts";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError, READ_SCOPE, VERSION, siteLink, type Env, type Identity } from "./env.ts";
import { requireAdmin, validateRange } from "./policy.ts";
import { installationDetails, listDealers, loadDashboard, paymentImportRows, resolveDealer, searchMerchants } from "./data.ts";
import { explanationRows, freshness, paidChanges, settlementIssues, settlementSummary } from "./settlement.ts";
import { GLOSSARY, INSTRUCTIONS, TASK_GUIDES, type Task } from "./instructions.ts";

const dealer=z.union([z.string().trim().min(1).max(100),z.number().int().positive()]).describe("딜러 이름 또는 ID. 모호하면 먼저 list_dealers로 후보 확인");
const month=z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).describe("YYYY-MM. 이번 달의 의미가 불명확하면 사용자에게 확인");
const paging={offset:z.number().int().min(0).max(50000).default(0),limit:z.number().int().min(1).max(100).default(20)};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const meta={securitySchemes:[{type:"oauth2",scopes:[READ_SCOPE]}]};

export function createServer(env:Env,identity:Identity) {
  const server=new McpServer({name:"딜러 정산 조회",version:VERSION},{instructions:INSTRUCTIONS});
  async function run(tool:string,args:Record<string,unknown>,fn:()=>Promise<Record<string,unknown>>) {
    // Re-check on every tool, including pure guidance and glossary tools.
    await requireAdmin(env.DB,identity.email,identity.memberId);
    const id=crypto.randomUUID(),createdAt=new Date().toISOString();
    const cutoff=new Date(Date.now()-60000).toISOString();
    const recent=await env.MCP_META.prepare("SELECT count(*) n FROM mcp_audit WHERE member_id=? AND created_at>=?")
      .bind(identity.memberId,cutoff).first<{n:number}>();
    if ((recent?.n??0)>=60) return {isError:true,content:[{type:"text" as const,text:"조회 요청이 많습니다. 잠시 후 다시 시도해 주세요."}]};
    await env.MCP_META.prepare("INSERT INTO mcp_audit(id,member_id,email,tool,dealer_id,start_month,end_month,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id,identity.memberId,identity.email,tool,typeof args.dealer==="number"?args.dealer:null,
        args.startMonth??args.month??null,args.endMonth??args.month??null,"started",createdAt).run();
    try {
      const result=await fn();
      await env.MCP_META.prepare("UPDATE mcp_audit SET outcome='success' WHERE id=?").bind(id).run();
      return {content:[{type:"text" as const,text:JSON.stringify(result)}],structuredContent:result};
    } catch (error) {
      await env.MCP_META.prepare("UPDATE mcp_audit SET outcome='error' WHERE id=?").bind(id).run();
      const message=error instanceof AppError?error.message:"자료를 조회하지 못했습니다. 데이터베이스 연결·스키마를 확인해 주세요.";
      return {isError:true,content:[{type:"text" as const,text:message}],structuredContent:{status:"unavailable",message}};
    }
  }
  const config=<S extends z.ZodRawShape>(description:string,inputSchema:S)=>({description,inputSchema,annotations,_meta:meta});

  server.registerTool("list_dealers",config("조회할 딜러를 선택할 때 사용. 이름과 주요 설정만 반환합니다.",{}),
    ()=>run("list_dealers",{},async()=>({dealers:await listDealers(env.DB),nextQuestion:"어느 딜러의 어떤 기간을 확인할까요?"})));

  server.registerTool("find_merchants",config("가맹점 이름·사업자번호 검색 또는 명의변경 여부(Y/N)로 조회. 명의변경 가맹점은 ownershipTransfer=Y를 사용하고 이름이 없으면 query를 생략합니다.",
    {query:z.string().trim().max(100).default(""),dealer:dealer.optional(),ownershipTransfer:z.enum(["Y","N"]).optional().describe("명의변경 여부. 설치제품 중 유효한 명의변경 Y가 하나라도 있으면 가맹점 Y"),...paging}),
    args=>run("find_merchants",args,async()=>{
      const dealerId=args.dealer===undefined?undefined:await resolveDealer(env.DB,args.dealer);
      const result=await searchMerchants(env.DB,args.query,dealerId,args.offset,args.limit,args.ownershipTransfer);
      return {...result,rows:result.rows.map(r=>({...r,siteUrl:siteLink(env,Number(r.id))}))};
    }));

  server.registerTool("get_merchant_details",config("가맹점의 전체 설치제품·명의변경 여부·자산 상태·원가 제외·납부자번호·납입·청구·위약금 상세 조회. 기간 제한 없이 선택한 section을 페이지 조회합니다.",
    {merchantId:z.number().int().positive(),dealer:dealer.optional(),section:z.enum(["installations","payerAccounts","payments","billings","cancellationPenalties"]).default("installations"),...paging}),
    args=>run("get_merchant_details",args,async()=>{
      const merchant=await env.DB.prepare("SELECT dealer_id FROM merchants WHERE id=?").bind(args.merchantId).first<{dealer_id:number}>();
      if (!merchant) throw new AppError(404,"가맹점을 찾지 못했습니다.");
      const id=args.dealer===undefined?merchant.dealer_id:await resolveDealer(env.DB,args.dealer);
      if (id!==merchant.dealer_id) throw new AppError(404,"이 딜러의 가맹점을 찾지 못했습니다.");
      const data=await loadDashboard(env.DB,id,identity);
      const installations=data.installations.filter(x=>x.merchantId===args.merchantId);
      const rows=args.section==="installations"?installations.map(x=>installationDetails(data,x))
        :data[args.section].filter(x=>x.merchantId===args.merchantId);
      return {merchant:data.merchants.find(x=>x.id===args.merchantId),dealerName:data.dealers[0].name,
        ownershipTransfer:installations.some(x=>installationDetails(data,x).ownershipTransfer==="Y")?"Y":"N",
        scope:"all_saved_history",section:args.section,rows:rows.slice(args.offset,args.offset+args.limit),totalRows:rows.length,
        nextOffset:args.offset+args.limit<rows.length?args.offset+args.limit:null,
        ...freshness(data),siteUrl:siteLink(env,args.merchantId)};
    }));

  server.registerTool("get_records",config("사이트에 저장된 모든 업무 자료를 종류별로 페이지 조회: 딜러 전체 설정·은행/화면/Salesforce 매핑, 배분율 이력, 제품·공통/딜러/제품군 원가 이력, 정액 수당 규칙, 가맹점·설치제품·청구·납부자·납입, 선지급, 월별 지급·세금계산서·메모, VAN 전체 실적, 위약금, Excel 업로드 전체 정보, 사용자 권한 목록, 납부자 동기화 보호 설정. 금액은 DB 원본값입니다. 딜러 생략 시 전체 자료이며 계산 금액은 get_settlement를 사용합니다.",
    {section:z.enum(Object.keys(RECORD_SECTIONS) as [RecordSection,...RecordSection[]]),dealer:dealer.optional(),merchantId:z.number().int().positive().optional(),productId:z.number().int().positive().optional(),...paging}),
    args=>run("get_records",args,async()=>{
      const dealerId=args.dealer===undefined?undefined:await resolveDealer(env.DB,args.dealer);
      return {...await recordPage(env.DB,args.section,{dealerId,merchantId:args.merchantId,productId:args.productId},args.offset,args.limit),siteUrl:siteLink(env,args.merchantId)};
    }));
  server.registerTool("get_settlement_snapshot",config("월별 지급 당시 또는 마지막 확인 당시 저장된 산출내역과 총액을 조회. 없으면 과거 금액을 추정하지 않습니다.",
    {dealer,month,kind:z.enum(["paid","reviewed"]).default("paid"),...paging}),
    args=>run("get_settlement_snapshot",args,async()=>{
      const id=await resolveDealer(env.DB,args.dealer);
      return {...await savedSnapshot(env.DB,id,args.month,args.kind,args.offset,args.limit),siteUrl:siteLink(env)};
    }));
  server.registerTool("get_sync_status",config("딜러 또는 전체 가맹점·설치제품·위약금의 저장된 동기화 시각을 집계합니다. 작업별 성공/실패 로그는 저장되지 않습니다.",{dealer:dealer.optional()}),
    args=>run("get_sync_status",args,async()=>syncStatus(env.DB,args.dealer===undefined?undefined:await resolveDealer(env.DB,args.dealer))));
  server.registerTool("get_data_coverage",config("MCP가 조회할 수 있는 전체 정보 종류와 DB에 저장되지 않는 상세 이력·조회 한계를 확인합니다.",{}),
    ()=>run("get_data_coverage",{},async()=>COVERAGE));

  server.registerTool("get_settlement",config("딜러·기간의 정산금액과 짧은 계산 과정 조회. 임의 계산을 하지 말고 이 결과를 사용합니다.",
    {dealer,startMonth:month,endMonth:month}),args=>run("get_settlement",args,async()=>{
      validateRange(args.startMonth,args.endMonth);
      const id=await resolveDealer(env.DB,args.dealer),data=await loadDashboard(env.DB,id,identity);
      return settlementSummary(data,id,args.startMonth,args.endMonth,env);
    }));

  server.registerTool("explain_settlement",config("금액이 나온 이유, 원본 필드, 배분율, 원가 출처, 제외 사유를 확인할 때 사용. 요청한 가맹점만 필터할 수 있습니다.",
    {dealer,startMonth:month,endMonth:month,merchantId:z.number().int().positive().optional(),...paging}),
    args=>run("explain_settlement",args,async()=>{
      validateRange(args.startMonth,args.endMonth);
      const id=await resolveDealer(env.DB,args.dealer),data=await loadDashboard(env.DB,id,identity);
      if (args.merchantId!==undefined&&!data.merchants.some(x=>x.id===args.merchantId)) throw new AppError(404,"이 딜러의 가맹점을 찾지 못했습니다.");
      const rows=explanationRows(data,id,args.startMonth,args.endMonth,env,args.merchantId);
      const summary=settlementSummary(data,id,args.startMonth,args.endMonth,env);
      return {scope:args.merchantId===undefined?"dealer":"merchant_evidence",merchantId:args.merchantId??null,
        calculationSteps:summary.calculationSteps,
        explanation:args.merchantId===undefined?summary.why:"이 가맹점의 근거만 보여줍니다. 딜러 공통 선지급·VAN피를 가맹점에 임의 배분하지 않습니다. 산식 금액은 딜러 전체 기준입니다.",
        rows:rows.slice(args.offset,args.offset+args.limit),totalRows:rows.length,
        nextOffset:args.offset+args.limit<rows.length?args.offset+args.limit:null,calcWarnings:summary.calcWarnings,
        ...freshness(data)};
    }));

  server.registerTool("check_settlement",config("정산 전 확인할 항목을 찾을 때 사용. 0원 등록 원가와 원가 미등록을 구분하고 딜러별 수당·VAN 설정을 적용합니다.",
    {dealer,startMonth:month,endMonth:month,...paging}),args=>run("check_settlement",args,async()=>{
      validateRange(args.startMonth,args.endMonth);
      const id=await resolveDealer(env.DB,args.dealer),data=await loadDashboard(env.DB,id,identity);
      const checks=settlementIssues(data,id,args.startMonth,args.endMonth,env);
      return {answer:`확인할 항목이 ${checks.issues.length}건 있습니다. 자료 누락 후보와 정상 대기 건을 구분해 확인합니다.`,
        issues:checks.issues.slice(args.offset,args.offset+args.limit),totalRows:checks.issues.length,
        nextOffset:args.offset+args.limit<checks.issues.length?args.offset+args.limit:null,
        pendingInstallments:checks.pendingInstallments,calcWarnings:checks.calcWarnings,
        why:"수익·원가의 누락 또는 설정 불일치가 정산금액에 영향을 주기 때문입니다.",...freshness(data)};
    }));

  server.registerTool("get_paid_changes",config("지급 완료 후 금액·산출내역 변경 확인. 지급 당시 저장된 자료가 없으면 비교 불가로 표시합니다.",
    {dealer,month,...paging}),args=>run("get_paid_changes",args,async()=>{
      validateRange(args.month,args.month);
      const id=await resolveDealer(env.DB,args.dealer),data=await loadDashboard(env.DB,id,identity),change=paidChanges(data,id,args.month);
      return {...change,differencesSinceReview:change.differencesSinceReview.slice(args.offset,args.offset+args.limit),
        differencesSincePayment:change.differencesSincePayment.slice(args.offset,args.offset+args.limit),
        totalRows:Math.max(change.differencesSincePayment.length,change.differencesSinceReview.length),
        totalSincePayment:change.differencesSincePayment.length,totalSinceReview:change.differencesSinceReview.length,
        nextOffset:args.offset+args.limit<Math.max(change.differencesSincePayment.length,change.differencesSinceReview.length)?args.offset+args.limit:null,
        calcWarnings:settlementSummary(data,id,args.month,args.month,env).calcWarnings,...freshness(data),siteUrl:siteLink(env)};
    }));

  server.registerTool("get_payment_imports",config("납입 Excel 업로드 결과와 확인 필요 건수 조회. 현재 DB는 행별 사유를 저장하지 않으므로 상세 번호를 추측하지 않습니다.",
    {dealer,...paging}),args=>run("get_payment_imports",args,async()=>{
      const id=await resolveDealer(env.DB,args.dealer),rows=await paymentImportRows(env.DB,id,args.offset,args.limit);
      return {imports:rows.slice(0,args.limit),nextOffset:rows.length>args.limit?args.offset+args.limit:null,
        exceptionDetails:{status:"not_persisted",message:"현재 사이트 DB에는 확인 필요 행별 번호와 사유가 저장되지 않습니다.",
          nextAction:"사이트에서 원본 Excel을 다시 선택해 ‘확인 필요만 보기’로 확인합니다. 해당 기능이 포함된 CMS 수정본의 배포 여부도 확인합니다."},
        queriedAt:new Date().toISOString(),siteUrl:siteLink(env)};
    }));

  server.registerTool("guide_task",config("하려는 업무의 이유·실행 순서·완료 확인 방법 안내. 질문한 업무만 설명하고 실제 변경은 하지 않습니다. 정산 업무는 조건을 받으면 현재 상태도 점검합니다.",
    {task:z.enum(["정산","납입업로드","납부자수정","제품수정","원가등록","VAN등록","선급금","동기화","관리자추가"]),
      dealer:dealer.optional(),month:month.optional(),merchantId:z.number().int().positive().optional()}),
    args=>run("guide_task",args,async()=>{
      const guide=TASK_GUIDES[args.task as Task];
      let actual:Record<string,unknown>|undefined;
      let resolvedId:number|undefined;
      if (args.dealer!==undefined) resolvedId=await resolveDealer(env.DB,args.dealer);
      else if (args.merchantId!==undefined) {
        const row=await env.DB.prepare("SELECT dealer_id FROM merchants WHERE id=?").bind(args.merchantId).first<{dealer_id:number}>();
        if (!row) throw new AppError(404,"가맹점을 찾지 못했습니다.");
        resolvedId=row.dealer_id;
      }
      if (resolvedId!==undefined) {
        if (args.month!==undefined) validateRange(args.month,args.month);
        const id=resolvedId,data=await loadDashboard(env.DB,id,identity);
        if (args.merchantId!==undefined&&!data.merchants.some(x=>x.id===args.merchantId)) throw new AppError(404,"이 딜러의 가맹점을 찾지 못했습니다.");
        if (args.task==="정산"&&args.month!==undefined) {
          const checks=settlementIssues(data,id,args.month,args.month,env);
          actual={checkCount:checks.issues.length,firstItems:checks.issues.slice(0,5),calcWarnings:checks.calcWarnings};
        }
        if (args.task==="VAN등록") actual={enabled:data.dealers[0].vanSettlementEnabled,
          instruction:data.dealers[0].vanSettlementEnabled?"해당 정산월의 등록 실적을 확인합니다.":"이 딜러는 VAN 정산 미사용으로 등록할 업무가 없습니다."};
        if (args.task==="선급금") actual={enabled:data.dealers[0].advanceEnabled};
        if (args.task==="제품수정"&&args.merchantId!==undefined) actual={sources:[...new Set(data.installations.filter(x=>x.merchantId===args.merchantId).map(x=>x.source))]};
      }
      return {task:args.task,why:guide.why,steps:guide.steps,...(actual?{currentState:actual}:{}),
        ...(!args.dealer&&!["관리자추가","납부자수정","제품수정"].includes(args.task)?{nextQuestion:"어느 딜러의 업무인가요?"}:{}),
        ...(args.dealer&&!args.month&&["정산","VAN등록","선급금"].includes(args.task)?{nextQuestion:"어느 정산 대상월인가요?"}:{}),
        siteUrl:siteLink(env,args.merchantId)};
    }));

  server.registerTool("explain_term",config("질문에 필요한 정산 용어를 한두 문장으로 설명합니다.",{term:z.enum(Object.keys(GLOSSARY) as [string,...string[]])}),
    args=>run("explain_term",args,async()=>({term:args.term,...GLOSSARY[args.term]})));

  server.registerResource("사용 안내","settlement://guide",{mimeType:"text/plain",description:"간결한 답변과 업무 안내 기준"},
    async()=>{await requireAdmin(env.DB,identity.email,identity.memberId);return {contents:[{uri:"settlement://guide",mimeType:"text/plain",text:INSTRUCTIONS}]};});
  server.registerResource("용어 설명","settlement://glossary",{mimeType:"application/json",description:"질문에 필요한 정산 용어 설명"},
    async()=>{await requireAdmin(env.DB,identity.email,identity.memberId);return {contents:[{uri:"settlement://glossary",mimeType:"application/json",text:JSON.stringify(GLOSSARY)}]};});
  for (const [name,title,request] of [["정산전점검","정산 전 점검","정산 전 확인할 사항과 이유, 다음 행동을 간결하게 알려줘."],
    ["계산근거","금액의 계산 근거","정산금액과 실제 계산 과정, 적용 규칙을 짧게 설명해줘."],
    ["지급후변경","지급 후 변경 확인","지급 완료 이후 바뀐 금액과 변경 근거를 알려줘."]] as const) {
    server.registerPrompt(name,{title,description:request,argsSchema:{dealer:z.string(),month:z.string()}},args=>({
      messages:[{role:"user" as const,content:{type:"text" as const,text:`${args.dealer} ${args.month}: ${request}`}}]}));
  }
  return server;
}
