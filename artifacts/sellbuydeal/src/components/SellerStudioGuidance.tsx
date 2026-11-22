import { CheckCircle2, Lightbulb } from "lucide-react";
export function SellerStudioProgress({completed,total,label}:{completed:number;total:number;label:string}) {
 const value=Math.max(0,Math.min(total,completed));
 return <div role="group" aria-label={label} className="min-w-0 rounded-2xl border border-blue-200 bg-white p-4 font-sans text-slate-900 shadow-sm">
 <div className="flex items-center justify-between gap-3 text-sm"><strong className="text-[#123c66]">{label}</strong><span className="font-bold text-orange-700">{value} of {total}</span></div>
 <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label} className="mt-3 h-2.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-orange-500 transition-all" style={{width:`${value/Math.max(total,1)*100}%`}}/></div>
 </div>;
}
export function SellerStudioTips({items}:{items:string[]}) {
 return <details className="min-w-0 rounded-2xl border border-blue-200 bg-[#eef6ff] p-4 font-sans text-[#123c66]">
 <summary className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-black"><Lightbulb className="h-5 w-5 text-orange-600"/>Tips for a great listing</summary>
 <ul className="mt-3 space-y-2 text-sm">{items.map(item=><li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>{item}</li>)}</ul>
 </details>;
}
