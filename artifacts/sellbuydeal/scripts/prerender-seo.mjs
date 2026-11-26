import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const dist=resolve(dirname(fileURLToPath(import.meta.url)),"../dist");
const origin="https://www.bazunk.com";
const pages=[
["marketplace/uk","Shop online in United Kingdom","Browse marketplace products for UK shoppers, compare domestic delivery options and check postage before buying."],
["marketplace/us","Shop online in United States","Discover marketplace products for US shoppers, check international shipping eligibility and review estimated dollar prices."],
["marketplace/ireland","Shop online in Ireland","Explore marketplace shopping for Ireland, check delivery from overseas sellers and review estimated euro prices."],
["marketplace/canada","Shop online in Canada","Discover marketplace listings for Canadian shoppers and check shipping eligibility and estimated Canadian dollar prices."],
["marketplace/australia","Shop online in Australia","Explore marketplace listings for Australian shoppers, compare overseas delivery options and estimated Australian dollar prices."],
["","Buy, sell and bid online","Discover new and used products, auctions and deals from independent sellers on Bazunk."],
["browse","Browse marketplace listings","Explore new and used products from independent marketplace sellers."],
["deals","Latest deals and offers","Explore promoted listings and limited-time offers on Bazunk."],
["under-5","Products under £5","Discover affordable marketplace products with item prices below five pounds."],
["under-10","Products under £10","Shop budget-friendly marketplace products below ten pounds."],
["99p-auctions","99p auctions","Explore live auctions with starting bids of 99p or less."],
["christmas","Christmas shopping and gifts","Discover festive products, stocking fillers and Christmas gifts on Bazunk."],
["trending","Trending products","Explore popular marketplace listings ranked by views and watchers."],
["new-arrivals","New arrivals","Discover marketplace products listed in the last seven days."],
["price-drops","Recent price drops","Explore listings with recorded price reductions in the last 30 days."],
["ending-soon","Auctions ending soon","Explore auctions closing within the next 24 hours."],
["free-delivery","Products with free delivery","Browse marketplace listings with an explicitly zero delivery charge."],
["gift-finder","Gift finder","Discover gift ideas and narrow your selection by budget."],
["local","Local marketplace","Search seller-provided dispatch locations by town or city."],
["auctions","Online auctions","Bid on active marketplace auctions and discover unique finds."],
["flash-sales","Flash sales","Explore limited-time marketplace offers."],
["eco","Eco marketplace","Explore listings marked eco-friendly or recyclable."],
["affiliates","Affiliate programme","Apply to join the Bazunk affiliate programme and access your affiliate dashboard."]
];
const escape=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const original=await readFile(resolve(dist,"index.html"),"utf8");
for(const [slug,label,description] of pages){
const url=origin+"/"+slug,title=label+" | Bazunk";
let html=original.replace(/<title>[^]*?<\/title>/i,"<title>"+escape(title)+"</title>");
html=html.replace(/<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>\s*/gi,"").replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi,"");
const tags=[["name","description",description],["name","robots","index, follow"],["property","og:title",title],["property","og:description",description],["property","og:type","website"],["property","og:url",url],["property","og:site_name","Bazunk"],["property","og:image",origin+"/bazunk-brand-icon.png"],["name","twitter:card","summary"],["name","twitter:title",title],["name","twitter:description",description],["name","twitter:image",origin+"/bazunk-brand-icon.png"]];
const schema={"@context":"https://schema.org","@type":slug?"CollectionPage":"WebPage",name:title,description,url,isPartOf:{"@type":"WebSite",name:"Bazunk",url:origin}};
html=html.replace("</head>",tags.map(([attr,key,value])=>'<meta '+attr+'="'+key+'" content="'+escape(value)+'" />').join("\n")+'\n<link rel="canonical" href="'+url+'" />\n<script type="application/ld+json">'+JSON.stringify(schema).replaceAll("<","\\u003c")+'</script>\n</head>');
assert.equal((html.match(/rel="canonical"/g)||[]).length,1);
assert.ok(html.includes('<title>'+escape(title)+'</title>'));
assert.ok(html.includes('property="og:url" content="'+url+'"'));
assert.ok(html.includes('id="root"'));
const target=resolve(dist,slug,"index.html");await mkdir(dirname(target),{recursive:true});await writeFile(target,html);
if(slug)await writeFile(resolve(dist,slug+".html"),html);
}
console.log("SEO HTML generated and validated for "+pages.length+" routes");
