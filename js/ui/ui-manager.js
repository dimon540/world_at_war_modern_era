import { TopbarController } from "./topbar.js";
import { CountryPanel } from "./country-panel.js";
import { ProvincePanel } from "./province-panel.js";
import { ArmyPanel } from "./army-panel.js";
import { EconomyPanel } from "./economy-panel.js";
import { DiplomacyPanel } from "./diplomacy-panel.js";
import { ResearchPanel } from "./research-panel.js";
import { NotificationCenter } from "./notifications.js";
export class UIManager{
 constructor(game,root=document){if(!game)throw new TypeError("UIManager requires a game instance.");this.game=game;this.root=root;this.topbar=new TopbarController(game,root);this.country=new CountryPanel(game,root);this.province=new ProvincePanel(game,root);this.army=new ArmyPanel(game,root);this.economy=new EconomyPanel(game,root);this.diplomacy=new DiplomacyPanel(game,root);this.research=new ResearchPanel(game,root);this.notifications=new NotificationCenter(game.eventBus,root);this.activePanel="country";this.bindTabs();this.renderAll();}
 bindTabs(){for(const button of this.root.querySelectorAll("[data-panel-tab]"))button.addEventListener("click",()=>this.showPanel(button.dataset.panelTab));}
 showPanel(name){const panel=this.root.querySelector("#panel-"+name);if(!panel)return false;for(const item of this.root.querySelectorAll("[data-panel-tab]"))item.setAttribute("aria-selected",String(item.dataset.panelTab===name));for(const item of this.root.querySelectorAll("[data-management-panel]"))item.hidden=item.id!=="panel-"+name;this.activePanel=name;return true;}
 renderAll(){this.topbar.render();this.country.render();this.province.render();this.army.render();this.economy.render();this.diplomacy.render();this.research.render();}
 refreshCountry(){this.renderAll();}
 destroy(){this.notifications.destroy();this.research.destroy();this.diplomacy.destroy();this.economy.destroy();this.army.destroy();this.province.destroy();this.country.destroy();this.topbar.destroy();this.game=null;this.root=null;}
}
export default UIManager;