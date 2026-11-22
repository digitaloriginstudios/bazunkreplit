import { useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Grid3X3, Search, ShoppingBag } from "lucide-react";
import { ACTIVE_CATEGORIES } from "@/data/categories";
import { usePublicCategoryVisibility } from "@/hooks/usePublicCategoryVisibility";

/** A dedicated category directory, separate from the listing browser. */
export function CategoriesPage() {
  const { isActive } = usePublicCategoryVisibility();
  const [query, setQuery] = useState("");
  const categories = ACTIVE_CATEGORIES.filter(category => isActive(category.slug) &&
    (category.name.toLowerCase().includes(query.toLowerCase()) ||
      category.subcategories.some(sub => isActive(category.slug, sub.slug) && sub.name.toLowerCase().includes(query.toLowerCase()))));
  return <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6">
    <section className="rounded-3xl bg-gradient-to-br from-[#071e38] to-[#12558b] px-5 py-7 text-white sm:px-8">
      <div className="flex items-center gap-3"><Grid3X3 className="h-8 w-8 text-orange-400"/><h1 className="text-3xl font-black">Shop by Category</h1></div>
      <p className="mt-2 text-sm text-slate-100 sm:text-base">Explore departments and subcategories to find exactly what you need.</p>
      <Link href="/browse" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white">Browse all listings <ChevronRight className="h-4 w-4"/></Link>
    </section>
    <label className="mt-5 flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 text-slate-800">
      <Search className="h-5 w-5 text-slate-600"/>
      <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a category..." aria-label="Find a category" className="min-w-0 flex-1 bg-transparent py-3 text-base text-slate-900 outline-none"/>
    </label>
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map(category => <section key={category.slug} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Link href={`/browse?category=${encodeURIComponent(category.slug)}`} className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3 py-3 text-base font-bold text-[#123c66] hover:bg-blue-100">
          <span className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-orange-600"/>{category.name}</span><ChevronRight className="h-5 w-5 shrink-0"/>
        </Link>
        <div className="mt-2 flex flex-col">
          {category.subcategories.filter(sub=>isActive(category.slug,sub.slug) && (!query || category.name.toLowerCase().includes(query.toLowerCase()) || sub.name.toLowerCase().includes(query.toLowerCase()))).map(sub=>
            <Link key={sub.slug} href={`/browse?category=${encodeURIComponent(category.slug)}&sub=${encodeURIComponent(sub.slug)}`} className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-800">{sub.name}<ChevronRight className="h-4 w-4 shrink-0"/></Link>
          )}
        </div>
      </section>)}
    </div>
    {!categories.length && <p className="py-12 text-center text-slate-700">No matching categories found.</p>}
  </main>;
}
