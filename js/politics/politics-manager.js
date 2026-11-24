import { GovernmentManager } from "./government.js";
import { ElectionManager } from "./elections.js";
import { StabilityManager } from "./stability.js";
import { DecisionManager } from "./decisions.js";
import { NationalFocusManager } from "./national-focus.js";
import { gameEventBus } from "../core/event-bus.js";
const dateString=value=>{if(typeof value==="string")return value;if(value&&Number.isInteger(value.year)&&Number.isInteger(value.month)&&Number.isInteger(value.day))return [value.year,String(value.month).padStart(2,"0"),String(value.day).padStart(2,"0")].join("-");return null;};
export class PoliticsManager{
 constructor(state,eventBus=gameEventBus,options={}){if(!state?.world?.countries||!state?.politics)throw new TypeError("PoliticsManager requires initialized world and politics state.");this.state=state;this.governments=new GovernmentManager(state,eventBus,options.government);this.elections=new ElectionManager(state,eventBus);this.stability=new StabilityManager(state,this.governments,eventBus,options.stability);this.decisions=new DecisionManager(state,options.decisions);this.nationalFocus=new NationalFocusManager(state,options.nationalFocus);this.destroyed=false;}
 processDaily(date){if(this.destroyed)throw new Error("PoliticsManager has been destroyed.");const normalized=dateString(date);return normalized?this.elections.processDue(normalized):[];}
 processMonthly(modifiers){if(this.destroyed)throw new Error("PoliticsManager has been destroyed.");return this.stability.processMonthly(modifiers);}
 getSnapshot(){if(this.destroyed)throw new Error("PoliticsManager has been destroyed.");return this.governments.getSnapshot();}
 destroy(){if(this.destroyed)return;this.nationalFocus.destroy();this.decisions.destroy();this.stability.destroy();this.elections.destroy();this.governments.destroy();this.destroyed=true;this.state=null;}
}
export default PoliticsManager;