import {useSeoMetadata} from "@/hooks/useSeoMetadata";
import { useEffect, useId, useState } from "react";
import { Link,useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { ArrowLeftRight,Package } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ACTIVE_CATEGORIES } from "@/data/categories";
type Item={id:string;title:string;description:string;category:string;condition:string;wanted:string;value_minor:number;status?:string};
const field="w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900";
const button="inline-flex rounded-xl bg-[#E96217] px-4 py-3 font-bold text-white disabled:opacity-50";
const initial={title:"",description:"",category:"",condition:"good",wanted:"",value:""};
const previewNotice="Preview: negotiate exchanges. Test-mode cash checkout only. Do not dispatch items; live exchange protection is not yet available.";
const conditions = ["new", "like new", "good", "fair", "poor"];

export function SwapListingForm({ embedded = false }: { embedded?: boolean }) {
  const [, navigate] = useLocation();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const categoriesId = useId();
  const [draft, setDraft] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof initial, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    let listingId = publishedId;
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to continue.");
      if (files.length > 4) throw new Error("Choose up to four photos.");
      const photos = await Promise.all(files.map(prepareSwapPhoto));
      const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };

      if (!listingId) {
        if (!/^\d+(\.\d{1,2})?$/.test(draft.value)) throw new Error("Enter a valid GBP value.");
        const response = await fetch("/api/swaps", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...draft, valueMinor: Math.round(Number(draft.value) * 100) }),
        });
        const data = await response.json() as { id?: string; error?: string };
        if (!response.ok) throw new Error(data.error || "Unable to create listing");
        if (typeof data.id !== "string") throw new Error("Check My swaps before trying again.");
        listingId = data.id;
        setPublishedId(listingId);
      }

      if (photos.length) {
        const response = await fetch(`/api/swaps/${encodeURIComponent(listingId)}/photos`, {
          method: "POST",
          headers,
          body: JSON.stringify({ photos }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Could not upload photos.");
        }
      }
      navigate("/dashboard/swaps");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create listing";
      setError(listingId ? `Your listing is published. ${message} You can retry the photo upload here.` : message);
    } finally {
      setBusy(false);
    }
  }

  const formField = "mt-1 w-full rounded-xl border border-input bg-background p-3 text-foreground";
  const section = "space-y-4 rounded-xl border border-border p-4";
  return (
    <div className={embedded ? "p-4 sm:p-6" : "max-w-2xl"}>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5">
        <h2 className="text-xl font-bold">Create a swap listing</h2>
        {embedded && <p className="rounded-xl border border-border bg-muted p-3 text-sm text-foreground">{previewNotice}</p>}
        {!isLoaded ? <p role="status">Loading account…</p> : !isSignedIn ? (
          <Link href="/sign-in" className={button}>Sign in to create a swap</Link>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={busy || publishedId !== null} className={section}>
              <legend className="px-2 font-bold">Item details</legend>
              <label className="block font-semibold">
                Title
                <input className={formField} required minLength={3} maxLength={160}
                  value={draft.title} onChange={event => update("title", event.target.value)} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block font-semibold">
                  Category
                  <input className={formField} list={categoriesId} required maxLength={100}
                    value={draft.category} onChange={event => update("category", event.target.value)} />
                  <datalist id={categoriesId}>
                    {ACTIVE_CATEGORIES.map(category => <option key={category.slug} value={category.name} />)}
                  </datalist>
                </label>
                <label className="block font-semibold">
                  Condition
                  <select className={formField} value={draft.condition} onChange={event => update("condition", event.target.value)}>
                    {conditions.map(condition => <option key={condition} value={condition}>{condition[0].toUpperCase() + condition.slice(1)}</option>)}
                  </select>
                </label>
              </div>
              <label className="block font-semibold">
                Description
                <textarea className={formField} rows={4} required maxLength={5000} placeholder="Include the brand, model, accessories and any signs of wear."
                  value={draft.description} onChange={event => update("description", event.target.value)} />
              </label>
            </fieldset>

            <fieldset disabled={busy} className={section}>
              <legend className="px-2 font-bold">Photos</legend>
              <label className="block font-semibold">
                Add up to four photos (optional)
                <input className={formField} type="file" accept="image/jpeg,image/png,image/webp" multiple
                  onChange={event => setFiles(Array.from(event.target.files ?? []))} />
              </label>
              <p className="text-sm text-muted-foreground">Use JPEG, PNG or WebP, up to 12 MB each. The first photo is the cover.</p>
            </fieldset>

            <fieldset disabled={busy || publishedId !== null} className={section}>
              <legend className="px-2 font-bold">What you want in return</legend>
              <label className="block font-semibold">
                What would you like in return?
                <textarea className={formField} rows={3} required maxLength={2000} placeholder="Describe the items, condition or alternatives you’d consider."
                  value={draft.wanted} onChange={event => update("wanted", event.target.value)} />
              </label>
              <label className="block font-semibold">
                Estimated item value (GBP)
                <input className={formField} type="number" min="0" max="100000" step=".01" required value={draft.value}
                  onChange={event => update("value", event.target.value)} />
              </label>
            </fieldset>

            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={button} disabled={busy || files.length > 4 || (publishedId !== null && files.length === 0)}>
                {busy ? "Saving…" : publishedId ? "Retry photo upload" : "Publish swap listing"}
              </button>
              {publishedId && <Link href="/dashboard/swaps" className="font-bold underline">Go to My swaps</Link>}
            </div>
            {files.length > 4 && <p role="alert" className="text-sm text-destructive">Choose up to four photos.</p>}
          </form>
        )}
      </section>
    </div>
  );
}
export default function SwapPage(){
 const [path]=useLocation();
 const {isLoaded,isSignedIn,getToken}=useAuth();
 const create=path==="/swap/create",mine=path==="/dashboard/swaps";
 const detail=!create&&!mine&&path.startsWith("/swap/")?path.split("/")[2]:null;
 const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[offset,setOffset]=useState(0),[search,setSearch]=useState(""),[query,setQuery]=useState(""),[category,setCategory]=useState("");
 useEffect(()=>{let cancelled=false;setItems([]);setError("");setLoading(true);
 if(create||!isLoaded||(mine&&!isSignedIn)){setLoading(false);return;}
 void(async()=>{try{const token=mine?await getToken():null;if(mine&&!token)throw Error("Sign in to continue.");
 const r=await fetch(detail?"/api/swaps/"+encodeURIComponent(detail):mine?"/api/swaps/mine":"/api/swaps?"+new URLSearchParams({offset:String(offset),q:query,category}).toString(),{cache:"no-store",headers:token?{Authorization:"Bearer "+token}:{}});
 const data=await r.json();if(!r.ok)throw Error(data.error||"Unable to load swaps");if(!cancelled)setItems(detail?[data]:data.items);
 }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Unable to load swaps");}finally{if(!cancelled)setLoading(false);}})();
 return()=>{cancelled=true;};},[path,create,mine,detail,isLoaded,isSignedIn,getToken,offset,query,category]);
 const seoItem=detail&&items[0]?.id===detail?items[0]:null;
 useSeoMetadata(create||mine?null:detail?(seoItem?{title:seoItem.title+" | Bazunk Swap",description:seoItem.description.slice(0,160),url:"https://www.bazunk.com/swap/"+seoItem.id,schema:{"@context":"https://schema.org","@type":"WebPage",name:seoItem.title,description:seoItem.description,url:"https://www.bazunk.com/swap/"+seoItem.id}}:null):{title:"Bazunk Swap | Exchange products",description:"Discover products to exchange and find items matching your wanted list.",url:"https://www.bazunk.com/swap"});
 const visible=items.filter(i=>!mine||!search||[i.title,i.category,i.wanted].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <><Navbar/><main className="mx-auto max-w-6xl space-y-5 px-4 py-8 pb-24 text-slate-900">
 <section className="rounded-2xl bg-[#123568] p-6 text-white"><ArrowLeftRight size={36}/><h1 className="mt-2 text-3xl font-black">Bazunk Swap</h1><p>Swap what you have. Get what you want.</p><p className="mt-2 text-sm">{previewNotice}</p></section>
 <nav className="flex flex-wrap gap-3"><Link href="/swap" className="rounded-xl border p-3 font-bold">Browse swaps</Link><Link href="/swap/create" className={button}>Create swap</Link><Link href="/dashboard/swaps" className="rounded-xl border p-3 font-bold">My swaps</Link></nav>
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
 {create?<SwapListingForm/>:mine&&!isSignedIn?<p>{isLoaded?"Sign in to manage your swaps.":"Loading account…"}</p>:<>
 <h2 className="text-xl font-bold">{mine?"My swap listings":detail?"Swap details":"Discover swaps"}</h2>
 {mine&&<input aria-label="Filter loaded listings" placeholder="Filter loaded listings…" className={field} value={search} onChange={e=>setSearch(e.target.value)}/>}
 {!mine&&!detail&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(search.trim());setCategory(String(new FormData(e.currentTarget).get("category")||"").trim());}}><input className={field} aria-label="Search swaps" placeholder="Search items or wanted products" value={search} onChange={e=>setSearch(e.target.value)}/><input className={field} name="category" aria-label="Category" placeholder="Category (optional)"/><button className={button}>Search marketplace</button></form>}
 {loading?<p>Loading swaps…</p>:!error&&visible.length===0?<p>No matching swap listings.</p>:<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map(i=><article key={i.id} className="rounded-2xl border bg-white p-5 shadow-sm"><SwapPhoto id={i.id} gallery={!!detail}/><p className="text-sm text-slate-600">{i.category} · {i.condition}</p><h3 className="break-words text-xl font-bold">{i.title}</h3><p className="mt-2 break-words">{i.description}</p><p className="mt-3 font-bold text-blue-800">Wants: {i.wanted}</p><p>Estimated value: £{(i.value_minor/100).toFixed(2)}</p>{i.status&&<p>Status: {i.status}</p>}{mine&&i.status==="active"&&<SwapPhotoUpload id={i.id}/>}{!detail&&<Link className="mt-3 inline-block font-bold text-orange-700" href={"/swap/"+i.id}>View details</Link>}</article>)}</div>}
 {!mine&&!detail&&<div className="flex gap-3"><button disabled={offset===0||loading} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous</button><button disabled={items.length<50||loading||offset>=10000} onClick={()=>setOffset(n=>n+50)}>Next</button></div>}</>}
 {isSignedIn&&!create&&!detail&&<SwapDiscovery/>}
 {isSignedIn&&detail&&items.length>0&&<SwapSave id={detail}/>}
 {mine&&isSignedIn&&<><SwapNotificationPreferences/><SwapActivity/></>}
 {(mine||detail)&&!create&&<Negotiation key={path} target={detail} mine={mine}/>}
 </main><Footer/></>;
}

