import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ChevronRight, Search, X, House, Laptop, HeartPulse, Gamepad2, Shirt, Dumbbell, Car, Wrench, PawPrint, Utensils, BriefcaseBusiness, Gem, Package } from "lucide-react";
import { ACTIVE_CATEGORIES, loadThirdLevelTaxonomy, suggestedThirdLevel, thirdLevelSlug } from "@/data/categories";
import { usePublicCategoryVisibility } from "@/hooks/usePublicCategoryVisibility";

type Category = (typeof ACTIVE_CATEGORIES)[number];
const categoryIcons = [House,Laptop,HeartPulse,Gamepad2,Shirt,Dumbbell,Car,Wrench,PawPrint,Utensils,BriefcaseBusiness,Gem,Package];
const iconColours = ["#f97316","#2563eb","#e11d48","#8b5cf6","#6366f1","#ea580c","#0ea5e9","#64748b","#f97316","#d97706","#334155","#9333ea"];


export function CategoryDrawer({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [location] = useLocation();
  const {isActive:categoryIsActive} = usePublicCategoryVisibility();
  const [selected,setSelected] = useState<Category|null>(null);
  const [selectedSub,setSelectedSub] = useState<Category["subcategories"][number]|null>(null);
  const [taxonomyReady,setTaxonomyReady] = useState(false);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    setTaxonomyReady(false);
    loadThirdLevelTaxonomy().then(()=>{if(active)setTaxonomyReady(true);});
    return ()=>{active=false;};
  },[open]);
  const [search,setSearch] = useState("");
  useEffect(()=>{onClose();setSelected(null);setSelectedSub(null);},[location]);
  useEffect(()=>{
    if(!open)return;
    const handleKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    document.addEventListener("keydown",handleKey);
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{document.removeEventListener("keydown",handleKey);document.body.style.overflow=previous;};
  },[open,onClose]);
  const categories=ACTIVE_CATEGORIES.filter(cat=>categoryIsActive(cat.slug)&&cat.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className={`bz-category-drawer-root ${open?"is-open":""}`} aria-hidden={!open}>
      <button type="button" className="bz-category-drawer-backdrop" aria-label="Close category menu" tabIndex={open?0:-1} onClick={onClose}/>
      <aside className="bz-category-drawer" role="dialog" aria-modal={open} aria-label="Shop by category" inert={!open}>
        <header className="bz-category-drawer-header">
          <h2 className="bz-category-drawer-heading">Shop by Category</h2>
          <button type="button" aria-label="Close menu" onClick={onClose}><X size={24}/></button>
        </header>
        {selected && <div className="bz-category-drawer-breadcrumb">
          <button type="button" onClick={()=>selectedSub?setSelectedSub(null):setSelected(null)}><ArrowLeft size={17}/> {selectedSub?selected.name:"Shop by category"}</button>
        </div>}
        <div className="bz-category-drawer-scroll" key={selectedSub?`${selected?.slug}/${selectedSub.slug}`:selected?.slug||"root"}>
          {!selected ? <>
            <div className="bz-category-drawer-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search categories..." aria-label="Find a category"/></div>
            {categories.map((cat,index)=>{const Icon=categoryIcons[index%categoryIcons.length];return <button key={cat.slug} type="button" className="bz-category-drawer-row" onClick={()=>{setSelectedSub(null);setSelected(cat);}}><span className="bz-category-row-title"><Icon size={23} strokeWidth={2.3} style={{color:iconColours[index%iconColours.length]}}/>{cat.name}</span><ChevronRight size={19}/></button>;})}
            {!categories.length&&<p className="p-5 text-sm">No matching categories</p>}
<Link className="bz-category-drawer-view-all bz-category-all-bottom" href="/categories" onClick={onClose}>Shop all categories <ChevronRight size={18}/></Link>

          </> : selectedSub ? <>
            <h2 className="bz-category-drawer-title">{selectedSub.name}</h2>
            <Link className="bz-category-drawer-view-all" href={`/browse?category=${encodeURIComponent(selected.slug)}&sub=${encodeURIComponent(selectedSub.slug)}`} onClick={onClose}>View all {selectedSub.name}<ChevronRight size={18}/></Link>
            {suggestedThirdLevel(selected.slug,selectedSub.slug).map(name=><Link key={thirdLevelSlug(name)} className="bz-category-drawer-row" href={`/browse?category=${encodeURIComponent(selected.slug)}&sub=${encodeURIComponent(selectedSub.slug)}&subsub=${encodeURIComponent(thirdLevelSlug(name))}`} onClick={onClose}><span>{name}</span><ChevronRight size={18}/></Link>)}
          </> : <>
            <h2 className="bz-category-drawer-title">{selected.name}</h2>
            <Link className="bz-category-drawer-view-all" href={`/browse?category=${encodeURIComponent(selected.slug)}`} onClick={onClose}>View all {selected.name}<ChevronRight size={18}/></Link>
            {!taxonomyReady && <p className="p-5 text-sm" role="status">Loading subcategories…</p>}
            {taxonomyReady && selected.subcategories.filter(sub=>categoryIsActive(selected.slug,sub.slug)).map(sub=>{
              const href=`/browse?category=${encodeURIComponent(selected.slug)}&sub=${encodeURIComponent(sub.slug)}`;
              return suggestedThirdLevel(selected.slug,sub.slug).length>0
                ? <button key={sub.slug} type="button" className="bz-category-drawer-row" onClick={()=>setSelectedSub(sub)}><span>{sub.name}</span><ChevronRight size={18}/></button>
                : <Link key={sub.slug} className="bz-category-drawer-row" href={href} onClick={onClose}><span>{sub.name}</span><ChevronRight size={18}/></Link>;
            })}
          </>}
        </div>
        <div className="bz-category-drawer-bottom"><Link href="/support" onClick={onClose}>Help & support</Link><Link href="/sell" onClick={onClose}>Sell on Bazunk</Link></div>
      </aside>
    </div>
  );
}
