import { Link } from "wouter";
import { Zap, Tag, Gavel, FileText } from "lucide-react";
const modes = [{href:"/sell/quick",label:"Quick Sell",icon:Zap,id:"quick"},{href:"/sell/direct",label:"Direct Sell",icon:Tag,id:"direct"},{href:"/auctions/create",label:"Auction",icon:Gavel,id:"auction"},{href:"/classifieds?post=1",label:"Classifieds",icon:FileText,id:"classifieds"}] as const;
export function SellerStudioNav({active}:{active:"quick"|"direct"|"auction"|"classifieds"}) {
 return <nav aria-label="Choose selling method" className="mb-5 min-w-0 rounded-2xl border border-slate-200 bg-white p-2 font-sans text-slate-900 shadow-sm">
 <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-sm font-black text-[#123c66]"><span className="text-lg tracking-tight">Bazunk</span><span className="h-4 w-px bg-slate-300"/>Seller Studio</div>
 <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">{modes.map(({href,label,icon:Icon,id})=><Link key={id} href={href} aria-current={active===id?"page":undefined} className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-xs font-bold transition-colors sm:text-sm ${active===id?"bg-[#F26B21] text-white shadow-sm":"bg-[#eef5fc] text-[#123c66] hover:bg-[#dbeafe]"}`}><Icon className="h-4 w-4 shrink-0"/>{label}</Link>)}</div></nav>;
}
