import { describe, expect, it } from 'vitest';
import { scopedStorage } from '../src/appStorage';
import { DRIVER_PLACEMENT_GUIDE_KEY, saveDriverPlacementChoice, shouldShowDriverPlacementGuide } from '../src/driverPlacementPreference';

describe('driver placement guide preference', () => {
  const fixture = () => {
    const values = new Map<string, string>();
    const backend = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
    return {values, backend, storage:scopedStorage('jolbang',()=>backend)};
  };
  it('shows by default and treats unknown old values as visible', () => {
    for (const value of [null,'','true','acknowledged']) expect(shouldShowDriverPlacementGuide(value)).toBe(true);
  });
  it('confirm closes only this visit and does not hide the next entry', () => {
    const {storage,values} = fixture();
    saveDriverPlacementChoice(storage,false);
    expect(values.size).toBe(0);
    expect(shouldShowDriverPlacementGuide(storage.getItem(DRIVER_PLACEMENT_GUIDE_KEY))).toBe(true);
  });
  it('hide survives a new storage instance without affecting the study app', () => {
    const {storage,backend,values} = fixture();
    saveDriverPlacementChoice(storage,true);
    expect(values.get('jolbang:driver-placement-guide.v1')).toBe('hidden');
    expect(shouldShowDriverPlacementGuide(scopedStorage('jolbang',()=>backend).getItem(DRIVER_PLACEMENT_GUIDE_KEY))).toBe(false);
    expect(shouldShowDriverPlacementGuide(scopedStorage('yeolgong',()=>backend).getItem(DRIVER_PLACEMENT_GUIDE_KEY))).toBe(true);
  });
  it('reports failed persistence and keeps confirm available without storage', () => {
    const broken = {setItem:()=>{throw new Error('quota');}};
    expect(()=>saveDriverPlacementChoice(broken,true)).toThrow('quota');
    expect(()=>saveDriverPlacementChoice(broken,false)).not.toThrow();
    expect(shouldShowDriverPlacementGuide(null)).toBe(true);
  });
});
