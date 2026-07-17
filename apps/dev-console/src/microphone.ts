export type SpeechRecognitionGuidance = {
  message: string;
  speech: string;
  permissionProblem: boolean;
};

export function speechRecognitionGuidance(error: string): SpeechRecognitionGuidance {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        message: "마이크 권한이 차단됐습니다 · 주소창의 사이트 설정에서 마이크를 허용해 주세요",
        speech: "마이크 권한이 차단되어 있어요. 사이트 설정에서 마이크를 허용해 주세요.",
        permissionProblem: true,
      };
    case "audio-capture":
      return {
        message: "마이크를 사용할 수 없습니다 · 다른 녹음 앱이나 화상회의를 종료해 주세요",
        speech: "다른 앱이 마이크를 사용 중인지 확인해 주세요.",
        permissionProblem: false,
      };
    case "no-speech":
      return {
        message: "음성이 들리지 않았습니다 · 버튼을 누르고 조금 더 크게 말해 주세요",
        speech: "음성이 들리지 않았어요. 버튼을 누르고 다시 말해 주세요.",
        permissionProblem: false,
      };
    case "network":
      return {
        message: "Chrome 음성 인식 서버에 연결하지 못했습니다 · 인터넷 연결을 확인해 주세요",
        speech: "음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
        permissionProblem: false,
      };
    case "aborted":
      return { message: "음성 듣기를 취소했습니다", speech: "", permissionProblem: false };
    case "language-not-supported":
      return {
        message: "이 기기의 Chrome에서 한국어 음성 인식을 지원하지 않습니다",
        speech: "이 기기에서는 한국어 음성 인식을 사용할 수 없어요.",
        permissionProblem: false,
      };
    default:
      return {
        message: "음성 질문을 인식하지 못했습니다 · 잠시 후 다시 말해 주세요",
        speech: "질문을 인식하지 못했어요. 잠시 후 다시 말해 주세요.",
        permissionProblem: false,
      };
  }
}

export function microphonePermissionError(error: unknown): SpeechRecognitionGuidance {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return speechRecognitionGuidance("not-allowed");
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return speechRecognitionGuidance("audio-capture");
    }
    if (error.name === "NotFoundError") {
      return {
        message: "사용 가능한 마이크를 찾지 못했습니다 · 기기의 마이크 설정을 확인해 주세요",
        speech: "사용 가능한 마이크를 찾지 못했어요.",
        permissionProblem: false,
      };
    }
  }
  return {
    message: error instanceof Error ? `마이크를 시작하지 못했습니다 · ${error.message}` : "마이크를 시작하지 못했습니다",
    speech: "마이크를 시작하지 못했어요.",
    permissionProblem: false,
  };
}
