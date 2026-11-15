/** Bounded, content-free host timing. Network timings (including the data worker)
 * are correlated separately by the browser inspector; no URL/grant enters here. */
export type PlaybackStage='play'|'probe:start'|'probe:ready'|'probe:cached'|'assets:start'|'assets:ready'|
  'runtime:start'|'runtime:ready'|'metadata:start'|'metadata:ready'|'audio:start'|'audio:ready'|'decode:start'|'decode:ready'|'plan:received'|'source:open'|'first-frame'|'source:failed';
interface Point {attempt:number;source:number;stage:PlaybackStage;at:number;detail?:'file'|'hls'|'webgpu'|'native'|'mse'}
interface TimingState {points:Point[];attempt:number;mounted:number;source:number;firstSource:number}
const key=Symbol.for('vela.playback.timing');
// Host and dynamically loaded runtime are separately bundled; share only this
// small diagnostic store, never playback/controller objects.
const state:TimingState=Reflect.get(globalThis,key)??{points:[],attempt:0,mounted:0,source:0,firstSource:-1};
Reflect.set(globalThis,key,state);
export function playbackMark(stage:PlaybackStage,detail?:Point['detail']){
  if(stage==='play')state.attempt++;
  if(stage==='source:open')state.source++;
  if(stage==='first-frame'){if(state.firstSource===state.source)return;state.firstSource=state.source;}
  state.points.push({attempt:state.attempt,source:state.source,stage,at:performance.now(),...(detail?{detail}:{})});
  if(state.points.length>200)state.points.shift();
}
/** Snapshot copies prevent a console consumer from mutating playback state. */
export function playbackTimings(){return state.points.map(point=>({...point}));}
const playIntent=(event:Event)=>{
  const target=event.composedPath().find(node=>node instanceof HTMLElement&&node.hasAttribute('data-testid')) as HTMLElement|undefined;
  const id=target?.getAttribute('data-testid')??'';
  if(id==='hero-primary'||!id.startsWith('player-')&&/(^|[-_])(play|watch)([-_]|$)/.test(id))playbackMark('play');
};
/** The root media-context view is present before detail/hero Play is available. */
export function mountPlaybackTiming():()=>void{
  if(state.mounted++===0){
    document.addEventListener('click',playIntent,true);
    Object.defineProperty(window,'velaPlaybackTimings',{configurable:true,value:playbackTimings});
  }
  let removed=false;
  return()=>{if(removed)return;removed=true;if(--state.mounted===0)document.removeEventListener('click',playIntent,true);};
}
