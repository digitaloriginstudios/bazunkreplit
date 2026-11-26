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
 <section className="rounded-2xl bg-[#123568] p-6 text-white"><ArrowLeftRight size={36}/><h1 className="mt-2 text-3xl font-black">Bazunk Swap</h1><p>Swap what you have. Get what you want.</p><p className="mt-2 text-sm">Preview: listings only. Offers, payments and exchange protection are not yet available.</p></section>
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
 </main><Footer/></>;
}
