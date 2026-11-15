import {defaultSubtitlePreferences,type SubtitlePreferences} from './types';
const choices={subtitleSize:['small','medium','large','xl'],subtitleBackground:['none','shadow','box'],subtitleColor:['white','yellow'],subtitlePosition:['bottom','raised']} as const;
export type SubtitlePreferenceName=keyof typeof choices;
export function readSubtitlePreferences():SubtitlePreferences{
  const result={...defaultSubtitlePreferences};
  try{for(const name of Object.keys(choices) as SubtitlePreferenceName[]){const value=localStorage.getItem(`vela.player.${name}`);if(value&&(choices[name] as readonly string[]).includes(value))Object.assign(result,{[name]:value})}}catch{}
  return result;
}
/** Accepts the CC menu's name=value command; only enumerated device preferences are stored. */
export function updateSubtitlePreference(current:SubtitlePreferences,command:string):SubtitlePreferences{
  const match=/^(subtitleSize|subtitleBackground|subtitleColor|subtitlePosition)=([a-z]+)$/.exec(command);
  if(!match||!(choices[match[1] as SubtitlePreferenceName] as readonly string[]).includes(match[2]))throw new Error('Invalid subtitle appearance preference');
  const next={...current,[match[1]]:match[2]};try{localStorage.setItem(`vela.player.${match[1]}`,match[2])}catch{}return next;
}
export function validateSubtitlePreferences(value:SubtitlePreferences):SubtitlePreferences{
  for(const name of Object.keys(choices) as SubtitlePreferenceName[])if(!(choices[name] as readonly string[]).includes(value[name]))throw new Error('Invalid subtitle appearance preference');
  if(!Number.isFinite(value.offsetSeconds)||Math.abs(value.offsetSeconds)>600)throw new Error('Invalid subtitle time offset');return {...value};
}
