#!/usr/bin/env python3
"""
Parse the MHA "Indian Police Service Civil List" PDF (published yearly at https://ips.gov.in/ips_civillist.aspx)
into data/india/ips.json.

Usage:  python3 scripts/parse_ips_civil_list.py [path/to/CivilList.pdf]
        (downloads https://ips.gov.in/Empanelment/CivilList<YEAR>.pdf when no path is given)
Needs:  pdftotext (poppler-utils).

Kept per officer: name, cadre, allotment year (batch), source of recruitment, birth year, date of joining IPS,
present post and since when, pay level, education, home state, medals. Not kept: ID numbers, full dates of birth.
"""
import json, re, subprocess, sys, tempfile, urllib.request, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'india' / 'ips.json'
CADRES = ['Andhra Pradesh', 'AGMUT', 'Assam-Meghalaya', 'Bihar', 'Chhattisgarh', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
          'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
          'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']
DATE = re.compile(r'\b(\d{2})/(\d{2})/(\d{4})\b')
MEDAL = re.compile(r'\b[A-Z][A-Za-z]{1,7}-\d{4}\b')
LEVEL = re.compile(r'\bLevel\s*\d+[A-Z]?\b', re.I)
DEV = re.compile(r'[ऀ-ॿ]')


def iso(m):
    return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'


def text_of(pdf):
    return subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, check=True).stdout.decode('utf-8', 'ignore')


def cadre_header(line):
    st = line.strip()
    if re.search(r'Arunachal Pradesh-Goa-Mizoram|^AGMUT$', st) and not re.search(r'\d{2}/\d{2}/\d{4}', st):
        return 'AGMUT'
    if not DEV.search(line[:40]) and st not in CADRES:
        return None
    tail = st.split('  ')[-1].strip()
    for c in CADRES:
        if tail.lower() == c.lower() or (c == 'AGMUT' and re.search(r'AGMUT|Union Territor', tail, re.I)):
            return c
    return None


def parse(txt):
    lines = txt.split('\n')
    start = next(i for i, l in enumerate(lines) if 'INDEX TO NAMES' in l) + 1
    end = next((i for i, l in enumerate(lines) if i > start and re.search(r'II TO III & INDEX TO NAMES|Combined Gradation List of IPS Officers', l)), len(lines))
    officers, cadre, year, block = [], None, None, None

    def flush():
        nonlocal block
        if block:
            o = build(block, cadre, year)
            if o:
                officers.append(o)
        block = None

    for l in lines[start:end]:
        c = cadre_header(l)
        if c:
            flush(); cadre = c; continue
        m = re.search(r'Allotment Year\s*:\s*(\d{4})', l)
        if m:
            flush(); year = int(m.group(1)); continue
        if re.match(r'^\s{0,4}\d{1,4}\s{2,}\S', l) and DATE.search(l):
            flush(); block = [l]; continue
        if block is not None:
            if re.search(r'S\. No\.|Name of the IPS officer|^\s*\(1\)', l):
                flush(); continue
            if l.strip() and not re.search(r'APPENDI|ABBERVIATION|ABBREVIATION', l):
                block.append(l)
            if len(block) > 9:
                flush()
    flush()
    return officers


def build(block, cadre, year):
    first = block[0]
    dob = DATE.search(first)
    if not dob or len(block) < 2:
        return None
    sno = int(first.split()[0])
    src_m = re.search(r'\b(RR|SPS|SCS|NSPS|Non-SPS|SPS/[A-Z]+)\b', first)
    post_col = dob.end()
    while post_col < len(first) and first[post_col] == ' ':
        post_col += 1
    second = block[1]
    id_m = re.search(r'\b\d{8}\b', second)
    id_col = id_m.start() if id_m else (src_m.start() if src_m else 40)
    dob_col = dob.start()
    eng = second[:id_col].strip()
    if not re.search(r'[A-Za-z]', eng) or DEV.search(eng):
        return None
    appt = DATE.search(second[id_col:])
    edu, home, post_parts, medals, level, since = [], [], [], [], None, None
    for i, l in enumerate(block):
        right = l[post_col - 2:] if len(l) > post_col - 2 else ''
        medals += MEDAL.findall(right)
        lv = LEVEL.search(right)
        if lv:
            level = re.sub(r'\s+', ' ', lv.group(0)).title()
        if i >= 1:
            for d in DATE.finditer(right):
                if i >= 2 or d.start() > 8:
                    since = since or iso(d)
        seg = MEDAL.sub('', LEVEL.sub('', DATE.sub('', right))).strip()
        seg = re.split(r'\s{3,}', seg)[0].strip() if seg else ''
        if seg and not DEV.search(seg):
            post_parts.append(seg)
        if i >= 2:
            left = l[:id_col].strip()
            if left and not DEV.search(left):
                edu.append(left)
            mid = l[id_col:dob_col].strip()
            if mid and not DEV.search(mid) and not re.fullmatch(r'\d+', mid):
                home.append(mid)
    post = re.sub(r'\s+', ' ', ' '.join(post_parts))
    post = re.sub(r'\b[A-Za-z][\w.()& ]{0,30}Medal\)?\s*-?\s*\d{4}', '', post)
    post = re.sub(r'\(?Gold Medal\)?|Award\b', '', post)
    post = re.sub(r'\b[A-Z]{2,7}\s?-\s?\d{4}\b', '', post)
    post = re.sub(r'(\s\d{4})+\s*$', '', post)
    post = re.sub(r'\s+', ' ', post).strip(' ,-')
    return {
        'n': sno, 'name': re.sub(r'\s+', ' ', eng), 'cadre': cadre, 'batch': year if year and 1900 < year < 2100 else None,
        'source': (src_m.group(1) if src_m else None), 'born': int(dob.group(3)),
        'joined': iso(appt) if appt else None, 'post': post or None, 'since': since,
        'level': level, 'education': ' '.join(edu) or None, 'home': ' '.join(home) or None,
        'medals': sorted(set(medals)),
    }


def main():
    pdf = sys.argv[1] if len(sys.argv) > 1 else None
    if not pdf:
        y = datetime.date.today().year
        url = f'https://ips.gov.in/Empanelment/CivilList{y}.pdf'
        pdf = tempfile.mktemp(suffix='.pdf')
        urllib.request.urlretrieve(url, pdf)
    officers = parse(text_of(pdf))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'https://ips.gov.in/ips_civillist.aspx',
                               'asOf': 'Civil List as on 1 January', 'officers': officers}, ensure_ascii=False))
    print(f'{len(officers)} officers -> {OUT}')


if __name__ == '__main__':
    main()
