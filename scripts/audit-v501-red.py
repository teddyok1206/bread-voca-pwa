"""Print a reproducible audit of red study headwords; never modify the PDF/pack.

Usage: python scripts/audit-v501-red.py /path/to/V501.pdf [--javascript]
Requires pdfplumber. --javascript emits assets/v501-red-terms.js content.
Only DAY 01-30 determines eligibility: 31-47 are indexes, 48 is an errata list
whose red ink does not turn ordinary black study words into excluded terms.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]


def resident(path):
    stat = path.stat()
    if path.name.endswith('.icloud') or getattr(stat, 'st_flags', 0) & 0x40000000 or (stat.st_size and not stat.st_blocks):
        raise RuntimeError(f'Refusing nonresident input: {path}')
    return path


def normalize(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text).replace('’', "'").replace('‘', "'")).strip().lower()


def audit(path):
    source = resident(path)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    previous = json.loads(resident(ROOT / 'tests/fixtures/v501-marked-entries.json').read_text())
    assert source_hash == previous['source_sha256'], 'Wrong PDF edition; inspect before changing the exclusion policy'
    pack = json.loads(resident(ROOT / 'vocab_pack.json').read_text())
    vocab = [entry for entry in pack['entries'] if entry['book'] == 'V501']
    records, counts = [], []
    with pdfplumber.open(source) as pdf:
        assert len(pdf.pages) == 48
        for page_number, page in enumerate(pdf.pages[:30], 1):
            full_text = page.extract_text(x_tolerance=1)
            assert 'LOGIC TREE V501 ver. 11.1' in full_text
            assert re.search(rf'DAY\s+0?{page_number}(?:\s|$)', full_text)
            red = page.filter(lambda item: item.get('object_type') == 'char' and item.get('non_stroking_color') == (1., 0., 0.))
            # In this verified edition red headwords/glosses occupy column 3.
            assert red.chars and min(char['x0'] for char in red.chars) > 550
            text = re.sub(r'([^\n])\n\s*:', r'\1:', red.extract_text(x_tolerance=1))
            words = re.findall(r'^([^:\n]+):', text, re.M)
            assert len(words) == text.count(':'), f'Unparsed colon on page {page_number}'
            for word in words:
                assert not re.search(r'[가-힣※]', word), (page_number, word)
                matches = [entry for entry in vocab if entry['source_page'] == page_number and normalize(entry['word']) == normalize(word)]
                assert len(matches) <= 1, (page_number, word, 'ambiguous vocabulary match')
                records.append({'chapter': page_number, 'word': word.strip(), 'id': matches[0]['id'] if matches else None})
            counts.append({'chapter': page_number, 'red_terms': len(words), 'registered_entries': sum(record['id'] is not None for record in records if record['chapter'] == page_number)})
    assert len(records) == 376
    assert sum(record['id'] is not None for record in records) == 360
    assert len({(record['chapter'], normalize(record['word'])) for record in records}) == len(records)
    return {
        'source_file': 'V501.pdf', 'source_version': '11.1', 'source_sha256': source_hash,
        'rule': 'Exclude red RGB(1,0,0) headwords on DAY 01-30; preserve black words and all marked notes. Indexes and errata do not independently determine eligibility.',
        'study_pages': 30, 'red_term_count': len(records), 'registered_excluded_count': 360,
        'already_absent_count': 16, 'registered_v501_count': len(vocab), 'remaining_study_count': len(vocab) - 360,
        'chapters': counts, 'entries': records,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--javascript', action='store_true')
    args = parser.parse_args()
    result = json.dumps(audit(args.pdf), ensure_ascii=False, indent=2)
    if args.javascript:
        print('// Generated from the resident original PDF by scripts/audit-v501-red.py.\n// Retain source records and review history; this is an eligibility policy only.\nexport const v501RedTerms = ' + result + ';')
    else:
        print(result)
