import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8').split('\n').filter(line=>!line.trimStart().startsWith('//')).join('\n'));
const meta=config.d1_databases?.find(x=>x.binding==='MCP_META');
const operational=config.d1_databases?.find(x=>x.binding==='DB');
const kv=config.kv_namespaces?.find(x=>x.binding==='OAUTH_KV');
if(!meta||!operational||!kv||meta.database_id===operational.database_id||/^0+$/.test(meta.database_id.replace(/-/g,''))||/^0+$/.test(kv.id)) {
  console.error('wrangler.jsonc에서 별도 MCP_META의 database_id와 OAUTH_KV의 id를 설정하세요.');process.exit(1);
}
console.log('MCP 리소스 ID 설정 확인 완료.');
