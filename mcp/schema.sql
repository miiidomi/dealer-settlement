-- MCP_META라는 별도 D1에서만 실행합니다. 정산 DB(DB)에서는 실행하지 않습니다.
CREATE TABLE IF NOT EXISTS mcp_oauth_flows (
  id TEXT PRIMARY KEY,
  auth_request TEXT NOT NULL,
  csrf TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('consent','upstream')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_flows_expiry ON mcp_oauth_flows(expires_at);
CREATE TABLE IF NOT EXISTS mcp_audit (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  tool TEXT NOT NULL,
  dealer_id INTEGER,
  start_month TEXT,
  end_month TEXT,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_audit_member_created ON mcp_audit(member_id,created_at);
