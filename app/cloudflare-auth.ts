import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessJwt, type AccessConfig, type AccessUser } from "./access-jwt";

export async function getAccessUser(): Promise<AccessUser | null> {
  const token = (await headers()).get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  try { return await verifyAccessJwt(token, env as AccessConfig); }
  catch { return null; }
}

export async function requireAccessUser(): Promise<AccessUser> {
  const user = await getAccessUser();
  if (user) return user;
  redirect("/cdn-cgi/access/login");
}
