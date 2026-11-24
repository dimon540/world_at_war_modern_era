import { EventManager } from "./event-manager.js";
const TEMPLATES=[
{id:"economic_expansion",name:"Economic Expansion",weight:3,cooldown:180,effects:{growthDelta:0.005,stabilityDelta:1}},
{id:"economic_slowdown",name:"Economic Slowdown",weight:2,cooldown:180,effects:{growthDelta:-0.007,stabilityDelta:-1}},
{id:"public_protests",name:"Public Protests",weight:2,cooldown:120,effects:{stabilityDelta:-3}},
{id:"administrative_reform",name:"Administrative Reform",weight:2,cooldown:240,effects:{stabilityDelta:2}},
{id:"industrial_investment",name:"Industrial Investment",weight:2,cooldown:240,effects:{growthDelta:0.004,stabilityDelta:1}}
];
export class WorldEventManager{
 constructor(state,eventBus,options={}){this.state=state;this.events=new EventManager(state,eventBus);this.templates=options.templates??TEMPLATES;this.dailyChance=options.dailyChance??0.0015;this.random=options.random??Math.random;this.lastTriggered=Object.create(null);this.destroyed=false;if(!Number.isFinite(this.dailyChance)||this.dailyChance<0||this.dailyChance>1)throw new RangeError("dailyChance must be between zero and one.");}
 processDaily(date){if(this.destroyed)throw new Error("WorldEventManager destroyed.");const today=typeof date==="string"?date:[date.year,String(date.month).padStart(2,"0"),String(date.day).padStart(2,"0")].join("-");const fired=[];for(const countryId of Object.keys(this.state.world.countries)){if(this.random()>=this.dailyChance)continue;const total=this.templates.reduce((n,t)=>n+t.weight,0);let pick=this.random()*total,chosen=this.templates[this.templates.length-1];for(const t of this.templates){pick-=t.weight;if(pick<=0){chosen=t;break;}}const previous=this.lastTriggered[countryId];if(previous&&Math.floor((Date.parse(today)-Date.parse(previous))/86400000)<chosen.cooldown)continue;const id="world:"+countryId+":"+today+":"+chosen.id;this.events.schedule({id,date:today,countryId,name:chosen.name,type:chosen.id,effects:{...chosen.effects},historical:false});fired.push(this.events.trigger(id,{date:today,source:"world_ai"}));this.lastTriggered[countryId]=today;}return fired;}
 destroy(){if(this.destroyed)return;this.events.destroy();this.state=null;this.templates=null;this.destroyed=true;}
}
export default WorldEventManager;