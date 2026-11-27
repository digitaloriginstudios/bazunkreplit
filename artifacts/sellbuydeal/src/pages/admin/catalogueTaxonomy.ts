import { CATEGORIES } from "@/data/categories";

export interface CatalogueCategory {
  category_slug: string;
  subcategory_slug: string;
  name: string;
  sort_order: number;
  visible: boolean;
}

export function catalogueTaxonomy(overrides: CatalogueCategory[]): CatalogueCategory[] {
  const items = new Map<string, CatalogueCategory>();
  for (const [index, category] of CATEGORIES.entries()) {
    items.set(category.slug + ":", {
      category_slug: category.slug, subcategory_slug: "", name: category.name, sort_order: index, visible: true,
    });
    for (const [order, subcategory] of category.subcategories.entries()) {
      items.set(category.slug + ":" + subcategory.slug, {
        category_slug: category.slug, subcategory_slug: subcategory.slug, name: subcategory.name, sort_order: order, visible: true,
      });
    }
  }
  for (const item of overrides) {
    if (items.has(item.category_slug + ":")) items.set(item.category_slug + ":" + item.subcategory_slug, item);
  }
  return [...items.values()].sort((a, b) => a.sort_order - b.sort_order);
}
