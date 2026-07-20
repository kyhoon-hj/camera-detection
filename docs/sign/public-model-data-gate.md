# SUHA 공용 한국수어 모델 데이터 게이트

## 현재 상태

공용 한국수어 모델의 입력, 학습, ONNX 내보내기, 런타임 로딩 경로는 준비되어 있다. 실제 모델 생성에는 이용 허가를 받은 원본 수어 데이터가 필요하다. 저장소에는 제3자 영상을 포함하지 않으며 이용 조건을 확인하지 않은 데이터로 모델을 만들지 않는다.

## 확인된 후보

1. AI Hub 한국수어 데이터(데이터셋 번호 103)
   - 길찾기·교통·주소 중심 한국수어 문장과 단어 영상 및 손 키포인트를 제공한다.
   - AI Hub 로그인 후 이용 신청과 약관 확인이 필요하다.
   - https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=realm&currMenu=&dataSetSn=103&topMenu=
2. KSL-Guide
   - 한국수어 문장·단어 영상, Gloss, 번역, 2D/3D 키포인트를 포함한 연구 데이터셋이다.
   - 배포 페이지 또는 연구팀 안내에 따라 접근 권한을 받아야 한다.
   - https://github.com/ChelseaGH/KSL-Guide

## 승인 데이터 준비 후 실행

```powershell
.\scripts\prepare-ksl-model.ps1 `
  -Source "D:\datasets\aihub-ksl-103" `
  -DatasetType aihub-sign-video `
  -LicenseReference "AIHUB-TERMS-ACCEPTED-YYYYMMDD" `
  -ConfirmLicense `
  -ExtractLandmarks
```

이 명령은 다음 단계를 순서대로 실행한다.

1. 메타데이터, 영상 경로, 라벨, 촬영자 수 검증
2. 촬영자 단위 train/validation/test 분리로 데이터 누수 방지
3. 촬영자 식별자 익명화
4. 원본 영상 복사 없이 외부 참조만 기록
5. 얼굴·양손·상체 랜드마크 추출
6. KSL temporal 모델 학습
7. ONNX 모델과 manifest 생성

## 모델 승인 기준

- 최소 3명 이상의 서로 다른 수어 사용자
- 표현당 전문가 승인 샘플 30개 이상
- 촬영자 단위 분리 평가
- 상위 후보 정확도와 긴급 표현 재현율 별도 측정
- 농인 수어 사용자와 한국수어 통역사 승인
- 의료·법률·재난 표현은 사람 확인 없이 자동 음성 재생 금지

