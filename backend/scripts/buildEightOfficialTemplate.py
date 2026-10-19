"""Prepare the first page of the supplied eight-a-side Word form.

Development-only: the server uses the generated DOCX and needs no Python/Office.
Only document.xml is changed; all other source package parts are copied intact.
"""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '四官单模板/四官单模板--8人制版.docx'
OUTPUT = ROOT / 'backend/templates/fourth-official-8.docx'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def tag(name):
    return '{' + NS['w'] + '}' + name


def property_node(parent, name, **values):
    element = parent.find('w:' + name, NS)
    if element is None:
        element = E.SubElement(parent, tag(name))
    for key, value in values.items():
        element.set(tag(key), str(value))
    return element


def slot(rows, row, cell, key):
    tc = rows[row].findall('w:tc', NS)[cell]
    assert not tc.xpath('.//w:t/text()', namespaces=NS), (row, cell)
    property_node(tc.find('w:tcPr', NS), 'vAlign', val='center')
    p = tc.find('w:p', NS)
    pp = property_node(p, 'pPr')
    property_node(pp, 'jc', val='center')
    property_node(pp, 'ind', firstLine=0, firstLineChars=0)
    property_node(pp, 'spacing', before=0, after=0, line=240, lineRule='auto')
    run = E.SubElement(p, tag('r'))
    rp = E.SubElement(run, tag('rPr'))
    property_node(rp, 'rFonts', ascii='宋体', hAnsi='宋体', eastAsia='宋体')
    property_node(rp, 'sz', val=20)
    property_node(rp, 'szCs', val=20)
    property_node(rp, 'b', val=0)
    E.SubElement(run, tag('t')).text = '{{' + key + '}}'


def main():
    with ZipFile(SOURCE) as source:
        root = E.fromstring(source.read('word/document.xml'))
        body = root.find('w:body', NS)
        assert len(body) == 13, 'Source structure changed: inspect before regenerating'
        assert ''.join(body[6].xpath('.//w:t/text()', namespaces=NS)) == '2025同济大学足协杯 比赛报告表'
        # First-page content is body[0:5]; body[5] is the inter-page blank paragraph.
        # Retain the original final section properties for the same page geometry.
        for child in list(body)[5:-1]:
            body.remove(child)
        rows = body.find('w:tbl', NS).findall('w:tr', NS)
        assert len(rows) == 34
        for cell, key in [(1, 'team_a'), (3, 'a_kit'), (5, 'team_b'), (7, 'b_kit')]:
            slot(rows, 0, cell, key)
        for cell, key in [(1, 'match_datetime'), (5, 'field_order'), (7, 'venue')]:
            slot(rows, 1, cell, key)
        for i in range(17):
            for side, offset in [('a', 0), ('b', 5)]:
                for cell, kind in [(1, 'number'), (2, 'name'), (3, 'suspended')]:
                    slot(rows, i + 5, cell + offset, f'{side}_{kind}_{i + 1}')
        OUTPUT.parent.mkdir(exist_ok=True)
        with ZipFile(OUTPUT, 'w') as output:
            for entry in source.infolist():
                data = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True) if entry.filename == 'word/document.xml' else source.read(entry.filename)
                output.writestr(entry, data)
    print(OUTPUT)


if __name__ == '__main__':
    main()
