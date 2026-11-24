import { markGameStateDirty } from "../core/game-state.js";
export const NATIONAL_FOCUSES=Object.freeze([
{id:"industrial_recovery",name:"Industrial Recovery",cost:70,category:"industry",prerequisites:[],effects:{civilianIndustry:1}},
{id:"defense_modernization",name:"Defense Modernization",cost:70,category:"military",prerequisites:[],effects:{militaryReadiness:0.05}},
{id:"foreign_policy_review",name:"Foreign Policy Review",cost:55,category:"diplomacy",prerequisites:[],effects:{diplomaticInfluence:1}},
{id:"education_investment",name:"Education Investment",cost:80,category:"society",prerequisites:["industrial_recovery"],effects:{research:0.05}},
{id:"advanced_industry",name:"Advanced Industry",cost:100,category:"industry",prerequisites:["industrial_recovery"],effects:{civilianIndustry:2}}
]);
export class NationalFocusManager{
 constructor(state,options={}){if(!state?.world?.countries||!state?.politics)throw new TypeError("NationalFocusManager requires world and politics state.");this.state=state;this.focuses=new Map((options.focuses??NATIONAL_FOCUSES).map(x=>[x.id,x]));if(!state.politics.nationalFocus)state.politics.nationalFocus=Object.create(null);this.progress=state.politics.nationalFocus;this.destroyed=false;}
 #active(){if(this.destroyed)throw new Error("NationalFocusManager has been destroyed.");}
 getAvailable(countryId){this.#active();const id=String(countryId);if(!this.state.world.countries[id])throw new RangeError("Unknown country: "+id);const data=this.progress[id]??{completed:[],active:null};return [...this.focuses.values()].filter(f=>!data.completed.includes(f.id)&&f.prerequisites.every(p=>data.completed.includes(p))).map(f=>({...f,prerequisites:[...f.prerequisites],effects:{...f.effects}}));}
 start(countryId,focusId){this.#active();const id=String(countryId),data=this.progress[id]??(this.progress[id]={completed:[],active:null,progress:0});if(data.active)throw new Error("A national focus is already active.");const focus=this.getAvailable(id).find(x=>x.id===focusId);if(!focus)throw new Error("Focus is unavailable or its prerequisites are incomplete.");data.active=focus.id;data.progress=0;markGameStateDirty(this.state);return {...focus};}
 advance(countryId,points=1){this.#active();if(!Number.isFinite(points)||points<0)throw new RangeError("Focus points must be non-negative.");const id=String(countryId),data=this.progress[id];if(!data?.active||points===0)return null;const focus=this.focuses.get(data.active);data.progress+=points;if(data.progress<focus.cost){markGameStateDirty(this.state);return {completed:false,progress:data.progress,cost:focus.cost};}data.completed.push(focus.id);data.active=null;data.progress=0;const effects={...focus.effects};this.state.politics.focusEffects??=Object.create(null);this.state.politics.focusEffects[id]??={};Object.assign(this.state.politics.focusEffects[id],effects);markGameStateDirty(this.state);return {completed:true,focusId:focus.id,effects};}
 destroy(){this.destroyed=true;this.state=null;this.progress=null;this.focuses.clear();}
}
export default NationalFocusManager;