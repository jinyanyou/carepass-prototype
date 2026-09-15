# -*- coding: utf-8 -*-
"""건강보험심사평가원 「전국 병의원 및 약국 현황」 zip → 대구광역시 의료기관·약국 JSON

    python data/tools/build_daegu_medical.py <전국 병의원 및 약국 현황 2026.6.zip>

원본: https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925 (공공누리 제1유형)
결과: data/daegu-medical.json — 대구 소재 기관만, 결제처 확인에 필요한 항목만 남긴다.
외부 패키지 없이 표준 라이브러리로 xlsx를 읽는다.
"""
import io
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
BASIS = '2026.6.'
OUT = os.path.join(os.path.dirname(__file__), '..', 'daegu-medical.json')
HTML = os.path.join(os.path.dirname(__file__), '..', '..', 'index.html')
BEGIN = '/* MEDICAL:BEGIN — data/tools/build_daegu_medical.py 가 자동 생성. 직접 고치지 마세요 */'
END = '/* MEDICAL:END */'
# 결제처로 인정하지 않는 공공 보건기관 (진료비 대리결제 대상에서 제외)
EXCLUDE_TYPES = {'보건소', '보건지소', '보건진료소'}


def col_index(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(data):
    x = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if 'xl/sharedStrings.xml' in x.namelist():
        for _, el in ET.iterparse(x.open('xl/sharedStrings.xml')):
            if el.tag == NS + 'si':
                shared.append(''.join(t.text or '' for t in el.iter(NS + 't')))
                el.clear()
    sheet = sorted(n for n in x.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    for _, el in ET.iterparse(x.open(sheet)):
        if el.tag != NS + 'row':
            continue
        cells = {}
        for c in el.findall(NS + 'c'):
            v = c.find(NS + 'v')
            if c.get('t') == 's' and v is not None:
                val = shared[int(v.text)]
            elif c.get('t') == 'inlineStr':
                val = ''.join(t.text or '' for t in c.iter(NS + 't'))
            else:
                val = v.text if v is not None else ''
            cells[col_index(c.get('r'))] = val
        el.clear()
        yield [cells.get(i, '') for i in range(max(cells) + 1)] if cells else []


def find_member(z, keyword):
    for info in z.infolist():
        name = info.filename
        if not (info.flag_bits & 0x800):
            try:
                name = name.encode('cp437').decode('cp949')
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
        if keyword in name and name.endswith('.xlsx'):
            return info
    raise SystemExit(f'zip 안에서 "{keyword}" 파일을 찾지 못했습니다.')


def extract(z, keyword):
    it = read_xlsx(z.read(find_member(z, keyword)))
    header = next(it)
    idx = {h.strip(): i for i, h in enumerate(header)}
    for row in it:
        get = lambda k: row[idx[k]].strip() if idx[k] < len(row) else ''
        if get('시도코드명') != '대구':
            continue
        yield {
            'name': get('요양기관명'),
            'type': get('종별코드명'),
            'gu': get('시군구코드명').replace('대구', ''),
            'addr': get('주소'),
            'tel': get('전화번호'),
        }


def short_addr(addr, gu):
    a = re.sub(r'^대구광역시\s*', '', addr)
    return re.sub(r'^' + re.escape(gu) + r'\s*', '', a)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    z = zipfile.ZipFile(sys.argv[1])
    items = list(extract(z, '병원정보서비스')) + list(extract(z, '약국정보서비스'))
    items = [r for r in items if r['type'] not in EXCLUDE_TYPES]
    types = sorted({r['type'] for r in items})
    gus = sorted({r['gu'] for r in items})
    rows = [[r['name'], types.index(r['type']), gus.index(r['gu']), short_addr(r['addr'], r['gu']), r['tel']]
            for r in sorted(items, key=lambda r: (r['gu'], r['name']))]
    out = {
        'source': '건강보험심사평가원 「전국 병의원 및 약국 현황」',
        'basis': BASIS,
        'url': 'https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925',
        'license': '공공누리 제1유형(출처표시)',
        'note': '대구광역시 소재 병원·의원·치과·한의원·약국만 추출, 보건소·보건지소·보건진료소 제외, 기관명·종별·구군·주소·전화만 사용',
        'fields': ['name', 'type', 'gu', 'addr', 'tel'],
        'types': types,
        'gus': gus,
        'rows': rows,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    # 단일 HTML(오프라인·file://)에서도 동작하도록 index.html 에도 같은 데이터를 넣는다
    html = open(HTML, encoding='utf-8').read()
    i, j = html.find(BEGIN), html.find(END)
    if i < 0 or j < 0:
        raise SystemExit('index.html 에서 MEDICAL 블록 표시를 찾지 못했습니다.')
    block = BEGIN + '\nconst MEDICAL=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n' + END
    with open(HTML, 'w', encoding='utf-8', newline='') as f:
        f.write(html[:i] + block + html[j + len(END):])
    by_type = {t: sum(1 for r in rows if r[1] == i) for i, t in enumerate(types)}
    print(f'{len(rows)}곳 → {os.path.normpath(OUT)} ({os.path.getsize(OUT):,} bytes)')
    print(by_type)
    print(gus)


if __name__ == '__main__':
    main()
