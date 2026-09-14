import { createHash } from "node:crypto";
import { z } from "zod";

const responseSchema = z.object({ id:z.string().min(1), model:z.string().min(1), choices:z.array(z.object({ finish_reason:z.string().nullable(),
  message:z.object({ content:z.string().nullable() }) })).min(1), usage:z.object({ prompt_tokens:z.number().int().nonnegative(),
  completion_tokens:z.number().int().nonnegative(), total_tokens:z.number().int().nonnegative() }).optional() }).passthrough();
export class DeepSeekAnswerError extends Error { constructor(message:string, readonly code:string, readonly retryable:boolean, readonly request:Record<string,unknown>,
  readonly response:unknown, readonly httpStatus:number|null, readonly durationMs:number){super(message);} }
export type AnswerCapture = { request:Record<string,unknown>; response:unknown; answerText:string; responseId:string; model:string; finishReason:string;
  promptTokens:number; completionTokens:number; totalTokens:number; durationMs:number; payloadSha256:string };
export class DeepSeekAnswerClient {
  constructor(private readonly options:{apiKey:string; endpoint?:string; fetchImpl?:typeof fetch}) { if(!options.apiKey.trim()) throw new Error("DeepSeek API key is required."); }
  async capture(question:string, context:{language:string;regionContext:string}, options:{model:string;temperature:number;maxTokens:number;timeoutMs:number}):Promise<AnswerCapture>{
    const request={model:options.model,messages:[{role:"system",content:`请使用${context.language}回答。地区仅作为问题语境：${context.regionContext}。不得声称获知用户真实定位。`},
      {role:"user",content:question}],temperature:options.temperature,max_tokens:options.maxTokens,stream:false};
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs);const started=Date.now();
    try { const http=await (this.options.fetchImpl??fetch)(this.options.endpoint??"https://api.deepseek.com/chat/completions",{method:"POST",
      headers:{Authorization:`Bearer ${this.options.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(request),signal:controller.signal});
      const raw=await http.text();let body:unknown;try{body=JSON.parse(raw);}catch{body={rawText:raw};}
      if(!http.ok) throw new DeepSeekAnswerError("DeepSeek request failed.",`http_${http.status}`,http.status===429||http.status>=500,request,body,http.status,Date.now()-started);
      const parsed=responseSchema.safeParse(body);if(!parsed.success)throw new DeepSeekAnswerError("DeepSeek response contract is invalid.","invalid_response",false,request,body,http.status,Date.now()-started);
      const choice=parsed.data.choices[0]; const content=choice?.message.content?.trim();
      if(!choice||choice.finish_reason==="length")throw new DeepSeekAnswerError("DeepSeek response was truncated.","incomplete_response",false,request,body,http.status,Date.now()-started);
      if(!content)throw new DeepSeekAnswerError("DeepSeek returned empty content.","empty_content",false,request,body,http.status,Date.now()-started);
      const usage=parsed.data.usage??{prompt_tokens:0,completion_tokens:0,total_tokens:0};
      return {request,response:body,answerText:content,responseId:parsed.data.id,model:parsed.data.model,finishReason:choice.finish_reason??"unknown",
        promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,totalTokens:usage.total_tokens,durationMs:Date.now()-started,
        payloadSha256:createHash("sha256").update(raw).digest("hex")};
    } catch(error){if(error instanceof DeepSeekAnswerError)throw error;const code=error instanceof Error&&error.name==="AbortError"?"timeout":"network_error";
      throw new DeepSeekAnswerError("DeepSeek transport failed.",code,true,request,null,null,Date.now()-started);} finally{clearTimeout(timer);}
  }
}
