# 배포본 (PDF · DOCX)

`기능설명서/`의 마크다운 8편을 한 권으로 묶은 배포용 파일입니다.

| 파일 | 용도 |
|---|---|
| `CarePass_기능설명서.pdf` | **A4 25쪽.** 인쇄·메일 첨부·심사 제출용 |
| `CarePass_기능설명서.docx` | **한글(HWP)에서 열립니다.** 열어서 `다른 이름으로 저장 → .hwp` 하면 HWP가 됩니다 |
| `_print.html` | PDF의 중간 산출물. 직접 열어 Ctrl+P 해도 같은 결과가 나옵니다 |

## 다시 만들기

마크다운을 고친 뒤 아래를 돌리면 두 파일이 갱신됩니다. 경로는 `기능설명서/` 폴더입니다.

```bash
cd carepass-prototype/기능설명서/배포본

# PDF — HTML 생성 후 헤드리스 Chrome 으로 인쇄
python build_pdf.py ..
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="CarePass_기능설명서.pdf" "file:///<_print.html 절대경로>"

# DOCX
python build_docx.py ..
```

`build_docx.py`는 `python-docx`가 필요합니다 (`pip install python-docx`).

## 왜 HWP 를 직접 만들지 않았나

HWP는 비공개 바이너리 형식이라 스크립트로 직접 생성할 수 없습니다. 한글이 DOCX를 그대로 열므로
**DOCX → 한글에서 열기 → .hwp 로 저장**이 가장 확실한 경로입니다. 표·제목 구조가 그대로 넘어갑니다.

> 고치는 것은 **마크다운 원본**입니다. PDF·DOCX를 직접 고치면 다음 생성 때 덮어쓰입니다.
