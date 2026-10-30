import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {RoundedBoxGeometry} from './vendor/RoundedBoxGeometry.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {ROUTES,VEHICLES,positionOnRoute} from './engine.js';

const PALETTE=[0xd9e4dc,0x467f8e,0xe8b27a,0xb6c957,0xa46456,0x354a60];
export class TrafficScene{
  constructor(container,onSelect){
    this.container=container;this.onSelect=onSelect;this.batches=[];this.bodyMeshes=[];this.current=[];
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.setClearColor(0xe6eadf);container.append(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xe6eadf);this.scene.fog=new THREE.Fog(0xe6eadf,220,420);
    this.camera=new THREE.PerspectiveCamera(37,1,.5,650);this.camera.position.set(75,95,95);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,0,0);this.controls.enableDamping=true;this.controls.dampingFactor=.08;
    this.controls.maxPolarAngle=Math.PI/2-.08;this.controls.minDistance=32;this.controls.maxDistance=250;this.controls.maxTargetRadius=65;
    this.scene.add(new THREE.HemisphereLight(0xf4f7e6,0x6a7764,2.5));
    const sun=new THREE.DirectionalLight(0xfff0d4,3.1);sun.position.set(-75,130,60);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.left=-140;sun.shadow.camera.right=140;sun.shadow.camera.top=140;sun.shadow.camera.bottom=-140;sun.shadow.camera.near=1;sun.shadow.camera.far=350;sun.shadow.normalBias=.06;sun.shadow.bias=-.00015;this.scene.add(sun);
    this.materials=new Map();this.conceptWorld=new THREE.Group();this.scene.add(this.conceptWorld);this.buildingWorld=true;this.buildWorld();this.buildingWorld=false;this.conceptSignals=this.signals;this.buildVehicles();this.cameraScale=1;
    this.resize=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();});this.resize.observe(container);
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();let down=null;
    this.renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
    this.renderer.domElement.addEventListener('click',e=>{
      if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
      const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);const hit=this.raycaster.intersectObjects(this.bodyMeshes,false)[0];
      const vehicle=hit?hit.object.userData.vehicles?.[hit.instanceId]:null;this.onSelect(vehicle||null);
    });
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();container.dispatchEvent(new CustomEvent('rendererror',{detail:'3D graphics context was lost. Reload to restore the scene.'}));});
    this.dummy=new THREE.Object3D();this.color=new THREE.Color();this.cameraMode='orbit';
  }
  mat(color,options={}){const key=color+JSON.stringify(options);if(!this.materials.has(key))this.materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.75,...options}));return this.materials.get(key);}
  mesh(geometry,material,x=0,y=0,z=0){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;(this.buildingWorld?this.conceptWorld:this.scene).add(mesh);return mesh;}
  box(w,h,d,x,y,z,color,round=0){return this.mesh(round?new RoundedBoxGeometry(w,h,d,2,round):new THREE.BoxGeometry(w,h,d),this.mat(color),x,y,z);}
  text(text,w,h,{background='#f0f2e6',color='#344742',size=64}={}){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,1024,256);c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.font='500 '+size+'px system-ui';c.fillText(text,512,128,970);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
  }
  buildWorld(){
    this.box(244,2,244,0,-1.8,0,0xb2bea5,2);
    this.box(240,.5,240,0,-.55,0,0xc4cfb6,2);
    this.box(220,.22,26,0,-.13,0,0xdddccd);
    this.box(26,.22,220,0,-.12,0,0xdddccd);
    this.box(212,.18,20.6,0,0,0,0x414e50);
    this.box(20.6,.19,212,0,.005,0,0x414e50);
    // Raised medians stop before the intersection; all traffic keeps left.
    for(const sign of [-1,1]){this.box(.45,.18,85,0,.15,sign*62,0xdcd9bb,.1);this.box(85,.18,.45,sign*62,.15,0,0xdcd9bb,.1);}
    for(const dir of ['N','S','E','W']){
      const rotation={N:0,S:Math.PI,E:-Math.PI/2,W:Math.PI/2}[dir];
      const group=new THREE.Group();group.rotation.y=rotation;
      // In local coordinates N traffic enters toward +Z on positive X.
      for(const x of [-6.6,-3.3,3.3,6.6])for(let z=-98;z<-18;z+=7){const m=new THREE.Mesh(new THREE.BoxGeometry(.1,.025,3),this.mat(0xe4e5d1));m.position.set(x,.13,z);group.add(m);}
      const line=new THREE.Mesh(new THREE.BoxGeometry(9.4,.03,.35),this.mat(0xf2f1da));line.position.set(5,.14,-14.7);group.add(line);
      for(let x=-9;x<10;x+=1.5){const m=new THREE.Mesh(new THREE.BoxGeometry(.7,.035,2.2),this.mat(0xe6e7da));m.position.set(x,.14,-12.7);group.add(m);}
      for(const x of [1.65,4.95,8.25]){
        const shape=new THREE.Shape();
        const points=x===4.95?[[-.25,-1.8],[.25,-1.8],[.25,.7],[.8,.7],[0,1.7],[-.8,.7],[-.25,.7]]:[[-.25,-1.8],[.25,-1.8],[.25,.2],[.9,.2],[.9,-.4],[1.9,.5],[.9,1.4],[.9,.8],[-.25,.8]].map(([a,b])=>[a*(x===1.65?-1:1),b]);
        points.forEach(([a,b],i)=>i?shape.lineTo(a,b):shape.moveTo(a,b));shape.closePath();
        const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),this.mat(0xd6dacb,{side:THREE.DoubleSide}));arrow.rotation.x=Math.PI/2;arrow.position.set(x,.145,-28);group.add(arrow);
      }
      this.conceptWorld.add(group);
    }
    // A small conceptual campus/city context, not a surveyed reconstruction.
    let seed=91;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(const sx of [-1,1])for(const sz of [-1,1]){
      for(let i=0;i<4;i++){
        const x=sx*(35+(i%2)*33),z=sz*(40+Math.floor(i/2)*34),height=8+rand()*12,w=19+rand()*8,d=15+rand()*8;
        this.box(w,height,d,x,height/2,z,[0xe2ddcb,0xd2d5c5,0xd7cebd,0xbcc9bf][i],.6);
        this.box(w+.8,.45,d+.8,x,height+.2,z,0x9ba99c,.15);
        for(let row=2;row<height-1;row+=3.1)for(let col=-w/2+2;col<w/2-1;col+=3.3){
          this.box(1.35,1.45,.06,x+col,row,z-d/2-.04,0x627d7a);
          this.box(.06,1.45,1.35,x-w/2-.04,row,z+col*d/w,0x7b9188);
        }
        this.box(w+5,.2,d+5,x,-.05,z,0xb9c1b0,.4);
      }
      for(let i=0;i<14;i++){
        const x=sx*(17+(i%7)*12),z=sz*(20+Math.floor(i/7)*72+rand()*6);
        this.tree(x,z,4+rand()*2,rand);
      }
    }
    // Curb lines and tree-lined verges.
    for(const x of [-12,12])for(const z of [-63,63])this.box(.22,.22,90,x,.07,z,0xf0ebd4,.06);
    for(const z of [-12,12])for(const x of [-63,63])this.box(90,.22,.22,x,.07,z,0xf0ebd4,.06);
    for(const sx of [-1,1])for(const sz of [-1,1]){
      for(const k of [30,65,95]){this.streetlight(sx*12,sz*k);this.streetlight(sx*k,sz*12);}
    }
    this.busShelter(14.8,43);
    const sign=this.text('IIT DELHI  /  CAMPUS EDGE',24,4,{background:'#d8dfc8',color:'#40533e',size:48});sign.position.set(-42,3.5,22);this.conceptWorld.add(sign);
    this.box(.4,4,.4,-53,1.8,22,0x6c7968);this.box(.4,4,.4,-31,1.8,22,0x6c7968);
    this.signals={};
    for(const a of ['N','S','E','W'])this.buildSignal(a);
  }
  tree(x,z,h,rand){
    this.mesh(new THREE.CylinderGeometry(.2,.32,h*.7,7),this.mat(0x746b51),x,h*.35,z);
    for(let j=0;j<3;j++){const crown=this.mesh(new THREE.DodecahedronGeometry(h*(.36+j*.02),1),this.mat([0x7e9b61,0x8ba66c,0x69895a][j]),x+(j-1)*.7,h*.75+j*.4,z+(rand()-.5));crown.scale.y=.9;}
  }
  streetlight(x,z){this.mesh(new THREE.CylinderGeometry(.06,.1,7,6),this.mat(0x5e6b62),x,3.5,z);this.box(1.8,.12,.12,x-.8,7,z,0x5e6b62);this.box(.9,.13,.4,x-1.4,6.95,z,0xe2dfc5,.1);}
  busShelter(x,z){this.box(3.6,.18,10,x,3.4,z,0xc7d0b8,.1);for(const k of [-4,4])this.box(.12,3.4,.12,x+1.4,1.7,z+k,0x596f64);this.box(.12,2.7,8.7,x+1.4,1.6,z,0x7e9990);this.box(1,.2,6,x,.7,z,0x9a8a65);this.box(.13,.8,6,x+.7,1,z,0x8b7c60);const text=this.text('BUS',2.5,.6,{size:80});text.position.set(x,3,z-5.1);this.conceptWorld.add(text);}
  buildSignal(a){
    const rotation={N:0,S:Math.PI,E:-Math.PI/2,W:Math.PI/2}[a],g=new THREE.Group();g.rotation.y=rotation;
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.1,.15,5.9,8),this.mat(0x55665c));pole.position.set(11.5,2.95,-16.8);g.add(pole);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(5.4,.13,.13),this.mat(0x55665c));arm.position.set(9,5.7,-16.8);g.add(arm);
    const head=new THREE.Mesh(new RoundedBoxGeometry(.7,1.9,.55,2,.12),this.mat(0x273735));head.position.set(6.5,5,-16.8);g.add(head);
    const lamps=[];
    for(let i=0;i<3;i++){
      const mat=new THREE.MeshStandardMaterial({color:0x18251f,emissive:0x000000,roughness:.3});
      const lamp=new THREE.Mesh(new THREE.SphereGeometry(.19,10,8),mat);lamp.scale.z=.45;lamp.position.set(6.5,5.55-i*.55,-17.1);g.add(lamp);lamps.push(mat);
    }
    this.conceptWorld.add(g);this.signals[a]=lamps;
  }
  buildVehicles(){
    this.prototypeCache={};
    const rubber=this.mat(0x26312f,{roughness:1}),glass=this.mat(0x244349,{metalness:.2,roughness:.22}),rim=this.mat(0xc0c7bc,{metalness:.7,roughness:.35}),light=this.mat(0xf2e9c0,{emissive:0xd9d3aa,emissiveIntensity:.4}),red=this.mat(0xd95b43,{emissive:0xb23926,emissiveIntensity:.45}),dark=this.mat(0x344b40),body=new THREE.MeshStandardMaterial({color:0xffffff,metalness:.15,roughness:.4});
    for(const [type,spec]of Object.entries(VEHICLES)){
      const parts=new Map();
      const piece=(material,g,x,y,z,rot=null)=>{g=g.index?g.toNonIndexed():g.clone();const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot||[0,0,0]))),new THREE.Vector3(1,1,1));g.applyMatrix4(m);if(!parts.has(material))parts.set(material,[]);parts.get(material).push(g);};
      const box=(mat,w,h,d,x,y,z,r=.06)=>piece(mat,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/4,h/4,d/4)),x,y,z);
      const wheel=(x,z,r=.34)=>{piece(rubber,new THREE.CylinderGeometry(r,r,.22,12),x,r+.05,z,[0,0,Math.PI/2]);piece(rim,new THREE.CylinderGeometry(r*.52,r*.52,.24,10),x,r+.05,z,[0,0,Math.PI/2]);};
      const w=spec.width,l=spec.length;
      if(type==='car'){
        box(body,w,.65,l,0,.68,0,.2);box(body,w*.88,.1,l*.53,0,1.03,-.2,.04);
        box(glass,w*.8,.48,l*.48,0,1.22,-.17,.12);box(body,w*.88,.09,l*.43,0,1.54,-.21,.05);
        for(const x of [-w/2,w/2])for(const z of [-l*.31,l*.32])wheel(x,z);
        for(const x of [-w*.33,w*.33]){box(light,.43,.17,.1,x,.77,l/2+.01);box(red,.42,.17,.1,x,.77,-l/2-.01);}
        box(rim,w*.5,.2,.05,0,.5,l/2+.05);box(dark,w*.6,.08,.04,0,.63,l/2+.06);
        for(const x of [-w*.57,w*.57])box(body,.22,.14,.3,x,1.1,.65);
      }else if(type==='bus'){
        box(body,w,2.5,l,0,1.7,0,.25);box(this.mat(0xe5e8d3),w*.94,.18,l*.95,0,3.01,0,.1);
        for(const x of [-w/2-.01,w/2+.01])for(let z=-l/2+.9;z<l/2-.8;z+=1.35)box(glass,.035,1,1.08,x,2.15,z,.015);
        box(glass,w*.83,1.3,.05,0,2.1,l/2+.015);box(dark,w*.8,.3,.06,0,2.86,l/2+.02);
        for(const x of [-w/2,w/2])for(const z of [-l*.31,l*.33])wheel(x,z,.48);
        for(const x of [-w*.34,w*.34]){box(light,.4,.18,.1,x,1,l/2+.04);box(red,.25,.5,.1,x,1,-l/2-.04);}
        box(dark,.06,1.6,.8,-w/2-.035,1.4,l*.32,.02);box(this.mat(0xbac5b0),1.1,.25,2.2,0,3.2,-1);
      }else if(type==='auto'){
        const green=this.mat(0x47855b),yellow=this.mat(0xe6bf4e);
        box(green,w,.83,l*.7,0,.8,-.32,.15);box(yellow,w*.97,.24,l*.76,0,1.7,-.16,.12);
        box(green,w*.65,.65,l*.35,0,.75,l*.33,.13);box(glass,w*.8,.55,.06,0,1.37,l*.31,.03);
        box(dark,w*.8,.45,.1,0,1.1,-l*.4,.02);box(yellow,.09,.7,.09,-w*.44,1.32,l*.28);box(yellow,.09,.7,.09,w*.44,1.32,l*.28);
        wheel(0,l*.33,.28);wheel(-w/2,-l*.28,.3);wheel(w/2,-l*.28,.3);box(light,.4,.2,.07,0,.8,l/2+.015);
      }else if(type==='motorcycle'){
        wheel(0,-.7,.33);wheel(0,.72,.33);box(body,.45,.38,1.18,0,.68,0,.12);box(dark,.4,.13,.8,0,.91,-.23,.05);
        piece(rim,new THREE.CylinderGeometry(.045,.045,.75,6),0,.57,.72,[.2,0,0]);box(rim,.8,.05,.06,0,1.12,.58,.02);
        const rider=this.mat(0x4c625d),skin=this.mat(0xbb9575);
        box(rider,.48,.63,.36,0,1.3,-.05,.16);box(dark,.16,.6,.22,-.25,.8,-.17,.06);box(dark,.16,.6,.22,.25,.8,-.17,.06);
        piece(skin,new THREE.SphereGeometry(.19,10,8),0,1.78,-.04);piece(body,new THREE.SphereGeometry(.23,10,8),0,1.88,-.08);
        box(light,.2,.18,.08,0,1.04,.84,.03);box(red,.15,.12,.08,0,.79,-.97,.03);
      }else{
        box(body,w,1.8,l*.27,0,1.35,l*.34,.2);box(glass,w*.85,.7,.05,0,1.7,l*.48,.04);
        box(this.mat(0xe0d6bd),w,2.5,l*.66,0,1.85,-l*.15,.12);box(dark,w*.94,.35,l*.9,0,.62,0,.05);
        for(const x of [-w/2,w/2])for(const z of [-l*.34,-l*.17,l*.33])wheel(x,z,.45);
        for(const x of [-w*.33,w*.33]){box(light,.38,.18,.1,x,.94,l/2+.03);box(red,.3,.2,.1,x,.82,-l/2-.03);}
      }
      const entry={type,parts:[],vehicles:[]};
      for(const[material,geometries]of parts){
        const merged=mergeGeometries(geometries,false);if(!merged)throw new Error('Could not build '+type+' vehicle geometry.');
        const mesh=new THREE.InstancedMesh(merged,material,260);mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;this.scene.add(mesh);
        const colored=material===body;entry.parts.push({mesh,colored});if(colored||type==='auto'){if(entry.parts.length===1||colored)this.bodyMeshes.push(mesh);}
      }
      this.batches.push(entry);
    }
    this.selection=this.mesh(new THREE.TorusGeometry(1.8,.08,6,48),new THREE.MeshBasicMaterial({color:0xd6fb70}),0,.1,0);this.selection.rotation.x=Math.PI/2;this.selection.visible=false;
  }
  useConceptNetwork(){this.conceptWorld.visible=true;if(this.nativeWorld)this.nativeWorld.visible=false;this.signals=this.conceptSignals;this.cameraScale=1;this.controls.minDistance=32;this.controls.maxDistance=250;this.camera.far=650;this.camera.updateProjectionMatrix();this.scene.fog.near=220;this.scene.fog.far=420;this.setView('orbit');}
  setNetwork(network){
    if(this.nativeWorld){this.scene.remove(this.nativeWorld);this.nativeWorld.traverse(o=>{if(o.isMesh||o.isLine)o.geometry.dispose();});}
    this.nativeWorld=new THREE.Group();this.scene.add(this.nativeWorld);this.conceptWorld.visible=false;this.signals={};
    const road=this.mat(0x414e50,{side:THREE.DoubleSide});let extent=100;for(const lane of network.lanes)for(const [x,z]of lane.points)extent=Math.max(extent,Math.abs(x),Math.abs(z));this.cameraScale=Math.max(.6,extent/105);this.camera.far=Math.max(650,extent*6);this.camera.updateProjectionMatrix();this.scene.fog.near=extent*2.2;this.scene.fog.far=extent*4.2;
    const ground=new THREE.Mesh(new THREE.BoxGeometry(extent*2.5,1,extent*2.5),this.mat(0xc4cfb6));ground.position.y=-.6;ground.receiveShadow=true;this.nativeWorld.add(ground);
    for(const lane of network.lanes){
      const vertices=[];const p=lane.points;
      for(let i=0;i<p.length-1;i++){
        const [x,z]=p[i],[xx,zz]=p[i+1],length=Math.hypot(xx-x,zz-z);if(length<.001)continue;
        const nx=-(zz-z)/length*lane.width/2,nz=(xx-x)/length*lane.width/2,y=lane.internal?.075:.06;
        vertices.push(x+nx,y,z+nz,x-nx,y,z-nz,xx+nx,y,zz+nz,xx+nx,y,zz+nz,x-nx,y,z-nz,xx-nx,y,zz-nz);
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,road);mesh.receiveShadow=true;this.nativeWorld.add(mesh);
      if(!lane.internal){
        const positions=[];for(let i=0;i<p.length-1;i++){const [x,z]=p[i],[xx,zz]=p[i+1],length=Math.hypot(xx-x,zz-z),nx=-(zz-z)/(length||1)*lane.width/2,nz=(xx-x)/(length||1)*lane.width/2;positions.push(x+nx,.09,z+nz,xx+nx,.09,zz+nz);}
        const lines=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)),new THREE.LineDashedMaterial({color:0xc4ccbb,dashSize:3,gapSize:3}));lines.computeLineDistances();this.nativeWorld.add(lines);
      }
    }
    for(const poly of network.junctions){if(poly.length<3)continue;const shape=new THREE.Shape(poly.map(([x,z])=>new THREE.Vector2(x,-z)));const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),road);mesh.rotation.x=-Math.PI/2;mesh.position.y=.04;mesh.receiveShadow=true;this.nativeWorld.add(mesh);}
    for(const a of ['N','S','E','W']){
      const lanes=network.lanes.filter(l=>l.edge===network.incoming[a]);if(!lanes.length)continue;
      const lane=lanes[0],p=lane.points,tip=p[p.length-1],prev=p[p.length-2],dx=tip[0]-prev[0],dz=tip[1]-prev[1],length=Math.hypot(dx,dz)||1;
      const g=new THREE.Group();g.position.set(tip[0]+dz/length*(lane.width*.7),0,tip[1]-dx/length*(lane.width*.7));g.rotation.y=Math.atan2(dx,dz);
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,5,8),this.mat(0x55665c));pole.position.y=2.5;g.add(pole);
      const head=new THREE.Mesh(new RoundedBoxGeometry(.65,1.8,.5,2,.1),this.mat(0x273735));head.position.y=4.7;g.add(head);const lamps=[];
      for(let i=0;i<3;i++){const m=new THREE.MeshStandardMaterial({color:0x263b30,emissive:0});const lamp=new THREE.Mesh(new THREE.SphereGeometry(.18,10,8),m);lamp.position.set(0,5.2-i*.5,-.28);g.add(lamp);lamps.push(m);}this.signals[a]=lamps;this.nativeWorld.add(g);
    }
    this.controls.minDistance=25*this.cameraScale;this.controls.maxDistance=350*this.cameraScale;this.setView('orbit');
  }
  setView(view){this.cameraMode=view;this.controls.target.set(0,0,0);const s=this.cameraScale||1;if(view==='top'){this.camera.position.set(0,170*s,.1);}else if(view==='street'){this.camera.position.set(19*s,8*s,30*s);this.controls.target.set(0,1,0);}else this.camera.position.set(75*s,95*s,95*s);this.controls.update();}
  render(sim,selectedId){
    for(const a of ['N','S','E','W']){
      const selected=sim.signal.approach===a?2:sim.signal.amber===a?1:0;
      this.signals[a]?.forEach((m,i)=>{m.color.setHex(i===selected?[0xec6854,0xe1b34b,0xaaca66][i]:0x263b30);m.emissive.setHex(i===selected?[0xd7422d,0xd09325,0x8fb755][i]:0x000000);m.emissiveIntensity=i===selected?.8:0;});
    }
    // Graphics are capped per class; the simulation retains every vehicle.
    for(const batch of this.batches){
      const vehicles=sim.active.filter(v=>v.type===batch.type).slice(0,260);batch.vehicles=vehicles;
      for(const part of batch.parts){part.mesh.count=vehicles.length;part.mesh.userData.vehicles=vehicles;}
      for(let i=0;i<vehicles.length;i++){
        const v=vehicles[i],p=v.pose||positionOnRoute(ROUTES[v.approach+v.movement],v.s);this.dummy.position.set(p.x,.13,p.z);this.dummy.rotation.set(0,p.yaw,0);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();
        for(const part of batch.parts){part.mesh.setMatrixAt(i,this.dummy.matrix);if(part.colored){this.color.setHex(batch.type==='bus'?[0x78a765,0xe0d4a9,0x4b91a2][v.color%3]:PALETTE[v.color]);part.mesh.setColorAt(i,this.color);}}
      }
      for(const part of batch.parts){part.mesh.instanceMatrix.needsUpdate=true;if(part.mesh.instanceColor)part.mesh.instanceColor.needsUpdate=true;}
    }
    const v=sim.active.find(v=>v.id===selectedId);this.selection.visible=!!v;
    if(v){const p=v.pose||positionOnRoute(ROUTES[v.approach+v.movement],v.s);this.selection.position.set(p.x,.17,p.z);this.selection.scale.set(1,Math.max(1,v.length/4),1);}
    this.controls.update();this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.resize.disconnect();this.controls.dispose();this.renderer.dispose();}
}
