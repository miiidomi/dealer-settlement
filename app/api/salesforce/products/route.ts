import { env } from "cloudflare:workers";
import { AccessError, assertAdmin, requireAppAccess } from "../../access";

type SalesforceToken = { access_token: string; instance_url: string };
type SalesforceQuery<T> = { records: T[] };
type SalesforceProduct = {
  Id: string;
  Name: string;
  Family: string | null;
  Type__c: string | null;
};

function runtimeValue(name: string) {
  return String((env as unknown as Record<string, unknown>)[name] ?? "").trim();
}

async function getToken(
  loginUrl: string,
  clientId: string,
  clientSecret: string,
) {
  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Salesforce 인증에 실패했습니다. Connected App과 실행 사용자를 확인해주세요.",
    );
  return (await response.json()) as SalesforceToken;
}

function escapeSoqlLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export async function GET(request: Request) {
  try {
    const access = await requireAppAccess();
    assertAdmin(access);
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const familiesOnly = params.get("families") === "1";
    if (!query && !familiesOnly)
      return Response.json({ products: [] });

    const loginUrl = runtimeValue("SF_LOGIN_URL").replace(/\/$/, "");
    const clientId = runtimeValue("SF_CLIENT_ID");
    const clientSecret = runtimeValue("SF_CLIENT_SECRET");
    const apiVersion = runtimeValue("SF_API_VERSION") || "66.0";
    if (!loginUrl || !clientId || !clientSecret)
      return Response.json(
        { error: "Salesforce 연결 환경변수를 먼저 등록해주세요." },
        { status: 503 },
      );

    const token = await getToken(loginUrl, clientId, clientSecret);
    const soql = familiesOnly
      ? "SELECT Family FROM Product2 WHERE IsActive = true AND Family != NULL GROUP BY Family ORDER BY Family LIMIT 200"
      : `SELECT Id, Name, Family, Type__c FROM Product2 WHERE IsActive = true AND Name LIKE '%${escapeSoqlLike(query.slice(0, 80))}%' ORDER BY Name, Type__c LIMIT 25`;
    const response = await fetch(
      `${token.instance_url}/services/data/v${apiVersion}/query?q=${encodeURIComponent(soql)}`,
      { headers: { authorization: `Bearer ${token.access_token}` } },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Salesforce Product2 조회에 실패했습니다. 개체와 필드 조회 권한을 확인해주세요. (${response.status}: ${detail.slice(0, 240)})`,
      );
    }
    const result = (await response.json()) as SalesforceQuery<SalesforceProduct>;
    if (familiesOnly)
      return Response.json({
        families: result.records
          .map((product) => product.Family?.trim())
          .filter((family): family is string => Boolean(family)),
      });
    return Response.json({
      products: result.records.map((product) => ({
        id: product.Id,
        name: product.Name,
        family: product.Family,
        condition: ["신품", "중고"].includes(product.Type__c ?? "")
          ? product.Type__c
          : null,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Salesforce 제품 검색 중 오류가 발생했습니다.",
      },
      { status: error instanceof AccessError ? error.status : 500 },
    );
  }
}
