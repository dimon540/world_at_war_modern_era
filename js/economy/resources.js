import { markGameStateDirty } from "../core/game-state.js";
const valid=n=>Number.isFinite(n)&&n>=0;
export class ResourceManager{
 constructor(state){if(!state?.world?.countries||!state?.economy)throw new TypeError("ResourceManager requires world and economy state.");this.state=state;this.resources=state.economy.resources;this.stockpiles=state.economy.stockpiles;this.destroyed=false;}
 #country(id){const key=String(id??"").trim();if(!this.state.world.countries[key])throw new RangeError("Unknown country: "+key);return key;}
 #stock(country,resource){this.stockpiles[country]??=Object.create(null);return this.stockpiles[country][resource]??0;}
 setStockpile(countryId,resource,quantity){if(this.destroyed)throw new Error("ResourceManager destroyed.");const id=this.#country(countryId),key=String(resource??"").trim();if(!key||!valid(quantity))throw new RangeError("Resource and non-negative quantity are required.");this.stockpiles[id]??=Object.create(null);this.stockpiles[id][key]=quantity;markGameStateDirty(this.state);return quantity;}
 add(countryId,resource,quantity){if(!valid(quantity))throw new RangeError("Quantity must be non-negative.");return this.setStockpile(countryId,resource,this.#stock(this.#country(countryId),String(resource))+quantity);}
 consume(countryId,resource,quantity){if(this.destroyed)throw new Error("ResourceManager destroyed.");if(!valid(quantity))throw new RangeError("Quantity must be non-negative.");const id=this.#country(countryId),key=String(resource),available=this.#stock(id,key);if(available+1e-9<quantity)return {success:false,available,required:quantity};this.setStockpile(id,key,available-quantity);return {success:true,remaining:available-quantity};}
 transfer(fromCountryId,toCountryId,resource,quantity){const from=this.#country(fromCountryId),to=this.#country(toCountryId),key=String(resource);if(from===to)throw new RangeError("Cannot transfer resources to the same country.");const removed=this.consume(from,key,quantity);if(!removed.success)return removed;this.add(to,key,quantity);return {success:true,quantity,resource:key,fromCountryId:from,toCountryId:to};}
 getStockpiles(countryId){const id=this.#country(countryId);return {...(this.stockpiles[id]??{})};}
 getWorldTotals(){const totals=Object.create(null);for(const stocks of Object.values(this.stockpiles))for(const [key,value] of Object.entries(stocks))totals[key]=(totals[key]??0)+value;return totals;}
 destroy(){this.destroyed=true;this.state=null;this.resources=null;this.stockpiles=null;}
}
export default ResourceManager;