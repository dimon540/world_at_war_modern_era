import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";
import { TechnologyTree } from "./technology-tree.js";
const isRecord=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const required=(v,label)=>{const s=String(v??"").trim();if(!s)throw new TypeError(label+" is required.");return s;};
export class ResearchManager {
 constructor(state,eventBus=gameEventBus,options={}) {
  if(!state?.world?.countries||!state?.technology)throw new TypeError("ResearchManager requires world and technology state.");
  this.state=state;this.eventBus=eventBus;this.tree=options.tree??new TechnologyTree(options.definitions);
  this.options={defaultResearchPoints:10,maxConcurrentProjects:3,...options};
  if(!Number.isFinite(this.options.defaultResearchPoints)||this.options.defaultResearchPoints<0)throw new RangeError("defaultResearchPoints must be non-negative.");
  if(!Number.isInteger(this.options.maxConcurrentProjects)||this.options.maxConcurrentProjects<1)throw new RangeError("maxConcurrentProjects must be positive.");
  if(!isRecord(state.technology.countryResearch))state.technology.countryResearch=Object.create(null);
  if(!isRecord(state.technology.researchProjects))state.technology.researchProjects=Object.create(null);
  this.countryResearch=state.technology.countryResearch;this.destroyed=false;
 }
 #active(){if(this.destroyed)throw new Error("ResearchManager has been destroyed.");}
 #country(value){const id=required(value,"Country ID");if(!this.state.world.countries[id])throw new RangeError("Unknown country: "+id);return id;}
 #data(id){if(!isRecord(this.countryResearch[id]))this.countryResearch[id]={completed:[],projects:[],researchPoints:this.options.defaultResearchPoints,modifiers:{}};return this.countryResearch[id];}
 getCountryResearch(countryId){this.#active();return structuredClone(this.#data(this.#country(countryId)));}
 setResearchPoints(countryId,points){this.#active();if(!Number.isFinite(points)||points<0)throw new RangeError("Research points must be non-negative.");this.#data(this.#country(countryId)).researchPoints=points;markGameStateDirty(this.state);return points;}
 startResearch(countryId,technologyId,{priority=0}={}) {
  this.#active();const id=this.#country(countryId),techId=required(technologyId,"Technology ID"),tech=this.tree.get(techId),data=this.#data(id);
  if(!tech)throw new RangeError("Unknown technology: "+techId);
  if(data.completed.includes(techId))throw new Error("Technology is already completed.");
  if(data.projects.some(p=>p.technologyId===techId))throw new Error("Technology is already being researched.");
  if(data.projects.length>=this.options.maxConcurrentProjects)throw new RangeError("Country research queue is full.");
  if(!this.tree.isAvailable(techId,data.completed))throw new Error("Technology prerequisites are not completed.");
  if(!Number.isFinite(priority))throw new TypeError("Research priority must be numeric.");
  const project={id:id+":"+techId,countryId:id,technologyId:techId,progress:0,cost:tech.cost,priority,startedAt:structuredClone(this.state.clock?.date??null),status:"active"};
  data.projects.push(project);data.projects.sort((a,b)=>b.priority-a.priority);this.state.technology.researchProjects[project.id]=project;
  markGameStateDirty(this.state);this.eventBus?.emit?.(GAME_EVENTS.RESEARCH_STARTED,{countryId:id,project:structuredClone(project)});return structuredClone(project);
 }
 cancelResearch(countryId,technologyId){this.#active();const id=this.#country(countryId),data=this.#data(id),index=data.projects.findIndex(p=>p.technologyId===technologyId);if(index<0)return false;const [project]=data.projects.splice(index,1);delete this.state.technology.researchProjects[project.id];markGameStateDirty(this.state);return true;}
 processMonthly({pointsByCountry=null}={}) {
  this.#active();const completed=[];
  for(const countryId of Object.keys(this.state.world.countries)){
   const data=this.#data(countryId),supplied=isRecord(pointsByCountry)?pointsByCountry[countryId]:undefined;
   let budget=Number.isFinite(supplied)?Math.max(0,supplied):Math.max(0,data.researchPoints);
   for(const project of data.projects){if(budget<=0)break;const spent=Math.min(project.cost-project.progress,budget);project.progress+=spent;budget-=spent;
    if(project.progress>=project.cost){project.status="completed";data.completed.push(project.technologyId);delete this.state.technology.researchProjects[project.id];completed.push({countryId,technologyId:project.technologyId});this.eventBus?.emit?.(GAME_EVENTS.RESEARCH_COMPLETED,{countryId,technologyId:project.technologyId});}
   }
   data.projects=data.projects.filter(p=>p.status==="active");for(const p of data.projects)this.state.technology.researchProjects[p.id]=p;
  }
  this.state.technology.statistics.completedTechnologies=Object.values(this.countryResearch).reduce((n,x)=>n+x.completed.length,0);
  this.state.technology.statistics.activeResearchProjects=Object.values(this.countryResearch).reduce((n,x)=>n+x.projects.length,0);
  if(completed.length)markGameStateDirty(this.state);return completed;
 }
 getAvailable(countryId){this.#active();const data=this.#data(this.#country(countryId));return this.tree.getAvailable(data.completed);}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.state=null;this.eventBus=null;this.countryResearch=null;this.tree=null;}
}
export default ResearchManager;