import { MILITARY_TECHNOLOGIES } from "./military-tech.js";
import { CIVILIAN_TECHNOLOGIES } from "./civilian-tech.js";
export class TechnologyTree {
 constructor(definitions=[...MILITARY_TECHNOLOGIES,...CIVILIAN_TECHNOLOGIES]) {
  if(!Array.isArray(definitions)) throw new TypeError("Technology definitions must be an array.");
  this.technologies=new Map();
  for(const raw of definitions){if(!raw||typeof raw.id!=="string"||!raw.name||!Number.isFinite(raw.cost)||raw.cost<=0)throw new TypeError("Invalid technology definition.");if(this.technologies.has(raw.id))throw new Error("Duplicate technology: "+raw.id);this.technologies.set(raw.id,Object.freeze({...raw,prerequisites:Object.freeze([...(raw.prerequisites||[])])}));}
  for(const tech of this.technologies.values())for(const p of tech.prerequisites)if(!this.technologies.has(p))throw new Error("Unknown prerequisite "+p+" for "+tech.id);
  this.validateAcyclic();
 }
 validateAcyclic(){const visiting=new Set(),done=new Set();const visit=id=>{if(visiting.has(id))throw new Error("Technology prerequisite cycle at "+id);if(done.has(id))return;visiting.add(id);for(const p of this.technologies.get(id).prerequisites)visit(p);visiting.delete(id);done.add(id);};for(const id of this.technologies.keys())visit(id);}
 get(id){const t=this.technologies.get(String(id));return t?{...t,prerequisites:[...t.prerequisites]}:null;}
 list({category=null,era=null}={}){return [...this.technologies.values()].filter(t=>(!category||t.category===category)&&(era===null||t.era===era)).map(t=>this.get(t.id));}
 isAvailable(id,completed=[]){const t=this.technologies.get(String(id));const set=completed instanceof Set?completed:new Set(completed);return Boolean(t&&t.prerequisites.every(p=>set.has(p)));}
 getAvailable(completed=[]){return this.list().filter(t=>this.isAvailable(t.id,completed));}
}
export default TechnologyTree;