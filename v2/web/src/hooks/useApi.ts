import { useCallback, useEffect, useState } from "react";
import type { ZodType } from "zod";
import { getJson } from "../api";
export function useApi<T>(url:string,schema:ZodType<T>) {const [data,setData]=useState<T|null>(null);const [error,setError]=useState<string|null>(null);const [nonce,setNonce]=useState(0);useEffect(()=>{let active=true;setData(null);setError(null);void getJson(url,schema).then((value)=>{if(active)setData(value)}).catch((reason:Error)=>{if(active)setError(reason.message)});return()=>{active=false}},[url,schema,nonce]);return {data,error,retry:useCallback(()=>setNonce((value)=>value+1),[])}}
