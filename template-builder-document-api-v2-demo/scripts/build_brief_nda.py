from html import escape
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json
import re


ROOT = Path(__file__).resolve().parents[1]
BLANK = Path("/Users/mattconndev/Documents/Development/orbit/superdoc/public/shared/common/data/blank.docx")
OUTPUT = ROOT / "public" / "brief-nda.docx"


def run(text, *, bold=False, size=22, color="222222"):
    props = (
        '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
        + ('<w:b/>' if bold else '')
        + f'<w:color w:val="{color}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
    )
    space = ' xml:space="preserve"' if text[:1].isspace() or text[-1:].isspace() else ''
    return f'<w:r>{props}<w:t{space}>{escape(text)}</w:t></w:r>'


def paragraph(pid, content, *, before=0, after=120, line=276, align=None, keep=False):
    jc = f'<w:jc w:val="{align}"/>' if align else ''
    keep_xml = '<w:keepNext/>' if keep else ''
    ppr = f'<w:pPr>{keep_xml}<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>{jc}</w:pPr>'
    return f'<w:p w14:paraId="{pid}" w14:textId="77777777">{ppr}{content}</w:p>'


def sdt_pr(control_id, alias, tag, kind):
    control = '<w:text/>' if kind == 'inline' else '<w:richText/>'
    return (
        '<w:sdtPr>'
        f'<w:id w:val="{control_id}"/><w:alias w:val="{escape(alias, quote=True)}"/>'
        f'<w:tag w:val="{escape(tag, quote=True)}"/>{control}</w:sdtPr>'
    )


def inline_sdt(control_id, alias, value, field_type):
    tag = json.dumps({"group": str(control_id), "category": "field", "fieldType": field_type}, separators=(",", ":"))
    # LibreOffice under-measures inline SDT content near its closing boundary.
    # Padding in the same run keeps the visible value intact; SuperDoc trims
    # the field display value when presenting it in the sidebar.
    content = run(value + "      ", bold=True, color="1F4D78")
    return f'<w:sdt>{sdt_pr(control_id, alias, tag, "inline")}<w:sdtContent>{content}</w:sdtContent></w:sdt>'


def block_sdt(control_id, alias, value, clause_type, pid):
    tag = json.dumps({"group": str(control_id), "category": "clause", "clauseType": clause_type, "jurisdiction": "New York"}, separators=(",", ":"))
    inner = paragraph(pid, run(value), before=0, after=150, line=276)
    return f'<w:sdt>{sdt_pr(control_id, alias, tag, "block")}<w:sdtContent>{inner}</w:sdtContent></w:sdt>'


def build_body():
    parts = [
        paragraph("A0000001", run("MUTUAL NON-DISCLOSURE AGREEMENT", bold=True, size=36, color="0B2545"), after=60, align="center"),
        paragraph("A0000002", run("Brief Form | Confidential", size=18, color="667085"), after=280, align="center"),
    ]
    intro = (
        run("This Mutual Non-Disclosure Agreement (the “Agreement”) is entered into as of August 27, 2026 by and between ")
        + inline_sdt(71001, "Disclosing Party", "Acme Labs, Inc.", "disclosing-party")
        + run(" and ")
        + inline_sdt(71002, "Receiving Party", "Northstar Ventures LLC", "receiving-party")
        + run(" (each a “Party” and together, the “Parties”).")
    )
    parts.append(paragraph("A0000003", intro, after=150))
    parts.append(paragraph("A0000004", run("Purpose", bold=True, size=24, color="1F4D78"), before=180, after=100, keep=True))
    parts.append(paragraph("A0000005", run("The Parties may exchange non-public business, technical, product, financial, or customer information solely to evaluate and pursue a potential business relationship (the “Purpose”)."), after=150))
    parts.append(block_sdt(72001, "Confidentiality", "Each Party shall protect the other Party’s Confidential Information using at least reasonable care, use it only for the Purpose, and disclose it only to personnel and advisers who need to know it and are bound by confidentiality obligations. These duties do not apply to information that is public through no breach, already known without restriction, independently developed, or rightfully received from another source.", "confidentiality", "A0000006"))
    parts.append(block_sdt(72002, "Return or Destruction", "Upon written request, each Party shall promptly return or destroy the other Party’s Confidential Information, except for archival copies retained by automatic backup or legal-compliance systems, which remain subject to this Agreement.", "return-or-destruction", "A0000007"))
    parts.append(paragraph("A0000008", run("Term and remedies", bold=True, size=24, color="1F4D78"), before=180, after=100, keep=True))
    parts.append(paragraph("A0000009", run("These obligations continue for three years after disclosure; trade-secret obligations continue while the information remains a trade secret. Unauthorized use or disclosure may cause irreparable harm for which injunctive relief may be appropriate."), after=150))
    parts.append(paragraph("A000000A", run("General", bold=True, size=24, color="1F4D78"), before=180, after=100, keep=True))
    parts.append(paragraph("A000000B", run("This Agreement is the complete agreement regarding its subject matter, may be amended only in a writing signed by both Parties, and is governed by New York law. Electronic signatures and counterparts are permitted."), after=280))
    parts.append(paragraph("A000000C", run("Accepted and agreed:  __________________________    __________________________", size=20), after=40))
    parts.append(paragraph("A000000D", run("                                  Party 1                                             Party 2", size=16, color="667085"), after=0))
    return ''.join(parts)


def main():
    with ZipFile(BLANK, "r") as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}
    xml = entries["word/document.xml"].decode("utf-8")
    sect = re.search(r'<w:sectPr\b[\s\S]*?</w:sectPr>', xml).group(0)
    body = build_body() + sect
    xml = re.sub(r'<w:body>[\s\S]*?</w:body>', f'<w:body>{body}</w:body>', xml)
    entries["word/document.xml"] = xml.encode("utf-8")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)
    print(OUTPUT)


if __name__ == "__main__":
    main()