type Offer={id:string;target_title:string;offered_title:string;cash_minor:number;status:string;revision:number;is_proposer:boolean;is_last_actor:boolean};
function Negotiation({target,mine}:{target:string|null;mine:boolean}){
 const {isSignedIn,getToken}=useAuth();
 const [filter,setFilter]=useState("all"),[offers,setOffers]=useState<Offer[]>([]),[own,setOwn]=useState<Item[]>([]),[selected,setSelected]=useState(""),[cash,setCash]=useState("0"),[counter,setCounter]=useState<Record<string,string>>({}),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[history,setHistory]=useState<Record<string,{event:string;created_at:string;is_mine:boolean}[]>>({});
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
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["all","All offers"],["incoming","Incoming"],["outgoing","Outgoing"],["accepted","Accepted"]].map(([k,label])=><button key={k} className={"rounded-xl border p-3 "+(filter===k?"bg-blue-100":"bg-white")} onClick={()=>setFilter(k)}>{label}<b className="block text-xl">{offers.filter(o=>k==="all"||k==="incoming"&&!o.is_proposer||k==="outgoing"&&o.is_proposer||k==="accepted"&&o.status==="accepted").length}</b></button>)}</div>
 {offers.filter(o=>filter==="all"||filter==="incoming"&&!o.is_proposer||filter==="outgoing"&&o.is_proposer||filter==="accepted"&&o.status==="accepted").map(o=><article id={"swap-offer-"+o.id} key={o.id} className="space-y-2 rounded-xl border p-4"><h3 className="font-bold">{o.offered_title} ↔ {o.target_title}</h3><p>{o.is_proposer?"Outgoing":"Incoming"} · {o.status} · Revision {o.revision}</p><p>{o.cash_minor===0?"No cash adjustment":((o.cash_minor>0)===o.is_proposer?"You pay ":"You receive ")+"£"+(Math.abs(o.cash_minor)/100).toFixed(2)}</p>
 {o.status==="accepted"&&<p>Items reserved. Do not dispatch or make real payments until exchange protection is available.</p>}
 {o.status==="accepted"&&<><SwapPayment offer={o}/><SwapDelivery offer={o}/><SwapAddress offer={o}/></>}
 {o.status==="pending"&&<div className="flex flex-wrap gap-2">{(o.is_last_actor?["withdraw"]:["accept","decline","counter"]).map(action=><button key={action} className={button} disabled={busy} onClick={()=>{if(action==="accept"&&!window.confirm("Reserve both items? Payments and dispatch are not available yet."))return;void act(()=>api("/offers/"+o.id+"/action",{action,revision:o.revision,...(action==="counter"?{cashMinor:minor(counter[o.id]??String(o.cash_minor/100))}:{})}),"Offer updated.");}}>{action}</button>)}
 {!o.is_last_actor&&<label className="w-full">Counter amount (positive: original proposer pays; negative: target owner pays)<input className={field} type="number" step=".01" value={counter[o.id]??String(o.cash_minor/100)} onChange={e=>setCounter(v=>({...v,[o.id]:e.target.value}))}/></label>}</div>}
 <SwapMessages offer={o}/>
 <SwapCase offer={o} onChange={refresh}/>
 <button className="font-bold text-blue-700" disabled={busy} onClick={()=>void act(async()=>{const data=await api("/offers/"+o.id+"/history");setHistory(h=>({...h,[o.id]:data.items}));},"History loaded.")}>View history</button>
 {history[o.id]?.map((h,i)=><p key={i} className="text-sm">{new Date(h.created_at).toLocaleString()} · {h.is_mine?"You":"Other member"} · {h.event}</p>)}
 </article>)}</>}
 </section>;
}

