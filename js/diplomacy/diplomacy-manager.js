/* WORLD AT WAR: unified diplomacy subsystem facade. */
import { CountryRelations } from "./relations.js";
import { AllianceManager } from "./alliances.js";
import { WarManager } from "./wars.js";
import { SanctionManager } from "./sanctions.js";
import { PeaceManager } from "./peace.js";
import { gameEventBus } from "../core/event-bus.js";
export class DiplomacyManager {
 constructor(state,eventBus=gameEventBus){if(!state?.world?.countries||!state?.diplomacy)throw new TypeError("DiplomacyManager requires initialized world and diplomacy state.");this.state=state;this.eventBus=eventBus;this.destroyed=false;this.relations=new CountryRelations(state,eventBus);this.alliances=new AllianceManager(state,eventBus);this.wars=new WarManager(state,eventBus);this.sanctions=new SanctionManager(state,eventBus);this.peace=new PeaceManager(state,this.wars,eventBus);}
 #active(){if(this.destroyed)throw new Error("DiplomacyManager has been destroyed.");}
 getSnapshot(){this.#active();return {relations:this.relations.getSnapshot(),alliances:this.alliances.listAlliances().length,wars:this.wars.listWars({status:"active"}).length,sanctions:this.sanctions.list({status:"active"}).length,pendingPeaceProposals:this.peace.list({status:"proposed"}).length};}
 processDaily(date=null){this.#active();return {expiredSanctions:this.sanctions.expire(date)};}
 destroy(){if(this.destroyed)return;this.peace.destroy();this.sanctions.destroy();this.wars.destroy();this.alliances.destroy();this.relations.destroy();this.destroyed=true;this.state=null;this.eventBus=null;}
}
export default DiplomacyManager;