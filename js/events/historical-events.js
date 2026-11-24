import { EventManager } from "./event-manager.js";
export class HistoricalEventManager{
 constructor(state,eventBus,options={}){this.state=state;this.events=new EventManager(state,eventBus);this.definitions=options.definitions??[];this.loaded=false;this.destroyed=false;}
 load(definitions=this.definitions){if(this.destroyed)throw new Error("HistoricalEventManager destroyed.");if(!Array.isArray(definitions))throw new TypeError("Historical event definitions must be an array.");let count=0;for(const item of definitions){if(!item||!item.id||!item.date)continue;if(this.state.events.historicalEvents[item.id])continue;const definition={...item,historical:true};this.state.events.historicalEvents[item.id]=definition;this.events.schedule(definition);count++;}this.loaded=true;return count;}
 processDaily(date){if(this.destroyed)throw new Error("HistoricalEventManager destroyed.");return this.events.processDaily(date).filter(e=>e.historical);}
 destroy(){if(this.destroyed)return;this.events.destroy();this.state=null;this.destroyed=true;}
}
export default HistoricalEventManager;