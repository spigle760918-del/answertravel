import type { ZodType } from "zod";
import { productApiErrorSchema } from "../../contracts/product-read";
export class ApiError extends Error { constructor(message:string,readonly code:string,readonly status:number){super(message);this.name="ApiError";} }
async function parse<T>(response:Response,schema:ZodType<T>):Promise<T>{const payload:unknown=await response.json().catch(()=>null);if(!response.ok){const parsed=productApiErrorSchema.safeParse(payload);const suffix=parsed.success&&parsed.data.eventId?`（事件 ${parsed.data.eventId.slice(0,8)}）`:"";const error=new ApiError(parsed.success?`${parsed.data.message}${suffix}`:"数据暂时不可用，请稍后重试。",parsed.success?parsed.data.code:"unknown_error",response.status);if(response.status===401&&!response.url.includes("/auth/login"))window.dispatchEvent(new CustomEvent("answertravel:unauthorized"));throw error;}return schema.parse(payload);}
export async function getJson<T>(url: string, schema: ZodType<T>): Promise<T> {
  return parse(await fetch(url,{headers:{accept:"application/json"},credentials:"same-origin"}),schema);
}
export async function postJson<T>(url:string,value:unknown,schema:ZodType<T>):Promise<T>{return parse(await fetch(url,{method:"POST",headers:{accept:"application/json","content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(value)}),schema);}
export async function postEmpty(url:string):Promise<void>{const response=await fetch(url,{method:"POST",headers:{accept:"application/json"},credentials:"same-origin"});if(!response.ok)await parse(response,productApiErrorSchema);}
