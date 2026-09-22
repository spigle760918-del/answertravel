import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const parameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const derive=(password:string,salt:Buffer,length:number,options:{N:number;r:number;p:number;maxmem:number})=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,length,options,(error,value)=>error?reject(error):resolve(value)));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, 64, parameters);
  return `scrypt$v1$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, n, r, p, saltText, digestText] = encoded.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !saltText || !digestText) return false;
  const salt = Buffer.from(saltText, "base64");
  const expected = Buffer.from(digestText, "base64");
  if (expected.length !== 64) return false;
  const derived = await derive(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: parameters.maxmem });
  return timingSafeEqual(derived, expected);
}
