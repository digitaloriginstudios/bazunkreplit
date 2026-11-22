import { useState } from "react";
import { ChevronRight } from "lucide-react";
export function SellerStudioSections({sections}:{sections:{id:string;label:string}[]}) {
 const [active,setActive]=useState(0);
 const navigate=(index:number)=>{setActive(index);document.getElementById(sections[index].id)?.scrollIntoView({behavior:"smooth",block:"start"});};
 return <nav aria-label="Listing form sections" className="min-w-0 rounded-2xl border border-blue-200 bg-white p-3 font-sans text-slate-900 shadow-sm">
 <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-sm text-[#123c66]">Your listing steps</strong><span className="text-xs font-bold text-orange-700">{active+1} of {sections.length}</span></div>
 <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 snap-x snap-mandatory">{sections.map((section,index)=><button type="button" key={section.id} onClick={()=>navigate(index)} aria-current={active===index?"step":undefined} className={`flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold sm:text-sm ${active===index?"bg-orange-600 text-white":"bg-blue-50 text-[#123c66] hover:bg-blue-100"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full border border-current">{index+1}</span>{section.label}</button>)}</div>
 <div className="mt-2 flex flex-wrap justify-end"><button type="button" onClick={()=>navigate((active+1)%sections.length)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold text-[#15588e] hover:bg-blue-50">{active===sections.length-1?"Back to first step":"Next section"}<ChevronRight className="h-4 w-4"/></button></div>
 </nav>;
}