function SwapPayment({offer}:{offer:Offer}){
 const {getToken}=useAuth();
 const [data,setData]=useState<{testEnabled:boolean;payments:{amount_minor:number;fee_minor:number;status:string;is_mine:boolean}[]}|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const owes=offer.cash_minor!==0&&((offer.cash_minor>0)===offer.is_proposer);
 async function request(suffix="",post=false){const token=await getToken();if(!token)throw Error("Sign in required.");const r=await fetch("/api/swaps/offers/"+offer.id+"/payment"+suffix,{method:post?"POST":"GET",cache:"no-store",headers:{Authorization:"Bearer "+token}});const body=await r.json();if(!r.ok)throw Error(body.error||"Payment request failed");return body;}
 async function run(action:"load"|"checkout"|"verify"){setBusy(true);setError("");try{if(action==="checkout"){const d=await request("/checkout",true);const url=new URL(d.url);if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com")throw Error("Unexpected checkout destination");window.location.assign(url.href);return;}if(action==="verify")await request("/verify",true);setData(await request());}catch(e){setError(e instanceof Error?e.message:"Payment unavailable");}finally{setBusy(false);}}
 useEffect(()=>{void run("load");},[offer.id]);
 const own=data?.payments.find(p=>p.is_mine);
 return <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="font-bold">Cash adjustment · GBP</p><p>{offer.cash_minor===0?"No cash adjustment required":owes?"You owe £"+(Math.abs(offer.cash_minor)/100).toFixed(2):"You would receive £"+(Math.abs(offer.cash_minor)/100).toFixed(2)}</p><p className="text-sm">Test only. No live funds or payouts.</p>{data?.payments.map((p,i)=><p key={i}>{p.is_mine?"Your payment":"Other member's payment"}: {p.status}</p>)}{error&&<p role="alert" className="text-red-700">{error}</p>}
 {owes&&data?.testEnabled&&(!own||own.status==="pending")&&<button disabled={busy} className={button} onClick={()=>void run("checkout")}>Open test checkout</button>}
 {owes&&own?.status==="pending"&&<button disabled={busy} className="ml-2 font-bold text-blue-700" onClick={()=>void run("verify")}>Verify test payment</button>}
 <button disabled={busy} className="ml-2 font-bold text-blue-700" onClick={()=>void run("load")}>Refresh status</button></div>;
}

type Delivery={is_mine:boolean;carrier:string|null;tracking:string|null;dispatched_at:string|null;received_at:string|null;method:"shipping"|"local"};
function SwapDelivery({offer}:{offer:Offer}){
 const {getToken}=useAuth();
 const [items,setItems]=useState<Delivery[]>([]),[method,setMethod]=useState<"shipping"|"local">("shipping"),[carrier,setCarrier]=useState(""),[tracking,setTracking]=useState(""),[code,setCode]=useState(""),[secret,setSecret]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 async function api(body?:unknown){const token=await getToken();if(!token)throw Error("Sign in required.");const r=await fetch("/api/swaps/offers/"+offer.id+"/delivery",{cache:"no-store",method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||"Delivery request failed");return data;}
 async function refresh(){const d=await api();setItems(d.items);if(d.items.length)setMethod(d.items[0].method);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[offer.id]);
 async function act(action:string){if(busy)return;setBusy(true);setError("");setNotice("");try{const d=await api({action,carrier,tracking,code:code.trim()});if(d.code)setSecret(d.code);if(action==="local_confirm")setCode("");setNotice(d.bothConfirmed?"Both test receipts confirmed. No funds released.":"Test exchange updated.");await refresh();}catch(e){setError(e instanceof Error?e.message:"Update failed");}finally{setBusy(false);}}
 const own=items.find(i=>i.is_mine),other=items.find(i=>!i.is_mine);
 return <section className="space-y-3 rounded-xl border bg-white p-4"><h4 className="font-bold text-blue-800">Two-way delivery · test preview</h4><p className="text-sm">Use fictional tracking details only. Do not dispatch or meet for a real exchange yet.</p>
 {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="grid gap-2 sm:grid-cols-2">{[true,false].map(mine=>{const d=mine?own:other;return <div key={String(mine)} className="rounded-xl border p-3"><b>{mine?"Your item":"Other member's item"}</b><p>{d?.received_at?"Receipt confirmed":d?.dispatched_at?"Dispatched":d?.method==="local"?"Collection code generated":"Awaiting handover"}</p>{d?.tracking&&<p className="break-all">{d.carrier}: {d.tracking}</p>}</div>;})}</div>
 {own?.received_at&&other?.received_at?<p className="font-bold">Both receipts confirmed in test mode.</p>:<>
 <label className="block">Exchange method<select className={field} disabled={items.length>0||busy} value={method} onChange={e=>setMethod(e.target.value as "shipping"|"local")}><option value="shipping">Tracked shipping</option><option value="local">Local collection</option></select></label>
 {method==="shipping"?<>
 {!own&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void act("dispatch");}}><label className="block">Carrier<input className={field} required maxLength={80} value={carrier} onChange={e=>setCarrier(e.target.value)}/></label><label className="block">Tracking reference<input className={field} required minLength={3} maxLength={120} value={tracking} onChange={e=>setTracking(e.target.value)}/></label><button className={button} disabled={busy}>Record test dispatch</button></form>}
 {other?.dispatched_at&&!other.received_at&&<button className={button} disabled={busy} onClick={()=>{if(window.confirm("Confirm simulated receipt of the other item?"))void act("receive");}}>Confirm test receipt</button>}
 </>:<>
 {!own?.received_at&&<button className={button} disabled={busy} onClick={()=>void act("local_code")}>Generate test collection code</button>}
 {secret&&!own?.received_at&&<p className="break-all">Your code (expires in 15 minutes): <b>{secret}</b></p>}
 {!other?.received_at&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void act("local_confirm");}}><label className="block">Other member's collection code<input className={field} required minLength={32} maxLength={32} value={code} onChange={e=>setCode(e.target.value)}/></label><button className={button} disabled={busy}>Confirm test collection</button></form>}
 </>}</>}
 <button className="font-bold text-blue-700" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh delivery status</button></section>;
}

function useSwapPrivateApi(){
 const {getToken}=useAuth();
 return async(path:string,body?:unknown)=>{const token=await getToken();if(!token)throw Error("Sign in required.");const r=await fetch("/api/swaps"+path,{cache:"no-store",method:body===undefined?"GET":"POST",headers:{Authorization:"Bearer "+token,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed");return d;};
}
type Activity={id:string;offer_id:string;event:string;created_at:string;target_title:string;unread:boolean};
function activityLabel(raw:string){let action=raw;try{action=JSON.parse(raw).action||raw;}catch{}return ({case_opened:"Exchange case opened",case_resume:"Exchange resumed",case_cancel:"Exchange cancelled",listing_moderated:"Listing moderated",proposed:"New swap proposal",counter:"Counteroffer received",accept:"Offer accepted",decline:"Offer declined",withdraw:"Offer withdrawn",new_message:"New message",item_reserved:"Item reserved in another exchange",test_dispatch:"Test dispatch recorded",test_receive:"Test receipt confirmed",test_local_code:"Test collection code generated",test_local_confirm:"Test collection confirmed",test_both_receipts_confirmed:"Both test receipts confirmed"} as Record<string,string>)[action]||"Exchange updated";}
function SwapActivity(){
 const api=useSwapPrivateApi();const [items,setItems]=useState<Activity[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[unreadOnly,setUnreadOnly]=useState(false);
 async function refresh(){try{setItems((await api("/activity")).items);setError("");}catch(e){setError(e instanceof Error?e.message:"Activity unavailable");}}
 useEffect(()=>{void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},30000);return()=>window.clearInterval(timer);},[]);
 async function read(ids:string[]){setBusy(true);try{await api("/activity/read",{ids});await refresh();}catch(e){setError(e instanceof Error?e.message:"Update failed");}finally{setBusy(false);}}
 const unread=items.filter(i=>i.unread);
 return <section className="space-y-3 rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">Swap notifications ({unread.length} unread in recent activity)</h2><button disabled={busy||!unread.length} className="font-bold text-blue-700" onClick={()=>void read(unread.map(i=>i.id))}>Mark all displayed as read</button></div><label><input type="checkbox" checked={unreadOnly} onChange={e=>setUnreadOnly(e.target.checked)}/> Unread only</label>{error&&<p role="alert" className="text-red-700">{error}</p>}
 {!items.length&&<p>No recent activity.</p>}
 <div className="max-h-80 overflow-auto">{items.filter(i=>!unreadOnly||i.unread).map(i=><article key={i.id} className={"border-b p-3 "+(i.unread?"bg-blue-50":"")}><p className="font-bold">{activityLabel(i.event)} · {i.target_title}</p><p className="text-sm">{new Date(i.created_at).toLocaleString()}</p><a href={"#swap-offer-"+i.offer_id} className="mr-3 text-blue-700">View exchange</a>{i.unread&&<button disabled={busy} className="text-blue-700" onClick={()=>void read([i.id])}>Mark read</button>}</article>)}</div></section>;
}
type SwapMessage={id:string;body:string;created_at:string;is_mine:boolean};
function SwapMessages({offer}:{offer:Offer}){
 const api=useSwapPrivateApi();const [open,setOpen]=useState(false),[items,setItems]=useState<SwapMessage[]>([]),[body,setBody]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const base="/offers/"+offer.id+"/messages";
 async function refresh(){try{const d=await api(base);setItems(old=>{const merged=new Map(old.map(m=>[m.id,m]));for(const m of d.items as SwapMessage[])merged.set(m.id,m);return Array.from(merged.values()).sort((a,b)=>a.id.length-b.id.length||a.id.localeCompare(b.id));});setMore(old=>old||d.items.length===50);setError("");}catch(e){setError(e instanceof Error?e.message:"Messages unavailable");}}
 useEffect(()=>{if(!open)return;void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},15000);return()=>window.clearInterval(timer);},[open,offer.id]);
 async function older(){if(!items.length||busy)return;setBusy(true);try{const d=await api(base+"?before="+encodeURIComponent(items[0].id));setItems(old=>{const merged=new Map([...d.items,...old].map((m:SwapMessage)=>[m.id,m]));return Array.from(merged.values()) as SwapMessage[];});setMore(d.items.length===50);}catch(e){setError(e instanceof Error?e.message:"Could not load older messages");}finally{setBusy(false);}}
 async function send(e:React.FormEvent){e.preventDefault();if(busy||!body.trim())return;setBusy(true);setError("");try{await api(base,{body:body.trim()});setBody("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Message failed");}finally{setBusy(false);}}
 return <section className="rounded-xl border p-3"><button className="font-bold text-blue-700" onClick={()=>setOpen(v=>!v)}>{open?"Hide conversation":"Open private conversation"}</button>{open&&<div className="mt-3 space-y-3"><p className="text-sm">Keep exchange discussions on Bazunk. Never send passwords or payment details.</p>{error&&<p role="alert" className="text-red-700">{error}</p>}{more&&<button disabled={busy} onClick={()=>void older()}>Load older messages</button>}<div className="max-h-72 space-y-2 overflow-auto">{items.map(m=><div key={m.id} className={"max-w-[90%] rounded-xl p-3 "+(m.is_mine?"ml-auto bg-blue-100":"bg-slate-100")}><p className="whitespace-pre-wrap break-words">{m.body}</p><p className="text-xs text-slate-600">{m.is_mine?"You":"Other member"} · {new Date(m.created_at).toLocaleString()}</p></div>)}</div>{["pending","accepted","disputed"].includes(offer.status)&&<form onSubmit={send} className="space-y-2"><textarea aria-label="Message" className={field} required maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/><button className={button} disabled={busy||!body.trim()}>Send message</button></form>}</div>}</section>;
}

function SwapCase({offer,onChange}:{offer:Offer;onChange:()=>Promise<void>}){
 const api=useSwapPrivateApi();const [items,setItems]=useState<{id:string;kind:string;reason:string;status:string;resolution:string|null}[]>([]),[reason,setReason]=useState(""),[kind,setKind]=useState("dispute"),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const path="/offers/"+offer.id+"/dispute";
 async function refresh(){setItems((await api(path)).items);}
 useEffect(()=>{if(open||offer.status==="disputed")void refresh().catch(e=>setError(e.message));},[open,offer.status,offer.id]);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{await api(path,{kind,reason});setReason("");await refresh();await onChange();}catch(e){setError(e instanceof Error?e.message:"Case failed");}finally{setBusy(false);}}
 return <section className="space-y-2 rounded-xl border p-3"><button className="font-bold text-blue-700" onClick={()=>setOpen(v=>!v)}>{open?"Hide support cases":"Exchange support and cases"}</button>{error&&<p role="alert" className="text-red-700">{error}</p>}{(open||offer.status==="disputed")&&<>{items.map(c=><article key={c.id} className="rounded-lg border p-2"><b>{c.kind} · {c.status}</b><p className="break-words">{c.reason}</p>{c.resolution&&<p className="break-words">Resolution: {c.resolution}</p>}</article>)}{offer.status==="accepted"&&<form className="space-y-2" onSubmit={submit}><p>Opening a case pauses the exchange. It does not automatically refund payments.</p><select aria-label="Case type" className={field} value={kind} onChange={e=>setKind(e.target.value)}><option value="dispute">Report a problem</option><option value="cancellation">Request cancellation</option></select><textarea aria-label="Reason" className={field} minLength={10} maxLength={2000} required value={reason} onChange={e=>setReason(e.target.value)}/><button className={button} disabled={busy}>Submit support case</button></form>}</>}</section>;
}

function SwapSave({id}:{id:string}){
 const api=useSwapPrivateApi();const [saved,setSaved]=useState<boolean|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{setSaved(null);void api("/saved").then(d=>setSaved(d.items.some((i:Item)=>i.id===id))).catch(e=>setError(e.message));},[id]);
 return <div>{error&&<p role="alert">{error}</p>}<button className={button} disabled={busy||saved===null} onClick={async()=>{setBusy(true);setError("");try{const d=await api("/saved/"+id,{saved:!saved});setSaved(d.saved);}catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}}>{saved?"Remove from watchlist":"Save to watchlist"}</button></div>;
}
type Match=Item&{my_title:string;wanted_score:number;reciprocal_score:number;category_match:number;value_gap:number};
function SwapDiscovery(){
 const api=useSwapPrivateApi();const [tab,setTab]=useState<"matches"|"saved">("matches"),[items,setItems]=useState<Match[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError("");setItems([]);void api("/"+tab).then(d=>{if(active)setItems(d.items);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[tab]);
 return <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Your swap discovery</h2><div className="flex gap-3">{(["matches","saved"] as const).map(t=><button key={t} className={"rounded-xl border p-3 "+(tab===t?"bg-blue-100":"")} onClick={()=>setTab(t)}>{t==="matches"?"Recommended for you":"Watchlist"}</button>)}</div>{error&&<p role="alert">{error}</p>}{loading?<p>Loading…</p>:!items.length?<p>{tab==="matches"?"Create an active swap listing with a wanted item to discover matches.":"No saved swaps yet."}</p>:<div className="grid gap-3 sm:grid-cols-2">{items.map(i=><article key={i.id} className="rounded-xl border p-3"><h3 className="font-bold">{i.title}</h3><p>Wants: {i.wanted}</p><p>Estimated value: £{(i.value_minor/100).toFixed(2)}</p>{tab==="matches"&&<><p className="font-bold text-blue-700">{Number(i.wanted_score)>0&&Number(i.reciprocal_score)>0?"Mutual wanted-item match":Number(i.wanted_score)>0?"Matches your wanted item":Number(i.reciprocal_score)>0?"They may want your item":"Similar category"}</p><p>Suggested exchange: {i.my_title}</p></>}{(!i.status||i.status==="active")?<Link href={"/swap/"+i.id}>View swap</Link>:<p>Status: {i.status}</p>}{tab==="saved"&&<button className="ml-3 text-blue-700" onClick={async()=>{try{await api("/saved/"+i.id,{saved:false});setItems(old=>old.filter(x=>x.id!==i.id));}catch(e){setError(e instanceof Error?e.message:"Remove failed");}}}>Remove</button>}</article>)}</div>}</section>;
}

function SwapPhoto({id,gallery=false}:{id:string;gallery?:boolean}){
 const [failed,setFailed]=useState<number[]>([]);
 return <div className="grid gap-2">{failed.includes(0)&&<Package className="mb-3 text-blue-600" size={36}/>} {(gallery?[0,1,2,3]:[0]).filter(n=>!failed.includes(n)).map(n=><img key={n} className="mb-3 h-44 w-full rounded-xl object-contain" loading="lazy" alt={"Swap product photo "+(n+1)} src={"/api/swaps/"+id+"/photos/"+n} onError={()=>setFailed(f=>[...f,n])}/>)}</div>;
}
async function prepareSwapPhoto(file:File):Promise<string>{
 if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>12*1024*1024)throw Error("Choose JPEG, PNG or WebP photos under 12 MB.");
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");if(!ctx)throw Error("Image processing unavailable");ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 for(const quality of [.82,.65,.45,.25]){const encoded=canvas.toDataURL("image/jpeg",quality).split(",")[1];if(encoded&&encoded.length<=699048)return encoded;}throw Error("Photo is too large after compression.");
 }finally{bitmap.close();}
}
function SwapPhotoUpload({id}:{id:string}){
 const api=useSwapPrivateApi();const [files,setFiles]=useState<File[]>([]),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 return <div className="space-y-2"><label className="block">Replace product photos (up to four)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setFiles(Array.from(e.target.files||[]))}/></label><button className={button} disabled={busy||!files.length||files.length>4} onClick={async()=>{setBusy(true);setNotice("");try{const photos=await Promise.all(files.map(prepareSwapPhoto));await api("/"+id+"/photos",{photos});setNotice("Photos saved. Refresh to view them.");setFiles([]);}catch(e){setNotice(e instanceof Error?e.message:"Upload failed");}finally{setBusy(false);}}}>Upload photos</button>{notice&&<p role="status">{notice}</p>}</div>;
}
function SwapAddress({offer}:{offer:Offer}){
 const api=useSwapPrivateApi();const [share,setShare]=useState(false),[recipient,setRecipient]=useState<Record<string,string>|null>(null),[open,setOpen]=useState(false),[draft,setDraft]=useState({name:"",line1:"",line2:"",city:"",postcode:"",country:"United Kingdom"}),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 return <div className="rounded-xl border p-3"><button onClick={()=>{setOpen(!open);if(!open)void api("/offers/"+offer.id+"/address").then(d=>{if(d.own)setDraft(d.own);setShare(d.shareShipping===true);setRecipient(d.recipient||null);}).catch(e=>setNotice(e.message));}}>Private delivery address</button>{open&&<form className="space-y-2" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api("/offers/"+offer.id+"/address",{...draft,shareShipping:share});const d=await api("/offers/"+offer.id+"/address");setRecipient(d.recipient||null);setNotice("Address preferences saved.");}catch(e){setNotice(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}}><p>Preview only. Do not enter real delivery details or dispatch products.</p>{(Object.keys(draft) as (keyof typeof draft)[]).map(k=><label key={k} className="block capitalize">{k}<input className={field} maxLength={150} required={k!=="line2"} value={draft[k]} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))}/></label>)}<label className="block"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)}/> Consent to share my test shipping address with the other participant in this zero-cash exchange.</label><button className={button} disabled={busy}>Save private address</button>{recipient&&<div className="rounded-lg border p-3"><strong>Recipient test address</strong>{Object.entries(recipient).map(([k,v])=><p key={k}>{v}</p>)}</div>}</form>}{notice&&<p role="status">{notice}</p>}</div>;
}

function SwapNotificationPreferences(){
 const api=useSwapPrivateApi();const [prefs,setPrefs]=useState<{match_email:boolean;activity_email:boolean}|null>(null),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{void api("/notification-preferences").then(setPrefs).catch(e=>setNotice(e.message));},[]);
 return <section className="space-y-2 rounded-xl border p-4"><h2 className="font-bold">Swap email preferences</h2>{prefs&&<><label className="block"><input type="checkbox" checked={prefs.match_email} onChange={e=>setPrefs(p=>p&&({...p,match_email:e.target.checked}))}/> Email me about mutual swap matches</label><label className="block"><input type="checkbox" checked={prefs.activity_email} onChange={e=>setPrefs(p=>p&&({...p,activity_email:e.target.checked}))}/> Email me about exchange activity</label><button className={button} disabled={busy} onClick={async()=>{setBusy(true);try{await api("/notification-preferences",prefs);setNotice("Preferences saved.");}catch(e){setNotice(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}}>Save preferences</button></>}{notice&&<p role="status">{notice}</p>}</section>;
}
