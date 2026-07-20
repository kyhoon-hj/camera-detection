export type SpeechResultLike = {
  isFinal:boolean;
  0?:{transcript?:string; confidence?:number};
};

export type SpeechResultsEventLike = {
  resultIndex:number;
  results:{length:number; [index:number]:SpeechResultLike};
};

export type ParsedSpeechResults = {
  finals:Array<{text:string; confidence?:number}>;
  interim:string;
};

export function parseSpeechResults(event:SpeechResultsEventLike):ParsedSpeechResults {
  const finals:Array<{text:string; confidence?:number}> = [];
  const interim:string[] = [];
  for (let index=event.resultIndex; index<event.results.length; index++) {
    const result = event.results[index];
    const text = result?.[0]?.transcript?.trim();
    if (!text) continue;
    if (result.isFinal) finals.push({text, confidence:result[0]?.confidence});
    else interim.push(text);
  }
  return {finals, interim:interim.join(" ")};
}

export function speakerLabel(speaker:string) {
  return speaker === "KSL_USER" ? "수어 사용자" : "음성 사용자";
}
