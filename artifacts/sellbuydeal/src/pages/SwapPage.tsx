import { useEffect,useState } from "react";
import { Link,useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { ArrowLeftRight,Package } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
type Item={id:string;title:string;description:string;category:string;condition:string;wanted:string;value_minor:number;status?:string};
const field="w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900";
const button="inline-flex rounded-xl bg-[#E96217] px-4 py-3 font-bold text-white disabled:opacity-50";
const initial={title:"",description:"",category:"",condition:"good",wanted:"",value:""};
export default function SwapPage(){
 const [path,navigate]=useLocation();
 const {isLoaded,isSignedIn,getToken}=useAuth();
 const create=path==="/swap/create",mine=path==="/dashboard/swaps";
 const detail=!create&&!mine&&path.startsWith("/swap/")?path.split("/")[2]:null;
 const [items,setItems]=useState<Item[]>([]),[draft,setDraft]=useState(initial),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0),[search,setSearch]=useState("");
 useEffect(()=>{let cancelled=false;setItems([]);setError("");setLoading(true);
 if(create||!isLoaded||(mine&&!isSignedIn)){setLoading(false);return;}
 void(async()=>{try{const token=mine?await getToken():null;if(mine&&!token)throw Error("Sign in to continue.");
 const r=await fetch(detail?"/api/swaps/"+encodeURIComponent(detail):mine?"/api/swaps/mine":"/api/swaps?offset="+offset,{cache:"no-store",headers:token?{Authorization:"Bearer "+token}:{}});
 const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to load swaps");if(!cancelled)setItems(detail?[data]:data.items);
 }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Unable to load swaps");}finally{if(!cancelled)setLoading(false);}})();
 return()=>{cancelled=true;};},[path,create,mine,detail,isLoaded,isSignedIn,getToken,offset]);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");
 try{const token=await getToken();if(!token)throw Error("Sign in to continue.");
 if(!/^\d+(\.\d{1,2})?$/.test(draft.value))throw Error("Enter a valid GBP value.");
 const r=await fetch("/api/swaps",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({...draft,valueMinor:Math.round(Number(draft.value)*100)})});
 const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to create listing");setDraft(initial);navigate("/dashboard/swaps");
 }catch(e){setError(e instanceof Error?e.message:"Unable to create listing");}finally{setBusy(false);}}
 const visible=items.filter(i=>!search||[i.title,i.category,i.wanted].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <><Navbar/><main className="mx-auto max-w-6xl space-y-5 px-4 py-8 pb-24 text-slate-900">
 <section className="rounded-2xl bg-[#123568] p-6 text-white"><ArrowLeftRight size={36}/><h1 className="mt-2 text-3xl font-black">Bazunk Swap</h1><p>Swap what you have. Get what you want.</p><p className="mt-2 text-sm">Preview: negotiate exchanges. Payments, dispatch and exchange protection are not yet available.</p></section>
 <nav className="flex flex-wrap gap-3"><Link href="/swap" className="rounded-xl border p-3 font-bold">Browse swaps</Link><Link href="/swap/create" className={button}>Create swap</Link><Link href="/dashboard/swaps" className="rounded-xl border p-3 font-bold">My swaps</Link></nav>
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
 {(create||mine)&&!isSignedIn?<p>{isLoaded?"Sign in to manage your swaps.":"Loading account…"}</p>:create?<form onSubmit={submit} className="max-w-2xl space-y-4 rounded-2xl border bg-white p-5">
 <h2 className="text-xl font-bold">Create a swap listing</h2>
 {(["title","description","category","wanted"] as const).map(key=><label key={key} className="block font-semibold">{key==="wanted"?"What would you like in return?":key[0].toUpperCase()+key.slice(1)}<input className={field} required minLength={key==="title"?3:1} maxLength={{title:160,description:5000,category:100,wanted:2000}[key]} value={draft[key]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/></label>)}
 <label className="block font-semibold">Condition<select className={field} value={draft.condition} onChange={e=>setDraft(d=>({...d,condition:e.target.value}))}>{["new","like new","good","fair","poor"].map(c=><option key={c}>{c}</option>)}</select></label>
 <label className="block font-semibold">Estimated value (GBP)<input className={field} type="number" min="0" max="100000" step=".01" required value={draft.value} onChange={e=>setDraft(d=>({...d,value:e.target.value}))}/></label>
 <button className={button} disabled={busy}>{busy?"Publishing…":"Publish swap listing"}</button></form>:<>
 <h2 className="text-xl font-bold">{mine?"My swap listings":detail?"Swap details":"Discover swaps"}</h2>
 {!detail&&<input aria-label="Filter loaded listings" placeholder="Filter loaded listings…" className={field} value={search} onChange={e=>setSearch(e.target.value)}/>}
 {loading?<p>Loading swaps…</p>:!error&&visible.length===0?<p>No matching swap listings.</p>:<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map(i=><article key={i.id} className="rounded-2xl border bg-white p-5 shadow-sm"><Package className="mb-3 text-blue-600" size={36}/><p className="text-sm text-slate-600">{i.category} · {i.condition}</p><h3 className="break-words text-xl font-bold">{i.title}</h3><p className="mt-2 break-words">{i.description}</p><p className="mt-3 font-bold text-blue-800">Wants: {i.wanted}</p><p>Estimated value: £{(i.value_minor/100).toFixed(2)}</p>{i.status&&<p>Status: {i.status}</p>}{!detail&&<Link className="mt-3 inline-block font-bold text-orange-700" href={"/swap/"+i.id}>View details</Link>}</article>)}</div>}
 {!mine&&!detail&&<div className="flex gap-3"><button disabled={offset===0||loading} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous</button><button disabled={items.length<50||loading||offset>=10000} onClick={()=>setOffset(n=>n+50)}>Next</button></div>}</>}
 {(mine||detail)&&!create&&<Negotiation key={path} target={detail} mine={mine}/>}
 </main><Footer/></>;
}

type Offer={id:string;target_title:string;offered_title:string;cash_minor:number;status:string;revision:number;is_proposer:boolean;is_last_actor:boolean};
function Negotiation({target,mine}:{target:string|null;mine:boolean}){
 const {isSignedIn,getToken}=useAuth();
 const [offers,setOffers]=useState<Offer[]>([]),[own,setOwn]=useState<Item[]>([]),[selected,setSelected]=useState(""),[cash,setCash]=useState("0"),[counter,setCounter]=useState<Record<string,string>>({}),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[history,setHistory]=useState<Record<string,{event:string;created_at:string;is_mine:boolean}[]>>({});
 async function api(path:string,body?:unknown){const token=await getToken();if(!token)throw Error("Sign in to continue.");const r=await fetch("/api/swaps"+path,{cache:"no-store",method:body===undefined?"GET":"POST",headers:{Authorization:"Bearer "+token,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||"Swap request failed");return data;}
 async function refresh(){if(mine)setOffers((await api("/offers/mine")).items);else setOwn((await api("/mine")).items.filter((i:Item)=>i.status==="active"&&i.id!==target));}
 useEffect(()=>{if(isSignedIn)void refresh().catch(e=>setError(e.message));},[isSignedIn,target,mine]);
 function minor(v:string){if(!/^-?\d+(\.\d{1,2})?$/.test(v)||Math.abs(Number(v))>100000)throw Error("Enter a valid signed GBP amount.");return Math.round(Number(v)*100);}
 async function act(fn:()=>Promise<unknown>,message:string){if(busy)return;setBusy(true);setError("");setNotice("");try{await fn();setNotice(message);await refresh();}catch(e){setError(e instanceof Error?e.message:"Action failed");}finally{setBusy(false);}}
 if(!isSignedIn)return <p>Sign in to propose an exchange.</p>;
 return <section className="space-y-4 rounded-2xl border bg-white p-5">
 <h2 className="text-xl font-bold">{mine?"Incoming and outgoing offers":"Propose a swap"}</h2>
 {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status" className="text-green-700">{notice}</p>}
 {!mine?<form className="space-y-3" onSubmit={e=>{e.preventDefault();void act(()=>api("/offers",{targetId:target,offeredId:selected,cashMinor:minor(cash)}),"Proposal sent.");}}>
 <label className="block">Your item<select required className={field} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select your swap listing</option>{own.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
 {!own.length&&<Link href="/swap/create">Create an item to offer first</Link>}
 <label className="block">Cash adjustment (GBP): positive means you pay, negative means you receive<input className={field} type="number" step=".01" min="-100000" max="100000" required value={cash} onChange={e=>setCash(e.target.value)}/></label>
 <button className={button} disabled={busy||!selected}>Send proposal</button></form>:<>
 {!offers.length&&<p>No offers yet.</p>}
 {offers.map(o=><article key={o.id} className="space-y-2 rounded-xl border p-4"><h3 className="font-bold">{o.offered_title} ↔ {o.target_title}</h3><p>{o.is_proposer?"Outgoing":"Incoming"} · {o.status} · Revision {o.revision}</p><p>{o.cash_minor===0?"No cash adjustment":((o.cash_minor>0)===o.is_proposer?"You pay ":"You receive ")+"£"+(Math.abs(o.cash_minor)/100).toFixed(2)}</p>
 {o.status==="accepted"&&<p>Items reserved. Do not dispatch or pay until exchange protection is available.</p>}
 {o.status==="pending"&&<div className="flex flex-wrap gap-2">{(o.is_last_actor?["withdraw"]:["accept","decline","counter"]).map(action=><button key={action} className={button} disabled={busy} onClick={()=>{if(action==="accept"&&!window.confirm("Reserve both items? Payments and dispatch are not available yet."))return;void act(()=>api("/offers/"+o.id+"/action",{action,revision:o.revision,...(action==="counter"?{cashMinor:minor(counter[o.id]??String(o.cash_minor/100))}:{})}),"Offer updated.");}}>{action}</button>)}
 {!o.is_last_actor&&<label className="w-full">Counter amount (positive: original proposer pays; negative: target owner pays)<input className={field} type="number" step=".01" value={counter[o.id]??String(o.cash_minor/100)} onChange={e=>setCounter(v=>({...v,[o.id]:e.target.value}))}/></label>}</div>}
 <button className="font-bold text-blue-700" disabled={busy} onClick={()=>void act(async()=>{const data=await api("/offers/"+o.id+"/history");setHistory(h=>({...h,[o.id]:data.items}));},"History loaded.")}>View history</button>
 {history[o.id]?.map((h,i)=><p key={i} className="text-sm">{new Date(h.created_at).toLocaleString()} · {h.is_mine?"You":"Other member"} · {h.event}</p>)}
 </article>)}</>}
 </section>;
}
