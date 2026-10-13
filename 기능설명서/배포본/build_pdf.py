# -*- coding: utf-8 -*-
import io, re, html, os, sys

def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<!\*)\*([^*\n]+)\*(?!\*)', r'<em>\1</em>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t

def align_of(cell):
    c = cell.strip()
    if c.startswith(':') and c.endswith(':'): return 'center'
    if c.endswith(':'): return 'right'
    return 'left'

def convert(md):
    lines = md.replace('\r\n', '\n').split('\n')
    out, i, n = [], 0, len(lines)
    while i < n:
        ln = lines[i]
        # fenced code
        if ln.startswith('```'):
            i += 1; buf = []
            while i < n and not lines[i].startswith('```'):
                buf.append(html.escape(lines[i])); i += 1
            i += 1
            out.append('<pre>' + '\n'.join(buf) + '</pre>'); continue
        # table
        if ln.strip().startswith('|') and i + 1 < n and re.match(r'^\s*\|[\s:|-]+\|\s*$', lines[i+1]):
            cells = lambda s: [c.strip() for c in s.strip().strip('|').split('|')]
            head = cells(ln); aligns = [align_of(c) for c in cells(lines[i+1])]
            i += 2; rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append(cells(lines[i])); i += 1
            th = ''.join('<th style="text-align:%s">%s</th>' % (aligns[k] if k < len(aligns) else 'left', inline(c)) for k, c in enumerate(head))
            body = ''
            for r in rows:
                body += '<tr>' + ''.join('<td style="text-align:%s">%s</td>' % (aligns[k] if k < len(aligns) else 'left', inline(c)) for k, c in enumerate(r)) + '</tr>'
            out.append('<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (th, body)); continue
        # heading
        m = re.match(r'^(#{1,4})\s+(.*)$', ln)
        if m:
            lv = len(m.group(1)); out.append('<h%d>%s</h%d>' % (lv, inline(m.group(2)), lv)); i += 1; continue
        # hr
        if re.match(r'^---+\s*$', ln):
            out.append('<hr>'); i += 1; continue
        # blockquote
        if ln.startswith('>'):
            buf = []
            while i < n and lines[i].startswith('>'):
                buf.append(lines[i].lstrip('>').strip()); i += 1
            out.append('<blockquote>%s</blockquote>' % inline(' '.join(buf))); continue
        # lists
        if re.match(r'^\s*[-*]\s+', ln):
            buf = []
            while i < n and re.match(r'^\s*[-*]\s+', lines[i]):
                buf.append('<li>%s</li>' % inline(re.sub(r'^\s*[-*]\s+', '', lines[i]))); i += 1
            out.append('<ul>%s</ul>' % ''.join(buf)); continue
        if re.match(r'^\s*\d+\.\s+', ln):
            buf = []
            while i < n and re.match(r'^\s*\d+\.\s+', lines[i]):
                buf.append('<li>%s</li>' % inline(re.sub(r'^\s*\d+\.\s+', '', lines[i]))); i += 1
            out.append('<ol>%s</ol>' % ''.join(buf)); continue
        # paragraph
        if ln.strip():
            buf = []
            while i < n and lines[i].strip() and not lines[i].startswith(('#', '>', '|', '```')) \
                  and not re.match(r'^\s*[-*]\s+|^\s*\d+\.\s+|^---+\s*$', lines[i]):
                buf.append(lines[i].strip()); i += 1
            out.append('<p>%s</p>' % inline(' '.join(buf))); continue
        i += 1
    return '\n'.join(out)

CSS = """
@page { size: A4 portrait; margin: 16mm 15mm 14mm; }
* { box-sizing: border-box; }
body { font-family:"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo",system-ui,sans-serif;
  color:#111; font-size:9.6pt; line-height:1.62; margin:0; }
code,pre { font-family:"D2Coding","Consolas","Courier New",monospace; }
h1 { font-size:16pt; margin:0 0 4mm; padding-bottom:2.5mm; border-bottom:1.6pt solid #111; letter-spacing:-.02em; }
h2 { font-size:12.4pt; margin:7mm 0 2.5mm; padding-bottom:1.4mm; border-bottom:.8pt solid #bbb; letter-spacing:-.01em; }
h3 { font-size:10.8pt; margin:5mm 0 2mm; letter-spacing:-.01em; }
h4 { font-size:10pt; margin:4mm 0 1.6mm; }
p { margin:0 0 2.6mm; }
ul,ol { margin:0 0 2.6mm; padding-left:6mm; }
li { margin-bottom:1.1mm; }
table { width:100%; border-collapse:collapse; font-size:8.9pt; margin:0 0 3.2mm; }
th,td { border:.6pt solid #b0b0b0; padding:1.5mm 2.2mm; vertical-align:top; }
th { background:#f1f1f1; font-weight:700; }
pre { background:#f7f7f7; border:.6pt solid #ddd; border-left:2pt solid #888;
  padding:2.4mm 3mm; font-size:8.4pt; line-height:1.5; margin:0 0 3.2mm; white-space:pre-wrap; word-break:break-all; }
code { background:#f2f2f2; padding:.2mm 1mm; font-size:8.8pt; border-radius:2px; }
pre code { background:none; padding:0; font-size:inherit; }
blockquote { margin:0 0 3.2mm; padding:2.2mm 3mm; background:#fafafa; border-left:2.4pt solid #999; font-size:9.2pt; }
blockquote p { margin:0; }
hr { border:0; border-top:.6pt solid #ddd; margin:5mm 0; }
a { color:#0b5; text-decoration:none; word-break:break-all; }
strong { font-weight:700; }
.doc { page-break-before: always; }
.doc:first-of-type { page-break-before: avoid; }
.cover { text-align:center; padding-top:38mm; page-break-after:always; }
.cover h1 { font-size:26pt; border:0; margin-bottom:6mm; }
.cover .sub { font-size:11.5pt; color:#444; line-height:1.9; }
.cover .url { margin-top:14mm; font-size:11pt; font-weight:700; }
.cover .meta { margin-top:30mm; font-size:9.5pt; color:#666; }
.toc { page-break-after:always; }
"""

SRC = ['README.md','01_시스템_구조.md','02_판정_엔진.md','03_기관인증과_청구서.md',
       '04_블록체인.md','05_백엔드와_실사용모드.md','06_확장_기능.md','07_데모_시나리오_17종.md']

base = sys.argv[1]
parts = []
toc = []
for k, f in enumerate(SRC):
    md = io.open(os.path.join(base, f), encoding='utf-8').read()
    title = re.search(r'^#\s+(.*)$', md, re.M).group(1)
    toc.append(title)
    body = convert(md)
    if k > 0:
        parts.append('<div class="doc">%s</div>' % body)
    else:
        parts.append('<div class="doc">%s</div>' % body)

cover = """<div class="cover">
<h1>CarePass 기능설명서</h1>
<div class="sub">가족 금융 대리권 지갑 · iM뱅크 앱 내장 기능으로 설계<br>
2026 AI Blockchain Challenge in Daegu 본선 진출작 · 팀 연다(Open)</div>
<div class="url">https://carepass-im.vercel.app</div>
<div class="meta">2026년 10월 13일</div>
</div>"""
toc_html = '<div class="toc"><h1>목차</h1><ol>%s</ol></div>' % ''.join('<li>%s</li>' % html.escape(t.replace('`','')) for t in toc)

doc = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>CarePass 기능설명서</title><style>%s</style></head><body>%s%s%s</body></html>' % (CSS, cover, toc_html, ''.join(parts))
io.open(os.path.join(base, '배포본', '_print.html'), 'w', encoding='utf-8', newline='').write(doc)
print('HTML 생성: %d자' % len(doc))
