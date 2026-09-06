import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { avito_customer_message_system_prompt, avito_review_appeal_system_prompt, openaiClient, reviewsAiConfig } from "@/lib/reviews-ai";

export const runtime = "nodejs";
const schema=z.object({type:z.enum(["customer_message","review_appeal"]),situation:z.string().trim().min(3).max(8000),conversation:z.string().trim().max(12000).default(""),review:z.string().trim().max(8000).default("")});
const allowed=new Set(["image/png","image/jpeg","image/webp"]),MAX_FILE=4*1024*1024,MAX_TOTAL=12*1024*1024;

export async function POST(request:Request){
  const session=await getSession();if(!session||session.role!=="employee"||!session.permissions?.includes("reviews"))return NextResponse.json({error:"Нет доступа"},{status:403});
  const db=createAdminClient();const {data:employee}=await db.from("employees").select("active,permissions").eq("id",session.sub).single();
  if(!employee?.active||!employee.permissions?.includes("reviews"))return NextResponse.json({error:"Нет доступа"},{status:403});
  const form=await request.formData();const parsed=schema.safeParse({type:form.get("type"),situation:form.get("situation"),conversation:form.get("conversation")||"",review:form.get("review")||""});
  if(!parsed.success)return NextResponse.json({error:"Заполните обязательные поля"},{status:400});
  const images=form.getAll("images").filter((x):x is File=>x instanceof File&&x.size>0);
  if(images.length>5||images.some(x=>!allowed.has(x.type)||x.size>MAX_FILE)||images.reduce((s,x)=>s+x.size,0)>MAX_TOTAL)return NextResponse.json({error:"До 5 изображений PNG/JPEG/WebP, каждое до 4 МБ и суммарно до 12 МБ"},{status:400});
  const since=new Date(Date.now()-5000).toISOString(),day=new Date();day.setHours(0,0,0,0);
  const [{count:recent},{count:daily}]=await Promise.all([db.from("ai_review_requests").select("id",{head:true,count:"exact"}).eq("employee_id",session.sub).gte("created_at",since),db.from("ai_review_requests").select("id",{head:true,count:"exact"}).eq("employee_id",session.sub).gte("created_at",day.toISOString())]);
  if((recent??0)>0)return NextResponse.json({error:"Подождите несколько секунд перед следующим запросом"},{status:429});
  if((daily??0)>=50)return NextResponse.json({error:"Дневной лимит запросов исчерпан. Обратитесь к администратору"},{status:429});
  const d=parsed.data,model=d.type==="customer_message"?reviewsAiConfig.fastModel:reviewsAiConfig.smartModel,system=d.type==="customer_message"?avito_customer_message_system_prompt:avito_review_appeal_system_prompt;
  const text=d.type==="customer_message"?`Ситуация: ${d.situation}\nПереписка: ${d.conversation||"не приложена"}`:`Отзыв: ${d.review||"не приложен"}\nСитуация: ${d.situation}\nПереписка: ${d.conversation||"не приложена"}`;
  try{
    const content:Array<{type:"input_text";text:string}|{type:"input_image";image_url:string;detail:"low"}>=[{type:"input_text",text}];
    for(const file of images)content.push({type:"input_image",image_url:`data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,detail:"low"});
    const response=await openaiClient().responses.create({model,instructions:system,input:[{role:"user",content}],reasoning:{effort:reviewsAiConfig.reasoningEffort[d.type]},max_output_tokens:reviewsAiConfig.maxOutputTokens[d.type]});
    const result=response.output_text.trim();if(!result)throw new Error("EMPTY_AI_RESPONSE");
    const {error}=await db.from("ai_review_requests").insert({employee_id:session.sub,type:d.type,source:{situation:d.situation,conversation:d.conversation,review:d.review,image_count:images.length},result,model,usage:response.usage??null});
    if(error)logSupabaseError("AI review history insert failed",error);
    return NextResponse.json({result});
  }catch(error){console.error("[Reviews AI] request failed",error instanceof Error?error.message:"unknown");return NextResponse.json({error:error instanceof Error&&error.message==="OPENAI_NOT_CONFIGURED"?"OpenAI API пока не настроен":"Не удалось подготовить ответ. Попробуйте ещё раз"},{status:502});}
}
