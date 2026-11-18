// ZAIDA flat-vector character rig (Canvas renderer).
// Parts are drawn independently around pivots so the character can be animated
// without generated images or external assets.
const C={skin:"#f2a06f",skinShade:"#d77e55",hair:"#20233e",shirt:"#426fc5",shirtShade:"#3159a4",eye:"#252b45",mouth:"#6f2635",tongue:"#f28b91",cheek:"#e98279",tear:"#8bd3ed",white:"#fff7ef"};
function ellipse(ctx,x,y,rx,ry,fill,rotation=0){ctx.beginPath();ctx.ellipse(x,y,rx,ry,rotation,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill()}
function line(ctx,points,color,width){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke()}
function smooth(t){return t*t*(3-2*t)}
export function drawFlatCharacter(ctx,cx,cy,scale,time=0,expression="neutral"){
 const yawning=expression==="yawn",sleepy=expression==="sleepy",surprised=expression==="surprised";
 const cycle=((time%4)+4)%4,open=yawning?smooth(Math.min(1,Math.max(0,(cycle-.35)/.55)))*(1-smooth(Math.min(1,Math.max(0,(cycle-2.4)/.55)))):surprised ? 0.8 : 0;
 const blink=(Math.abs(time%3.7-3.45)<.12)?Math.max(.12,Math.abs(time%3.7-3.45)/.12):1;
 const bob=Math.sin(time*2.2)*3,tilt=yawning?Math.sin(time*1.7)*.035:Math.sin(time*1.2)*.012;
 ctx.save();ctx.translate(cx,cy+bob);ctx.scale(scale,scale);ctx.rotate(tilt);
 // Shirt and shoulders
 ctx.beginPath();ctx.moveTo(-116,132);ctx.quadraticCurveTo(-108,60,-52,56);ctx.lineTo(52,56);ctx.quadraticCurveTo(108,60,116,132);ctx.closePath();ctx.fillStyle=C.shirt;ctx.fill();
 ctx.beginPath();ctx.moveTo(-42,58);ctx.quadraticCurveTo(0,82,42,58);ctx.lineTo(28,48);ctx.lineTo(-28,48);ctx.closePath();ctx.fillStyle=C.skin;ctx.fill();
 // Ears
 ellipse(ctx,-83,-18,15,22,C.skinShade);ellipse(ctx,83,-18,15,22,C.skinShade);
 // Head
 ellipse(ctx,0,-30,82,91,C.skin);
 // Hair cap and fringe
 ctx.beginPath();ctx.moveTo(-81,-28);ctx.quadraticCurveTo(-94,-119,-12,-122);ctx.quadraticCurveTo(77,-128,84,-43);ctx.quadraticCurveTo(55,-76,27,-77);ctx.quadraticCurveTo(-8,-62,-42,-70);ctx.quadraticCurveTo(-65,-68,-81,-28);ctx.closePath();ctx.fillStyle=C.hair;ctx.fill();
 // Cheeks
 ellipse(ctx,-48,2,13,7,"#e98978");ellipse(ctx,48,2,13,7,"#e98978");
 // Brows
 line(ctx,[[-48,-48],[-35,-52],[-23,-49]],C.hair,5);line(ctx,[[23,-49],[35,-52],[48,-48]],C.hair,5);
 // Eyes blink as flattened ovals
 ellipse(ctx,-34,-31,7,Math.max(1,7*blink),C.eye);ellipse(ctx,34,-31,7,Math.max(1,7*blink),C.eye);
 // Nose
 line(ctx,[[-1,-21],[2,-12]],C.skinShade,3);
 // Mouth states
 if(open>.08||yawning||surprised){ctx.beginPath();ctx.ellipse(0,20,13+open*12,5+open*22,0,0,Math.PI*2);ctx.fillStyle=C.mouth;ctx.fill();if(open>.35){ctx.beginPath();ctx.ellipse(0,35,open*10,open*7,0,0,Math.PI*2);ctx.fillStyle=C.tongue;ctx.fill()}}
 else if(sleepy){line(ctx,[[-12,20],[0,24],[12,20]],C.mouth,4)}
 else{line(ctx,[[-12,18],[0,21],[12,18]],C.mouth,4)}
 // Tear bead while yawning
 if(yawning){const tearY=-2+Math.sin(time*3)*2;ellipse(ctx,-64,12,5,9,C.tear,-.25)}
 // Tiny highlight
 ellipse(ctx,-57,-66,5,3,"#ffffff66");
 ctx.restore();
}
