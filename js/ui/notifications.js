export class NotificationCenter{
 constructor(eventBus,root=document,options={}){this.eventBus=eventBus;this.root=root;this.container=root.querySelector("#game-message");this.maxItems=options.maxItems??50;this.items=[];this.unsubscribers=[];this.bind();}
 bind(){if(!this.eventBus)return;for(const [event,type] of [["war:declared","warning"],["war:ended","success"],["event:world","info"],["event:historical","info"],["event:crisis_started","warning"],["politics:government_changed","info"],["technology:research_completed","success"]])this.unsubscribers.push(this.eventBus.on(event,p=>this.push(p?.event?.name??p?.war?.name??p?.event?.type??p?.reason??event,type)));}
 push(message,type="info"){const item={message:String(message),type,date:new Date().toISOString()};this.items.unshift(item);this.items=this.items.slice(0,this.maxItems);if(this.container){this.container.textContent=item.message;this.container.dataset.type=type;}return item;}
 destroy(){for(const off of this.unsubscribers)off();this.unsubscribers=[];this.eventBus=null;this.root=null;this.container=null;}
}
export default NotificationCenter;