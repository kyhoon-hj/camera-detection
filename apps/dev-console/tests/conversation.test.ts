import { describe, expect, it } from "vitest";
import { parseSpeechResults, speakerLabel } from "../src/conversation";

describe("bidirectional conversation STT", () => {
  it("separates interim captions from final utterances", () => {
    const parsed = parseSpeechResults({
      resultIndex:0,
      results:{
        length:2,
        0:{isFinal:true,0:{transcript:" 어디가 불편하세요? ",confidence:0.92}},
        1:{isFinal:false,0:{transcript:"천천히 말씀해"}},
      },
    });
    expect(parsed.finals).toEqual([{text:"어디가 불편하세요?",confidence:0.92}]);
    expect(parsed.interim).toBe("천천히 말씀해");
  });

  it("labels hearing and KSL speakers independently", () => {
    expect(speakerLabel("HEARING_USER")).toBe("음성 사용자");
    expect(speakerLabel("KSL_USER")).toBe("수어 사용자");
  });
});
