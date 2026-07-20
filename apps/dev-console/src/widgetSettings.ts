export type WidgetPosition="TOP_LEFT"|"TOP_RIGHT"|"BOTTOM_LEFT"|"BOTTOM_RIGHT";
export type WidgetSettings={enabled:boolean;position:WidgetPosition;fontSize:number;opacity:number;showGloss:boolean};
export const DEFAULT_WIDGET_SETTINGS:WidgetSettings={enabled:true,position:"BOTTOM_RIGHT",fontSize:24,opacity:.94,showGloss:true};

export function normalizeWidgetSettings(value:Partial<WidgetSettings>):WidgetSettings {
  const positions:WidgetPosition[]=["TOP_LEFT","TOP_RIGHT","BOTTOM_LEFT","BOTTOM_RIGHT"];
  return {
    enabled:value.enabled??true,
    position:positions.includes(value.position as WidgetPosition)?value.position as WidgetPosition:"BOTTOM_RIGHT",
    fontSize:Math.min(44,Math.max(16,Number(value.fontSize)||24)),
    opacity:Math.min(1,Math.max(.55,Number(value.opacity)||.94)),
    showGloss:value.showGloss??true,
  };
}
