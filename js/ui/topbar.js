export class TopbarController{
 constructor(game,root=document){this.game=game;this.root=root;this.date=root.querySelector("#game-date");this.speed=root.querySelector("#game-speed");this.status=root.querySelector("#game-status");}
 render(){if(!this.game)return;const d=this.game.clock.getSnapshot();if(this.date)this.date.textContent=new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(d.date.year,d.date.month-1,d.date.day)));if(this.speed)this.speed.textContent="×"+d.speed;if(this.status){this.status.textContent=this.game.status==="running"?"Simulation running":"Paused";this.status.dataset.state=this.game.status==="running"?"running":"paused";}}
 destroy(){this.game=null;this.root=null;}
}
export default TopbarController;