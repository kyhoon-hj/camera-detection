import { afterEach, describe, expect, it, vi } from "vitest";
import { cameraErrorMessage, requestUserCamera } from "../src/cameraAccess";
import { withStartupTimeout } from "../src/driverPermissions";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("카메라 시작과 권한 복구", () => {
  it('꺼진 가상 카메라 대신 RGB 웹캠을 열고 기존 트랙을 종료한다', async () => {
    const stop = vi.fn();
    const virtual = {getVideoTracks:()=>[{label:'Mirametrix Virtual Camera'}],getTracks:()=>[{stop}]} as unknown as MediaStream;
    const physical = {getVideoTracks:()=>[{label:'USB webcam'}],getTracks:()=>[]} as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValueOnce(virtual).mockResolvedValueOnce(physical);
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia,enumerateDevices:async()=>[
      {kind:'videoinput',deviceId:'virtual',label:'Mirametrix Virtual Camera'},
      {kind:'videoinput',deviceId:'ir',label:'IR camera'},
      {kind:'videoinput',deviceId:'rgb',label:'USB webcam'},
    ]}});
    expect(await requestUserCamera({audio:false,video:{facingMode:'user',width:{ideal:1280}}})).toBe(physical);
    expect(stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith({audio:false,video:{width:{ideal:1280},deviceId:{exact:'rgb'}}});
  });
  it('정상 전면 카메라와 명시적으로 선택한 가상 카메라는 교체하지 않는다', async () => {
    const enumerateDevices = vi.fn();
    const stream = {getVideoTracks:()=>[{label:'Front Camera'}]} as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia,enumerateDevices}});
    expect(await requestUserCamera({video:{facingMode:'user'}})).toBe(stream);
    const selected = {getVideoTracks:()=>[{label:'OBS Virtual Camera'}]} as unknown as MediaStream;
    getUserMedia.mockResolvedValue(selected);
    expect(await requestUserCamera({video:{deviceId:{exact:'chosen'}}})).toBe(selected);
    expect(enumerateDevices).not.toHaveBeenCalled();
  });
  it('실제 웹캠을 열 수 없으면 꺼진 가상 화면을 성공으로 표시하지 않는다', async () => {
    const stop = vi.fn();
    const virtual = {getVideoTracks:()=>[{label:'Mirametrix Virtual Camera'}],getTracks:()=>[{stop}]} as unknown as MediaStream;
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockResolvedValueOnce(virtual).mockRejectedValueOnce(new DOMException('busy','NotReadableError')),enumerateDevices:async()=>[{kind:'videoinput',deviceId:'rgb',label:'USB webcam'}]}});
    await expect(requestUserCamera({video:true})).rejects.toMatchObject({name:'NotReadableError'});
    expect(stop).toHaveBeenCalledOnce();
  });
  it("앱 권한 거절은 폰 설정, 웹 권한 거절은 사이트 설정을 안내한다", () => {
    const error = new DOMException("denied", "NotAllowedError");
    expect(cameraErrorMessage(error, true)).toContain("앱 설정");
    expect(cameraErrorMessage(error, true)).not.toContain("Chrome");
    expect(cameraErrorMessage(error)).toContain("사이트 설정");
    expect(cameraErrorMessage(new DOMException("busy", "NotReadableError"), true)).toContain("카메라 접근");
  });
  it("분석 초기화가 응답하지 않으면 준비 상태를 끝낼 오류를 반환한다", async () => {
    vi.useFakeTimers();
    const result = expect(withStartupTimeout(new Promise(() => {}), 1000, "분석 준비 지연")).rejects.toThrow("분석 준비 지연");
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("카메라 요청이 끝나면 타이머를 정리하고 정상 트랙은 유지한다", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve(stream) } });
    expect(await requestUserCamera({video:true})).toBe(stream);
    expect(vi.getTimerCount()).toBe(0);
    expect(stop).not.toHaveBeenCalled();
  });
  it("시간 초과 후 뒤늦게 허용된 카메라 트랙은 즉시 종료한다", async () => {
    vi.useFakeTimers();
    let resolve!: (stream:MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(r => { resolve = r; }) } });
    const result = expect(requestUserCamera({video:true})).rejects.toMatchObject({ name:"TimeoutError" });
    await vi.advanceTimersByTimeAsync(20000);
    await result;
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
});
