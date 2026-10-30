import * as THREE from 'three';
import assert from 'node:assert/strict';
import {TrafficScene} from '../dist/scene.js';
const scene=Object.create(TrafficScene.prototype);
scene.scene=new THREE.Scene();scene.materials=new Map();scene.batches=[];scene.bodyMeshes=[];
scene.buildVehicles();
assert.equal(scene.batches.length,5);
for(const batch of scene.batches){
  assert.ok(batch.parts.length>=3);
  for(const part of batch.parts){
    part.mesh.geometry.computeBoundingBox();const size=part.mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Number.isFinite(size.x+size.y+size.z)&&size.length()>0);
    assert.equal(part.mesh.instanceMatrix.count,260);
    const pos=part.mesh.geometry.attributes.position.array;assert.ok(pos.every(Number.isFinite));
  }
  console.log(batch.type+': '+batch.parts.length+' instanced material batches; valid geometry');
}
assert.ok(scene.bodyMeshes.length>=5);
console.log('All five vehicle models built successfully without a GPU.');
